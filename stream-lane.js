/* stream-lane.js — Aug 29 2026 (Part 98): the streaming playback lane's pure half.
 *
 * WHY THIS LANE EXISTS. The app fetches a WHOLE WAV per sentence and only then
 * plays it, so ding→first-word has a hard floor of one full synthesis
 * (measured live tonight: 1.9s non-streaming vs 438ms to first audio on
 * Inworld's voice:stream endpoint, same sentence, same voice). This module
 * holds everything about that lane that can be tested without a network or an
 * Express response: the incremental NDJSON audio parser, the WAV format sniff,
 * the streaming header, and the gain+knee transform that normalizes loudness
 * on bytes we cannot re-read once they are flushed.
 *
 * DESIGN CALL (measured before chosen, per the session plan): the streamed
 * lane normalizes with the voice's REMEMBERED gain — the same number
 * normalizeLoudness stored in voiceGainMemory after the voice's last clip —
 * plus the same tanh soft knee, applied per sample as chunks pass through.
 * The EMA then LEARNS from the full clip after the stream ends (server.js
 * calls normalizeLoudness in measureOnly mode on the accumulated raw PCM), so
 * the memory stays one clip behind instead of going stale. The alternative —
 * skipping normalization on the streamed piece — puts an audible loudness
 * step between the streamed opener and the buffered pieces behind it, which
 * is worse by construction. Clip-to-clip wobble within one voice is ~±3 dB
 * (the SNAP_DB comment in server.js), so one-clip-behind is inaudible.
 *
 * Chunk shape, verified live Aug 29 2026 against voice:stream: the response
 * is newline-delimited JSON; each line carries base64 audio in
 * result.audioContent. The FIRST decoded buffer is a WAV with a real RIFF
 * header; every later buffer is raw PCM continuation with no header. The
 * header's declared sizes describe only what that chunk carried (a stream
 * cannot know its total), so the sniffer reads the fmt chunk and finds where
 * PCM starts — it deliberately never trusts a declared data length.
 */

"use strict";
const { createLookaheadLimiter } = require("./limiter");

/** Incremental parser for Inworld's streaming TTS response: feed() raw HTTP
 * bytes as they arrive, get back an array of decoded audio Buffers (possibly
 * empty — a JSON line can split across HTTP chunks). Keeps its own leftover;
 * never throws on a torn line, only on a line that is complete and not JSON.
 */
function createNdjsonAudioParser() {
  let leftover = Buffer.alloc(0);
  return {
    feed(bytes) {
      leftover = leftover.length ? Buffer.concat([leftover, bytes]) : Buffer.from(bytes);
      const out = [];
      let nl;
      while ((nl = leftover.indexOf(0x0a)) !== -1) {
        const line = leftover.slice(0, nl);
        leftover = leftover.slice(nl + 1);
        const trimmed = line.toString("utf8").trim();
        if (!trimmed) continue;
        const obj = JSON.parse(trimmed);
        const ac = (obj.result && obj.result.audioContent) || obj.audioContent;
        if (ac) out.push(Buffer.from(ac, "base64"));
        else if (obj.error) {
          const err = new Error(`Inworld stream error: ${JSON.stringify(obj.error).slice(0, 200)}`);
          err.isUpstream = true;
          throw err;
        }
      }
      return out;
    },
    /** Anything still buffered (a final line without a trailing newline). */
    flush() {
      const trimmed = leftover.toString("utf8").trim();
      leftover = Buffer.alloc(0);
      if (!trimmed) return [];
      const obj = JSON.parse(trimmed);
      const ac = (obj.result && obj.result.audioContent) || obj.audioContent;
      return ac ? [Buffer.from(ac, "base64")] : [];
    },
  };
}

/** Read the fmt chunk out of a stream's FIRST audio buffer and locate where
 * PCM starts. Returns { fmt, pcmStart } or null if the buffer does not yet
 * hold the whole header (caller accumulates and retries — torn headers are
 * theoretical at 10KB first chunks, but a null beats a wrong offset).
 * The declared data length is deliberately ignored: this is a stream. */
function sniffWavFormat(buf) {
  if (buf.length < 12) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    // Raw PCM with no header at all — Inworld always headers chunk 0, but a
    // caller misusing the sniffer on a later chunk should hear about it.
    throw new Error("stream chunk 0 is not RIFF/WAVE");
  }
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      if (chunkStart + 16 > buf.length) return null;
      fmt = {
        audioFormat: buf.readUInt16LE(chunkStart),
        numChannels: buf.readUInt16LE(chunkStart + 2),
        sampleRate: buf.readUInt32LE(chunkStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkStart + 14),
      };
      offset = chunkStart + chunkSize + (chunkSize % 2);
    } else if (chunkId === "data") {
      if (!fmt) return null;
      return { fmt, pcmStart: chunkStart };
    } else {
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
  }
  return null;
}

/** A 44-byte WAV header for a stream whose length is unknown. Both size
 * fields are 0xFFFFFFFF — the streaming convention. The ONLY consumer of
 * this header is the native app's streaming player, which reads the fmt
 * fields and deliberately ignores both sizes; AVAudioPlayer and the web
 * player never see it because they never send the stream flag. */
function buildStreamingWavHeader({ numChannels, sampleRate, bitsPerSample }) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(0xffffffff, 40);
  return header;
}

