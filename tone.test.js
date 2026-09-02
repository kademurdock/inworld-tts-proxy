'use strict';
/* Part 117.4: tone match. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { measureTone, applyShelf, shelfCorrection, toneMatch } = require('./tone');
const SR = 24000;
function pcmOf(samples) { const b = Buffer.alloc(samples.length * 2); samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, v))), i * 2)); return b; }
function tones(n, parts) { return Array.from({ length: n }, (_, i) => parts.reduce((s, [hz, amp]) => s + amp * Math.sin((2 * Math.PI * hz * i) / SR), 0)); }
const CFG = { lowTargetDb: -2, highTargetDb: -13.5, deadbandDb: 2.5, maxCutDb: 4, maxBoostDb: 3, lowShelfHz: 200, highShelfHz: 4500 };

test('measureTone ranks a bassy mix above a thin one and a bright mix above a dull one', () => {
  const bassy = measureTone(pcmOf(tones(SR, [[150, 8000], [800, 6000], [6000, 1000]])), SR);
  const thin = measureTone(pcmOf(tones(SR, [[150, 1000], [800, 6000], [6000, 1000]])), SR);
  const bright = measureTone(pcmOf(tones(SR, [[150, 2000], [800, 6000], [6000, 6000]])), SR);
  assert.ok(bassy.lowDb > thin.lowDb + 6, `${bassy.lowDb} vs ${thin.lowDb}`);
  assert.ok(bright.highDb > thin.highDb + 6, `${bright.highDb} vs ${thin.highDb}`);
});

test('shelfCorrection: nothing inside the deadband, cuts up to 4, boosts up to 3', () => {
  assert.equal(shelfCorrection(-1, -2, CFG), 0);
  assert.equal(shelfCorrection(0.4, -2, CFG), 0);
  assert.ok(Math.abs(shelfCorrection(2, -2, CFG) - -1.5) < 1e-9);
  assert.equal(shelfCorrection(20, -2, CFG), -4);
  assert.equal(shelfCorrection(-20, -2, CFG), 3);
});

test('a low-shelf cut lowers the low band and leaves the mids alone; a high-shelf boost raises the highs', () => {
  const x = tones(SR, [[150, 6000], [800, 6000], [6000, 3000]]);
  const a = pcmOf(x); applyShelf(a, SR, 'lowshelf', 200, -4);
  const before = measureTone(pcmOf(x), SR), after = measureTone(a, SR);
  assert.ok(after.lowDb < before.lowDb - 2.5, `low moved: ${before.lowDb} -> ${after.lowDb}`);
  assert.ok(Math.abs(after.highDb - before.highDb) < 0.5, 'highs untouched by a low shelf');
  const b = pcmOf(x); applyShelf(b, SR, 'highshelf', 4500, 3);
  const after2 = measureTone(b, SR);
  assert.ok(after2.highDb > before.highDb + 2, `high moved: ${before.highDb} -> ${after2.highDb}`);
});

test('toneMatch leaves an on-target clip untouched and moves an outlier toward the target, with a log note', () => {
  // build a clip near the reference by construction: measure, then choose amplitudes
  const x = tones(SR, [[150, 4500], [800, 6000], [6000, 1300]]);
  const t = measureTone(pcmOf(x), SR);
  const cfg = { ...CFG, lowTargetDb: t.lowDb, highTargetDb: t.highDb };
  const a = pcmOf(x); const note = toneMatch(a, SR, cfg);
  assert.equal(note, '');
  assert.ok(a.equals(pcmOf(x)), 'bytes untouched');
  const bassy = pcmOf(tones(SR, [[150, 20000], [800, 6000], [6000, 1300]]));
  const before = measureTone(bassy, SR);
  const note2 = toneMatch(bassy, SR, cfg);
  assert.match(note2, /tone low -\d/);
  assert.ok(measureTone(bassy, SR).lowDb < before.lowDb, 'pulled toward target');
});
