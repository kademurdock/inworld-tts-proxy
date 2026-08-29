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
function createStreamProcessor({ gain, knee, kneeRange, fadeInSamples }) {
  let carry = null; // a lone odd byte from the previous chunk
  let sampleIndex = 0;
  const g = typeof gain === "number" && isFinite(gain) && gain > 0 ? gain : 1.0;
  return {
    appliedGain: g,
    process(bytes) {
      let buf = carry ? Buffer.concat([carry, bytes]) : Buffer.from(bytes);
      carry = null;
      if (buf.length % 2 === 1) {
        carry = buf.slice(buf.length - 1);
        buf = buf.slice(0, buf.length - 1);
      }
      const total = buf.length >> 1;
      for (let i = 0; i < total; i++) {
        const fade = sampleIndex < fadeInSamples ? sampleIndex / fadeInSamples : 1;
        let v = buf.readInt16LE(i * 2) * g * fade;
        const a = Math.abs(v);
        if (a > knee) {
          v = Math.sign(v) * (knee + kneeRange * Math.tanh((a - knee) / kneeRange));
        }
        buf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, v))), i * 2);
        sampleIndex++;
      }
      return buf;
    },
  };
}

module.exports = { createNdjsonAudioParser, sniffWavFormat, buildStreamingWavHeader, createStreamProcessor };
