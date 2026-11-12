"use strict";
/* Phone audio codec (Nov 12 2026, gateway audit GW-3): 16-bit PCM at the provider's rate -> 8 kHz G.711 mu-law
 * for Twilio Media Streams (/v1/audio/speech?telephony=1). Its own file so telephony-codec.test.js can load it
 * without starting the server.
 * Kill switch: TTS_PHONE_DECIMATOR=box restores the old 3-sample averaging (read per call).
 * The mu-law bias change (33 -> 132) has NO env rollback: undoing it means reverting the commit. */

// ITU-T G.711 mu-law for 16-bit samples. Was BIAS 33, the 14-bit figure: about 15 dB of SNR lost at speech
// level and every sample under ~100 decoded to 0. Same constants as the bridge's encodeUlaw now.
const MULAW_BIAS = 132;
const MULAW_CLIP = 32635;
function encodeMulaw(s16) {
  let s = s16;
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exp = 7;
  for (let mask = 0x4000; !(s & mask) && exp > 0; exp--, mask >>= 1) {}
  const mantissa = (s >> (exp + 3)) & 0x0F;
  return (~(sign | (exp << 4) | mantissa)) & 0xFF;
}

function pcm16ToMulaw(pcmBuf) {
  const out = Buffer.alloc(pcmBuf.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = encodeMulaw(pcmBuf.readInt16LE(i * 2));
  }
  return out;
}

/* Anti-alias low-pass for a whole-number step down to 8 kHz: Blackman-windowed sinc, -6 dB at 3.6 kHz,
 * 16 taps per step minus one (47 taps for 24 kHz). Measured for 24 kHz: flat to 2.5 kHz, -1 dB at 3 kHz,
 * -3.6 dB at 3.4 kHz, -70 dB or better from 5 kHz up. Averaging 3 samples left 5 kHz sibilance folded onto
 * 3 kHz at -6 dB. */
const PHONE_RATE = 8000;
const phoneFirs = new Map();
function phoneFir(step) {
  let h = phoneFirs.get(step);
  if (h) return h;
  const N = 16 * step - 1, fc = 3600 / (PHONE_RATE * step);
  h = new Float64Array(N);
  let sum = 0;
  for (let n = 0; n < N; n++) {
    const m = n - (N - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    h[n] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (N - 1)));
    sum += h[n];
  }
  for (let n = 0; n < N; n++) h[n] /= sum;
  phoneFirs.set(step, h);
  return h;
}

function decimateForPhone(pcmBuf, step) {
  const fir = phoneFir(step);
  const total = pcmBuf.length >> 1;
  const outSamples = Math.floor(total / step);
  const out = Buffer.alloc(outSamples * 2);
  const half = (fir.length - 1) / 2;
  const mid = (step - 1) >> 1; // the same centre the averaging used, so timing does not move
  for (let i = 0; i < outSamples; i++) {
    const first = i * step + mid - half;
    const k0 = first < 0 ? -first : 0;
    const k1 = Math.min(fir.length, total - first);
    let acc = 0;
    for (let k = k0; k < k1; k++) acc += pcmBuf.readInt16LE((first + k) * 2) * fir[k];
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(acc))), i * 2);
  }
  return out;
}

// Mono 16-bit LE PCM, fromRate -> toRate. Whole-number steps down to 8 kHz (24 kHz, 16 kHz, 48 kHz) go
// through the filter above; any other pair, and TTS_PHONE_DECIMATOR=box, average as before.
function downsamplePcm(pcmBuf, fromRate, toRate) {
  if (fromRate === toRate) return pcmBuf;
  const ratio = fromRate / toRate;
  if (toRate === PHONE_RATE && Number.isInteger(ratio) && ratio >= 2 && ratio <= 12 && process.env.TTS_PHONE_DECIMATOR !== "box") {
    return decimateForPhone(pcmBuf, ratio);
  }
  const outSamples = Math.floor(pcmBuf.length / 2 / ratio);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const s0 = Math.floor(i * ratio);
    const s1 = Math.min(Math.floor((i + 1) * ratio), pcmBuf.length / 2);
    let sum = 0, n = 0;
    for (let j = s0; j < s1; j++) { sum += pcmBuf.readInt16LE(j * 2); n++; }
    out.writeInt16LE(n ? Math.round(sum / n) : 0, i * 2);
  }
  return out;
}

/* GW-10 (Nov 12 2026): the phone's first piece, encoded as it arrives. PCM16 mono at fromRate (a whole
 * multiple of 8000; the caller checks) in pieces of any size, odd bytes included; mu-law 8 kHz out through
 * write(). The bytes written over the whole piece equal pcm16ToMulaw(downsamplePcm(whole, fromRate, 8000))
 * exactly, so the streamed opener sounds like the buffered lane's (before its fadePcmEdges and leveling).
 * The audit's first sink downsampled each arriving piece on its own. That was exact for the old 3-sample
 * average (each output sample used only its own group) but not for GW-3's 47-tap filter: every piece edge
 * would lose half the filter and dip, a small click at every network piece. So the filter path keeps the
 * input it still needs and writes an output sample only once all of its taps have arrived (half the filter,
 * under 1 ms, behind the input); end() writes the last few, with the same zero edge the whole-clip filter
 * uses. TTS_PHONE_DECIMATOR=box (read when the sink is made) keeps the old group average. */
