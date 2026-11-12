"use strict";
/**
 * tone.js — TONE MATCH (Part 117.4, Sep 2 2026)
 *
 * Her words, after the de-harsh shelf was built and left off: "I like the idea
 * of the shelf, but it seems like a couple of the voices are too bassy as
 * well, so it probably needs to be something covering more."
 *
 * So this is a two-shelf tone match, not a de-harsher. Every clip is measured
 * in three bands — low (80–250 Hz), mid (300–2000 Hz), high (4–8 kHz) — and
 * its low/mid and high/mid balance is compared to a reference. Inside the
 * deadband nothing happens (most voices). Outside it, a low shelf at 300 Hz
 * and/or a high shelf at 3 kHz pull the clip PART of the way back, capped.
 * (Corners sit at the band edges on purpose: a dry run with 200 Hz / 4.5 kHz
 * moved the estimator by only a third of the shelf's dB.)
 * Cuts may go further than boosts: boosting lows on a thin voice adds rumble
 * and boosting highs on a dull one adds hiss, so boosts stop at 3 dB.
 *
 * REFERENCE, measured Sep 2 2026 on eight Inworld voices through the proxy
 * (the sound she has lived with for two months): low/mid median -2.6 dB,
 * high/mid median -16.8 dB — with a spread of -9 to +6 on low and -7 to -26
 * on high. Fish clones ran -13 to -2 on low and -26 to -10 on high. The
 * deadband is 3 dB (on this estimator's compressed scale) so only the outliers move, and a voice she already knows
 * keeps its character.
 *
 * Measurement is three RBJ band-pass biquads (no FFT in Node without a
 * dependency); the targets below were calibrated with THIS estimator on
 * those clips, so estimator and target agree by construction.
 */

const { inSlices, sliceSamplesFor } = require("./slices");

