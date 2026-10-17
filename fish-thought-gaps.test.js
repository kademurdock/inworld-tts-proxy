'use strict';
/* Oct 17 2026 — Kade: Fish has "pauses, but not silences, just inflectional ones" after thoughts.
 * Inside one request Drama3 stops 0.75-1.15 s between sentences, but each clip ends with only
 * 0.07-0.35 s and the apps play clips back to back, so a thought's end got the shortest stop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fishThoughtGapMs, padFishTail, FISH_PACES } = require('./pace');

const RATE = 24000;
function clip(parts) {
  const out = [];
  for (const [kind, ms] of parts) {
    const n = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < n; i++) out.push(kind === 'tone' ? Math.round(8000 * Math.sin(i / 3)) : (i % 2 ? 20 : -20));
  }
  return Buffer.from(new Int16Array(out).buffer);
}
const ms = (buf) => (buf.length / 2 / RATE) * 1000;

test('every pace has a thought gap, slower paces longer, and the switch turns it off', () => {
  const gaps = FISH_PACES.map((p) => fishThoughtGapMs(p.value));
  assert.deepEqual(gaps, [...gaps].sort((a, b) => b - a));
  assert.ok(gaps.every((g) => g >= 500));
  assert.equal(fishThoughtGapMs(undefined), fishThoughtGapMs(1));
  process.env.FISH_THOUGHT_GAPS = '0';
  try {
    assert.equal(fishThoughtGapMs(1), 0);
    const src = clip([['tone', 400], ['gap', 50]]);
    assert.equal(padFishTail(src, 1, RATE), src);
  } finally {
    delete process.env.FISH_THOUGHT_GAPS;
  }
});

test('a clip that ends abruptly gets silence up to the gap; speech is untouched', () => {
  const src = clip([['gap', 60], ['tone', 800], ['gap', 120]]);
  for (const rate of [1, 1.2, 1.5, 0.75]) {
    const out = padFishTail(src, rate, RATE);
    const want = fishThoughtGapMs(rate) - 80;
    assert.ok(Math.abs(ms(out) - ms(src) - (want - 120)) <= 12, `rate ${rate}: added ${ms(out) - ms(src)} ms`);
    assert.ok(out.subarray(0, src.length).equals(src), 'the original samples come first, unchanged');
    assert.ok(out.subarray(src.length).every((b) => b === 0), 'only digital silence is added');
  }
});

test('a clip that already ends on a long stop, and tiny or silent clips, are left alone', () => {
  const long = clip([['tone', 600], ['gap', 1200]]);
  assert.equal(padFishTail(long, 1, RATE), long);
  assert.equal(padFishTail(Buffer.alloc(2), 1, RATE).length, 2);
  const silent = clip([['gap', 300]]);
  assert.equal(padFishTail(silent, 1, RATE), silent);
});
