'use strict';
// Oct 16 2026: Brisk and Quick speed Fish up without stretching the words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fishPace, fishPacedText, fishSentencePauses, capFishPauses } = require('./pace');

const RATE = 24000;
// tone(ms) is loud speech-like audio, gap(ms) is near-silence.
function clip(parts) {
  const out = [];
  for (const [kind, ms] of parts) {
    const n = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < n; i++) out.push(kind === 'tone' ? Math.round(8000 * Math.sin(i / 3)) : (i % 2 ? 20 : -20));
  }
  return Buffer.from(new Int16Array(out).buffer);
}
const ms = buf => (buf.length / 2 / RATE) * 1000;

test('Brisk and Quick skip the added sentence pauses; slower paces keep them', () => {
  assert.equal(fishSentencePauses(1), true);
  assert.equal(fishSentencePauses(undefined), true);
  assert.equal(fishSentencePauses(0.75), true);
  assert.equal(fishSentencePauses(0.9), true);
  assert.equal(fishSentencePauses(1.2), false);
  assert.equal(fishSentencePauses(1.5), false);
  assert.equal(fishSentencePauses(1.25), false, 'old clients sending 1.25 get Brisk');
});

test('Brisk and Quick wording asks for speed, with no numeric promise', () => {
  assert.match(fishPacedText('Hi.', 1.2), /^\[speaking quickly/);
  assert.match(fishPacedText('Hi.', 1.5), /^\[fast-talking/);
  assert.equal(fishPacedText('Hi.', 1), 'Hi.');
  for (const rate of [1.2, 1.5]) assert.doesNotMatch(fishPace(rate).direction, /\d|percent/);
});

test('long silences inside a clip are shortened to the pace cap; speech is untouched', () => {
  const src = clip([['gap', 200], ['tone', 500], ['gap', 900], ['tone', 400], ['gap', 150], ['tone', 300], ['gap', 300]]);
  const brisk = capFishPauses(src, 1.2, RATE);
  const quick = capFishPauses(src, 1.5, RATE);
  // 900 ms gap -> 300 (Brisk) / 200 (Quick); 150 ms gap stays; edges stay.
  assert.ok(Math.abs(ms(src) - ms(brisk) - 600) <= 10, `brisk removed ${ms(src) - ms(brisk)} ms`);
  assert.ok(Math.abs(ms(src) - ms(quick) - 700) <= 10, `quick removed ${ms(src) - ms(quick)} ms`);
  // The loud samples survive byte for byte: count samples above the tone threshold.
  const loud = buf => new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2).filter(v => Math.abs(v) > 1000).length;
  assert.equal(loud(brisk), loud(src));
  assert.equal(loud(quick), loud(src));
});

test('Natural and slower paces, and silent or tiny clips, are returned as they are', () => {
  const src = clip([['tone', 300], ['gap', 900], ['tone', 300]]);
  for (const rate of [1, 0.9, 0.75, undefined]) assert.equal(capFishPauses(src, rate, RATE), src);
  const silent = clip([['gap', 500]]);
  assert.equal(capFishPauses(silent, 1.5, RATE).length, silent.length);
  assert.equal(capFishPauses(Buffer.alloc(2), 1.5, RATE).length, 2);
});