function biquadCoeffs(type, fc, sampleRate, { gainDb = 0, bwOct = 1 } = {}) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "bpf") {
    const alpha = sin * Math.sinh(((Math.LN2 / 2) * bwOct * w0) / sin);
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    const alpha = (sin / 2) * Math.sqrt(2); // shelf slope 1 (Q = 1/sqrt2)
    const sq = 2 * Math.sqrt(A) * alpha;
    if (type === "highshelf") {
      b0 = A * ((A + 1) + (A - 1) * cos + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - sq);
      a0 = (A + 1) - (A - 1) * cos + sq; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - sq;
    } else { // lowshelf
      b0 = A * ((A + 1) - (A - 1) * cos + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - sq);
      a0 = (A + 1) + (A - 1) * cos + sq; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/* GW-13 (Nov 12 2026): every per-sample pass below is a RANGE function that carries its own filter state, so
 * the same arithmetic serves the one-piece call (tests, the lab) and the sliced call that gives the event loop
 * a turn every few seconds of audio (slices.js). Same operations in the same order: same bytes. */
function bandEnergyRange(pcmBuf, c, st, from, to) {
  let x1 = st.x1, x2 = st.x2, y1 = st.y1, y2 = st.y2, e = st.e;
  for (let i = from; i < to; i++) {
    const x = pcmBuf.readInt16LE(i * 2) / 32768;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    e += y * y;
  }
  st.x1 = x1; st.x2 = x2; st.y1 = y1; st.y2 = y2; st.e = e;
}

function bandEnergy(pcmBuf, sampleRate, fc, bwOct) {
  const c = biquadCoeffs("bpf", fc, sampleRate, { bwOct });
  const st = { x1: 0, x2: 0, y1: 0, y2: 0, e: 0 };
  bandEnergyRange(pcmBuf, c, st, 0, pcmBuf.length >> 1);
  return st.e;
}

async function bandEnergyAsync(pcmBuf, sampleRate, fc, bwOct) {
  const c = biquadCoeffs("bpf", fc, sampleRate, { bwOct });
  const st = { x1: 0, x2: 0, y1: 0, y2: 0, e: 0 };
  await inSlices(pcmBuf.length >> 1, sliceSamplesFor(sampleRate), (from, to) => bandEnergyRange(pcmBuf, c, st, from, to));
  return st.e;
}

// low (80–250 Hz), mid (300–2000 Hz), high (4–8 kHz): centre frequency and width in octaves
const TONE_BANDS = [
  [Math.sqrt(80 * 250), Math.log2(250 / 80)],
  [Math.sqrt(300 * 2000), Math.log2(2000 / 300)],
  [Math.sqrt(4000 * 8000), Math.log2(8000 / 4000)],
];
function toneOfBands(low, mid, high) {
  if (mid <= 0) return null;
  return { lowDb: 10 * Math.log10(low / mid + 1e-12), highDb: 10 * Math.log10(high / mid + 1e-12) };
}

/** {lowDb, highDb}: low(80–250)/mid(300–2000) and high(4–8k)/mid, in dB. */
function measureTone(pcmBuf, sampleRate) {
  const total = pcmBuf.length >> 1;
  if (total < sampleRate / 4) return null;
  const [low, mid, high] = TONE_BANDS.map(([fc, bw]) => bandEnergy(pcmBuf, sampleRate, fc, bw));
  return toneOfBands(low, mid, high);
}

async function measureToneAsync(pcmBuf, sampleRate) {
  const total = pcmBuf.length >> 1;
  if (total < sampleRate / 4) return null;
  const e = [];
  for (const [fc, bw] of TONE_BANDS) e.push(await bandEnergyAsync(pcmBuf, sampleRate, fc, bw));
  return toneOfBands(e[0], e[1], e[2]);
}

/** In-place shelf. type = "lowshelf" | "highshelf".
 * Part 118 (Sep 2 2026): the first version wrote each sample back with a hard
 * clamp at full scale. A BOOST on a clip whose raw peaks already sit near full
 * scale (fish clones arrive at 30-31k; Inworld's Brian at -0.03 dBFS) would
 * have flat-topped the loudest samples right here, before the limiter ever
 * saw them -- a hard clip dressed as EQ. Now the shelf runs in floats and, if
 * the result would exceed full scale, the whole clip is scaled down to fit
 * (returned as `scaleDb`, so the caller can log it); the loudness stage that
 * follows measures the scaled clip and gives the level back. Nothing clips.
 * GW-13 (Nov 12 2026): the floats used to be KEPT, in a Float64Array as long
 * as the clip (8 bytes a sample: 726 MB for an hour of speech, per shelf).
 * Now pass 1 runs the filter only to find the peak, and pass 2 runs the same
 * filter again and writes in place. Each sample is read before it is written
 * and the filter keeps its own copies of the two inputs before it, so the
 * bytes are the ones the kept-floats version wrote (tone.test.js proves it). */
function shelfPeakRange(pcmBuf, c, st, from, to) {
  let x1 = st.x1, x2 = st.x2, y1 = st.y1, y2 = st.y2, peak = st.peak;
  for (let i = from; i < to; i++) {
    const x = pcmBuf.readInt16LE(i * 2);
    const v = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  st.x1 = x1; st.x2 = x2; st.y1 = y1; st.y2 = y2; st.peak = peak;
}
function shelfWriteRange(pcmBuf, c, st, scale, from, to) {
  let x1 = st.x1, x2 = st.x2, y1 = st.y1, y2 = st.y2;
  for (let i = from; i < to; i++) {
    const x = pcmBuf.readInt16LE(i * 2); // read before this sample is overwritten
    const v = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = v;
    pcmBuf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, v * scale))), i * 2);
  }
  st.x1 = x1; st.x2 = x2; st.y1 = y1; st.y2 = y2;
}
const shelfScaleOf = (peak) => (peak > 32767 ? 32767 / peak : 1);
const shelfResult = (scale) => ({ scaleDb: scale < 1 ? 20 * Math.log10(scale) : 0 });

function applyShelf(pcmBuf, sampleRate, type, fc, gainDb) {
  const c = biquadCoeffs(type, fc, sampleRate, { gainDb });
  const total = pcmBuf.length >> 1;
  const st = { x1: 0, x2: 0, y1: 0, y2: 0, peak: 0 };
  shelfPeakRange(pcmBuf, c, st, 0, total);
  const scale = shelfScaleOf(st.peak);
  shelfWriteRange(pcmBuf, c, { x1: 0, x2: 0, y1: 0, y2: 0 }, scale, 0, total);
  return shelfResult(scale);
}

async function applyShelfAsync(pcmBuf, sampleRate, type, fc, gainDb) {
  const c = biquadCoeffs(type, fc, sampleRate, { gainDb });
  const total = pcmBuf.length >> 1;
  const slice = sliceSamplesFor(sampleRate);
  const st = { x1: 0, x2: 0, y1: 0, y2: 0, peak: 0 };
  await inSlices(total, slice, (from, to) => shelfPeakRange(pcmBuf, c, st, from, to));
  const scale = shelfScaleOf(st.peak);
  const wr = { x1: 0, x2: 0, y1: 0, y2: 0 };
  await inSlices(total, slice, (from, to) => shelfWriteRange(pcmBuf, c, wr, scale, from, to));
  return shelfResult(scale);
}

