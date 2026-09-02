"use strict";
/* Part 118: a shelf boost on a clip that already sits at full scale must never
 * flat-top. The old applyShelf clamped per sample; this proves the new one
 * scales the clip down instead and reports how far. */
const test = require("node:test");
const assert = require("node:assert");
const { applyShelf, toneMatch, applyHighPass } = require("./tone");
function tone(freq, sr, sec, amp) { const n = Math.round(sr * sec); const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * freq * i / sr)), i * 2); return b; }
test("a +3 dB low shelf on a full-scale 150 Hz tone scales instead of clipping", () => {
  const sr = 24000; const b = tone(150, sr, 0.5, 32000);
  const r = applyShelf(b, sr, "lowshelf", 300, 3);
  assert.ok(r.scaleDb < -2 && r.scaleDb > -4, `scaleDb ${r.scaleDb}`);
  let peak = 0, flat = 0, run = 0;
  for (let i = 0; i < b.length >> 1; i++) { const a = Math.abs(b.readInt16LE(i * 2)); if (a > peak) peak = a; if (a >= 32767) { run++; if (run >= 3) flat++; } else run = 0; }
  assert.ok(peak <= 32767); assert.equal(flat, 0, "no flat tops");
});
test("a cut never scales", () => {
  const sr = 24000; const b = tone(150, sr, 0.5, 32000);
  const r = applyShelf(b, sr, "lowshelf", 300, -3);
  assert.equal(r.scaleDb, 0);
});
test("per-shelf boost caps: lowBoost 0 means a thin clip is left alone on the low side", () => {
  const sr = 24000; const b = tone(1000, sr, 0.5, 8000); // all mid, no low: measured low/mid far under target
  const note = toneMatch(b, sr, { lowTargetDb: -2, highTargetDb: -13.5, deadbandDb: 3, maxCutDb: 4, maxBoostDb: 3, maxLowBoostDb: 0, maxHighBoostDb: 0, lowShelfHz: 300, highShelfHz: 3000 });
  assert.equal(note, "");
});
test("the 80 Hz rumble filter removes a 40 Hz tone and leaves 1 kHz alone", () => {
  const sr = 24000;
  const low = tone(40, sr, 1, 10000); applyHighPass(low, sr, 80);
  const mid = tone(1000, sr, 1, 10000); applyHighPass(mid, sr, 80);
  const rms = (b) => { let e = 0; const n = b.length >> 1; for (let i = n >> 1; i < n; i++) { const v = b.readInt16LE(i * 2); e += v * v; } return Math.sqrt(e / (n >> 1)); };
  assert.ok(rms(low) < 10000 / Math.SQRT2 * 0.35, `40 Hz left ${rms(low)}`);
  assert.ok(rms(mid) > 10000 / Math.SQRT2 * 0.9, `1 kHz kept ${rms(mid)}`);
});