/** The streamed lane's normalize: remembered gain + the SAME tanh soft knee
 * server.js uses, plus the buffered lane's ~5ms fade-in, applied per sample
 * on 16-bit LE PCM as it flows. Stateful across feed() calls: sample index
 * for the fade, one carry byte for a sample torn across chunks.
 *
 * `gain` is the voice's remembered linear gain (1.0 when the voice has no
 * memory yet — first clip since boot plays at provider level, exactly what
 * the buffered path's first clip did before July's normalization existed,
 * and the knee still guards it). The knee makes clipping mathematically
 * impossible no matter what gain the memory holds.
 */
/* PART 116.1 (Sep 2 2026) -- THE STREAM LANE GETS A CEILING OF ITS OWN.
 *
 * Her report on Della (Voice 69, Birta): "clipping really really bad, like
 * she's deepthroating the microphone." The log said why in one screen:
 * consecutive Birta clips measured -17.6 then -29.9 then -21.0 then -30.6
 * dBFS -- a 13 dB swing clip to clip -- and every quiet one SNAPPED the
 * per-voice memory, so "next-clip gain" read 16.4, 17.1, 17.0 dB, and the
 * next clip, a normal one, went out at gain 6.58 / 7.19 with no limiter
 * looking at it. The knee kept it from HARD clipping, exactly as the comment
 * above promises, and turned it into wall-to-wall tanh saturation instead.
 * The buffered path never does this: it caps gain against the clip's own
 * peak and trims to the knee budget before a sample moves. The stream could
 * not read ahead, so it got neither.
 *
 * Now it gets the half it CAN have. Each NDJSON chunk is a few hundred
 * milliseconds and arrives whole, so the chunk's own peak is a real
 * look-ahead: the effective gain is the remembered gain capped at
 * `peakCeiling / (loudest raw sample seen so far in this clip)`, ramped over
 * the first few ms of a chunk so a step down cannot zipper. A spike still
 * saturates for the chunk it arrives in and no longer than that. Opt-in via
 * `peakCeiling` so the pure-knee behaviour (and its tests) stay exact when
 * the option is absent. `appliedGain` keeps reporting the remembered gain;
 * `effectiveGain` is what the last chunk actually got. */
/* Part 117.3 (Sep 2 2026): `limiter: "lookahead"` (default) routes every
 * sample through the same 3 ms lookahead limiter the buffered lane uses
 * (limiter.js) at `ceiling`, instead of the per-sample tanh knee; the output
 * is delayed by the limiter's lookahead, and flush() drains it at the end.
 * `limiter: "tanh"` keeps the old waveshaper exactly. */
function createStreamProcessor({ gain, knee, kneeRange, fadeInSamples, peakCeiling, rampSamples, limiter = "tanh", ceiling: tpCeiling, sampleRate = 24000 }) {
  const useLookahead = limiter === "lookahead";
  const lim = useLookahead ? createLookaheadLimiter({ ceiling: tpCeiling || 28000, sampleRate }) : null;
  let carry = null; // a lone odd byte from the previous chunk
  let sampleIndex = 0;
  const g = typeof gain === "number" && isFinite(gain) && gain > 0 ? gain : 1.0;
  const ceiling = typeof peakCeiling === "number" && isFinite(peakCeiling) && peakCeiling > 0 ? peakCeiling : null;
  const ramp = Math.max(1, rampSamples || 120);
  let runningPeak = 0;
  let curGain = g;
  const self = {
    appliedGain: g,
    effectiveGain: g,
    process(bytes) {
      let buf = carry ? Buffer.concat([carry, bytes]) : Buffer.from(bytes);
      carry = null;
      if (buf.length % 2 === 1) {
        carry = buf.slice(buf.length - 1);
        buf = buf.slice(0, buf.length - 1);
      }
      const total = buf.length >> 1;
      let toGain = g;
      if (ceiling) {
        for (let i = 0; i < total; i++) {
          const a = Math.abs(buf.readInt16LE(i * 2));
          if (a > runningPeak) runningPeak = a;
        }
        if (runningPeak > 0) toGain = Math.min(g, ceiling / runningPeak);
        // never below unity because of the ceiling alone: a hot voice plays
        // at provider level, same as the buffered path's floor
        if (toGain < 1 && g >= 1) toGain = 1;
      }
      // the first chunk has nothing to ramp FROM -- it starts at its own gain
      const fromGain = sampleIndex === 0 ? toGain : curGain;
      let w = 0; // output write index (lookahead mode lags input by lim.lookahead samples)
      for (let i = 0; i < total; i++) {
        const fade = sampleIndex < fadeInSamples ? sampleIndex / fadeInSamples : 1;
        const gi = ceiling && i < ramp ? fromGain + (toGain - fromGain) * (i / ramp) : toGain;
        let v = buf.readInt16LE(i * 2) * gi * fade;
        if (lim) {
          const out = lim.push(v);
          if (out !== null) { buf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, out))), w * 2); w++; }
        } else {
          const a = Math.abs(v);
          if (a > knee) {
            v = Math.sign(v) * (knee + kneeRange * Math.tanh((a - knee) / kneeRange));
          }
          buf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, v))), i * 2);
          w++;
        }
        sampleIndex++;
      }
      curGain = toGain;
      self.effectiveGain = toGain;
      return lim ? buf.slice(0, w * 2) : buf;
    },
    /** Drain the limiter's delay line at end of stream (lookahead mode only). */
    flush() {
      if (!lim) return Buffer.alloc(0);
      const tail = lim.flush();
      const out = Buffer.alloc(tail.length * 2);
      tail.forEach((v, i) => out.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, v))), i * 2));
      return out;
    },
    get limitedSamples() { return lim ? lim.limitedSamples : 0; },
  };
  return self;
}

module.exports = { createNdjsonAudioParser, sniffWavFormat, buildStreamingWavHeader, createStreamProcessor };