/** How far to move, given a measurement, a target and the rules above. */
function shelfCorrection(measuredDb, targetDb, { deadbandDb, maxCutDb, maxBoostDb }) {
  const excess = measuredDb - targetDb;
  if (Math.abs(excess) <= deadbandDb) return 0;
  const beyond = Math.abs(excess) - deadbandDb;
  if (beyond < 0.05) return 0;
  return excess > 0 ? -Math.min(maxCutDb, beyond) : Math.min(maxBoostDb, beyond);
}

/** What to move, given a measurement. Part 118: boosts may be capped separately per shelf
 * (cfg.maxLowBoostDb / cfg.maxHighBoostDb, default = cfg.maxBoostDb). The lab presets use it to
 * audition a cut-only tone match. */
function tonePlan(t, cfg) {
  const lowCfg = { ...cfg, maxBoostDb: cfg.maxLowBoostDb != null ? cfg.maxLowBoostDb : cfg.maxBoostDb };
  const highCfg = { ...cfg, maxBoostDb: cfg.maxHighBoostDb != null ? cfg.maxHighBoostDb : cfg.maxBoostDb };
  return { lowFix: shelfCorrection(t.lowDb, cfg.lowTargetDb, lowCfg), highFix: shelfCorrection(t.highDb, cfg.highTargetDb, highCfg) };
}
function toneNote(t, { lowFix, highFix }, scaled) {
  const notes = [];
  if (lowFix) notes.push(`low ${lowFix > 0 ? "+" : ""}${lowFix.toFixed(1)} dB (was ${t.lowDb.toFixed(1)})`);
  if (highFix) notes.push(`high ${highFix > 0 ? "+" : ""}${highFix.toFixed(1)} dB (was ${t.highDb.toFixed(1)})`);
  if (scaled < -0.05) notes.push(`shelf headroom ${scaled.toFixed(1)} dB`);
  return notes.length ? `, tone ${notes.join(", ")}` : "";
}

/**
 * Measure, decide, apply. Returns a note for the log or "" when untouched.
 */
function toneMatch(pcmBuf, sampleRate, cfg) {
  const t = measureTone(pcmBuf, sampleRate);
  if (!t) return "";
  const plan = tonePlan(t, cfg);
  let scaled = 0;
  if (plan.lowFix) scaled += applyShelf(pcmBuf, sampleRate, "lowshelf", cfg.lowShelfHz, plan.lowFix).scaleDb;
  if (plan.highFix) scaled += applyShelf(pcmBuf, sampleRate, "highshelf", cfg.highShelfHz, plan.highFix).scaleDb;
  return toneNote(t, plan, scaled);
}

/** toneMatch for the request path (GW-13): the same passes, a few seconds of audio at a time. */
async function toneMatchAsync(pcmBuf, sampleRate, cfg) {
  const t = await measureToneAsync(pcmBuf, sampleRate);
  if (!t) return "";
  const plan = tonePlan(t, cfg);
  let scaled = 0;
  if (plan.lowFix) scaled += (await applyShelfAsync(pcmBuf, sampleRate, "lowshelf", cfg.lowShelfHz, plan.lowFix)).scaleDb;
  if (plan.highFix) scaled += (await applyShelfAsync(pcmBuf, sampleRate, "highshelf", cfg.highShelfHz, plan.highFix)).scaleDb;
  return toneNote(t, plan, scaled);
}

/** Part 118: one-pole high-pass (rumble filter) for the lab's "lean" preset.
 * Small speakers turn 40-80 Hz into buzz they cannot reproduce; this removes
 * it before the loudness stage. Two passes = 12 dB/oct. */
function applyHighPass(pcmBuf, sampleRate, fc) {
  const total = pcmBuf.length >> 1;
  const rc = 1 / (2 * Math.PI * fc), dt = 1 / sampleRate, a = rc / (rc + dt);
  const y = new Float64Array(total);
  for (let i = 0; i < total; i++) y[i] = pcmBuf.readInt16LE(i * 2);
  for (let pass = 0; pass < 2; pass++) {
    let prevX = y[0], prevY = 0;
    for (let i = 0; i < total; i++) { const x = y[i]; prevY = a * (prevY + x - prevX); prevX = x; y[i] = prevY; }
  }
  for (let i = 0; i < total; i++) pcmBuf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, y[i]))), i * 2);
}

module.exports = { measureTone, measureToneAsync, applyShelf, applyShelfAsync, shelfCorrection, toneMatch, toneMatchAsync, applyHighPass, biquadCoeffs };
