"use strict";
/* Phone audio codec (Nov 12 2026, gateway audit GW-3): 16-bit PCM at the provider's rate -> 8 kHz G.711 mu-law
 * for Twilio Media Streams (/v1/audio/speech?telephony=1). Its own file so telephony-codec.test.js can load it
 * without starting the server.
 * Kill switch: TTS_PHONE_DECIMATOR=box restores the old 3-sample averaging (read per call). */

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

module.exports = { encodeMulaw, pcm16ToMulaw, downsamplePcm, MULAW_BIAS, MULAW_CLIP };
