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

function bandEnergy(pcmBuf, sampleRate, fc, bwOct) {
  const c = biquadCoeffs("bpf", fc, sampleRate, { bwOct });
  const total = pcmBuf.length >> 1;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0;
  for (let i = 0; i < total; i++) {
    const x = pcmBuf.readInt16LE(i * 2) / 32768;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    e += y * y;
  }
  return e;
}

/** {lowDb, highDb}: low(80–250)/mid(300–2000) and high(4–8k)/mid, in dB. */
function measureTone(pcmBuf, sampleRate) {
  const total = pcmBuf.length >> 1;
  if (total < sampleRate / 4) return null;
  const low = bandEnergy(pcmBuf, sampleRate, Math.sqrt(80 * 250), Math.log2(250 / 80));
  const mid = bandEnergy(pcmBuf, sampleRate, Math.sqrt(300 * 2000), Math.log2(2000 / 300));
  const high = bandEnergy(pcmBuf, sampleRate, Math.sqrt(4000 * 8000), Math.log2(8000 / 4000));
  if (mid <= 0) return null;
  return { lowDb: 10 * Math.log10(low / mid + 1e-12), highDb: 10 * Math.log10(high / mid + 1e-12) };
}

/** In-place shelf. type = "lowshelf" | "highshelf". */
function applyShelf(pcmBuf, sampleRate, type, fc, gainDb) {
  const c = biquadCoeffs(type, fc, sampleRate, { gainDb });
  const total = pcmBuf.length >> 1;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < total; i++) {
    const x = pcmBuf.readInt16LE(i * 2);
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    pcmBuf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, y))), i * 2);
  }
}

/** How far to move, given a measurement, a target and the rules above. */
function shelfCorrection(measuredDb, targetDb, { deadbandDb, maxCutDb, maxBoostDb }) {
  const excess = measuredDb - targetDb;
  if (Math.abs(excess) <= deadbandDb) return 0;
  const beyond = Math.abs(excess) - deadbandDb;
  if (beyond < 0.05) return 0;
  return excess > 0 ? -Math.min(maxCutDb, beyond) : Math.min(maxBoostDb, beyond);
}

/**
 * Measure, decide, apply. Returns a note for the log or "" when untouched.
 */
function toneMatch(pcmBuf, sampleRate, cfg) {
  const t = measureTone(pcmBuf, sampleRate);
  if (!t) return "";
  const lowFix = shelfCorrection(t.lowDb, cfg.lowTargetDb, cfg);
  const highFix = shelfCorrection(t.highDb, cfg.highTargetDb, cfg);
  const notes = [];
  if (lowFix) { applyShelf(pcmBuf, sampleRate, "lowshelf", cfg.lowShelfHz, lowFix); notes.push(`low ${lowFix > 0 ? "+" : ""}${lowFix.toFixed(1)} dB (was ${t.lowDb.toFixed(1)})`); }
  if (highFix) { applyShelf(pcmBuf, sampleRate, "highshelf", cfg.highShelfHz, highFix); notes.push(`high ${highFix > 0 ? "+" : ""}${highFix.toFixed(1)} dB (was ${t.highDb.toFixed(1)})`); }
  return notes.length ? `, tone ${notes.join(", ")}` : "";
}

module.exports = { measureTone, applyShelf, shelfCorrection, toneMatch, biquadCoeffs };