function createRawMulawSink(write, fromRate = 24000) {
  const step = fromRate / PHONE_RATE;
  let odd = null; // a byte left over from a piece that ended mid-sample
  const samplesOf = (pcm) => {
    let buf = pcm;
    if (odd) { buf = Buffer.concat([odd, pcm]); odd = null; }
    if (buf.length & 1) { odd = Buffer.from(buf.subarray(buf.length - 1)); buf = buf.subarray(0, buf.length - 1); }
    return buf;
  };
  const filtered = Number.isInteger(step) && step >= 2 && step <= 12 && process.env.TTS_PHONE_DECIMATOR !== "box";
  if (!filtered) {
    // Group average: an output sample is the mean of its own `step` inputs, so pieces are independent.
    const group = Math.round(step) * 2;
    let carry = Buffer.alloc(0);
    return {
      push(pcm) {
        const fresh = samplesOf(pcm);
        const buf = carry.length ? Buffer.concat([carry, fresh]) : fresh;
        const usable = buf.length - (buf.length % group);
        if (usable) write(pcm16ToMulaw(downsamplePcm(buf.subarray(0, usable), fromRate, PHONE_RATE)));
        carry = Buffer.from(buf.subarray(usable));
      },
      end() { carry = Buffer.alloc(0); odd = null; },
    };
  }
  const fir = phoneFir(step);
  const N = fir.length;
  const half = (N - 1) / 2;
  const mid = (step - 1) >> 1;
  let held = new Int16Array(0); // input samples from absolute index `base` on
  let base = 0;
  let total = 0;                // input samples received so far
  let next = 0;                 // the next output sample to write
  const outAt = (i, end) => {   // decimateForPhone's sum for output i; `end` = input length when known
    const first = i * step + mid - half;
    const k0 = first < 0 ? -first : 0;
    const k1 = end == null ? N : Math.min(N, end - first);
    let acc = 0;
    for (let k = k0; k < k1; k++) acc += held[first + k - base] * fir[k];
    return encodeMulaw(Math.max(-32768, Math.min(32767, Math.round(acc))));
  };
  return {
    push(pcm) {
      const buf = samplesOf(pcm);
      const n = buf.length >> 1;
      if (!n) return;
      const grown = new Int16Array(held.length + n);
      grown.set(held);
      for (let j = 0; j < n; j++) grown[held.length + j] = buf.readInt16LE(j * 2);
      held = grown;
      total += n;
      const out = [];
      while (next * step + mid + half < total) out.push(outAt(next++, null)); // every tap is in hand
      if (out.length) write(Buffer.from(out));
      const keepFrom = Math.max(0, next * step + mid - half); // the first input the next output needs
      if (keepFrom > base) { held = held.slice(keepFrom - base); base = keepFrom; }
    },
    end() {
      const outs = Math.floor(total / step);
      const out = [];
      while (next < outs) out.push(outAt(next++, total));
      if (out.length) write(Buffer.from(out));
      odd = null;
    },
  };
}

/* GW-10 lead review (Nov 12 2026): the buffered phone lane runs fadePcmEdges (12 ms at BOTH ends, the July 1
 * click fix); the streamed opener had only its fade-in. opts.fadeOutMs holds back that much of the input and,
 * at end(), ramps it to zero the way fadePcmEdges ramps a tail (the last sample at gain 0) before it is encoded,
 * so a clip that stops at full amplitude ends in a fade, not a step. Everything before the tail goes through
 * untouched and in order; the tail costs fadeOutMs of extra delay. A clip shorter than the tail is faded over
 * its own length. */
function createMulawSink(write, fromRate = 24000, opts = {}) {
  const inner = createRawMulawSink(write, fromRate);
  const fadeSamples = Math.round((fromRate * (Number(opts.fadeOutMs) || 0)) / 1000);
  if (!(fadeSamples > 0)) return inner;
  const keep = fadeSamples * 2;
  let tail = Buffer.alloc(0);
  return {
    push(pcm) {
      const buf = tail.length ? Buffer.concat([tail, pcm]) : pcm;
      if (buf.length <= keep) { tail = Buffer.from(buf); return; }
      let cut = buf.length - keep;
      cut -= cut & 1; // whole samples out; an odd byte stays with the tail
      inner.push(buf.subarray(0, cut));
      tail = Buffer.from(buf.subarray(cut));
    },
    end() {
      const n = tail.length >> 1;
      const out = Buffer.alloc(n * 2);
      for (let k = 0; k < n; k++) out.writeInt16LE(Math.round(tail.readInt16LE(k * 2) * ((n - 1 - k) / n)), k * 2);
      tail = Buffer.alloc(0);
      if (n) inner.push(out);
      inner.end();
    },
  };
}

module.exports = { encodeMulaw, pcm16ToMulaw, downsamplePcm, createMulawSink, MULAW_BIAS, MULAW_CLIP };
