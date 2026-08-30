/* tts-context.test.js — Part 99 (Aug 30 2026). The speech-context budget.
 *
 * The red proof this suite is built around: THREE 700-CHARACTER PIECES, which
 * is an ordinary long reply and exactly the shape that was 400ing in
 * production. Under the old code (count cap only) all three went out, 2,100
 * characters, and Inworld killed the synthesis. */
const test = require('node:test');
const assert = require('node:assert');
const { fitContextBudget, totalChars, DEFAULT_BUDGET } = require('./tts-context');

const piece = (n, c = 'x') => c.repeat(n);

test('the production failure: three 700-char pieces now fit under 2000', () => {
  const input = [piece(700, 'a'), piece(700, 'b'), piece(700, 'c')];
  assert.strictEqual(totalChars(input), 2100, 'fixture must exceed the provider cap');
  const out = fitContextBudget(input);
  assert.ok(totalChars(out) <= DEFAULT_BUDGET, 'must fit the budget');
  assert.ok(totalChars(out) <= 2000, 'must fit the PROVIDER cap, which is the whole point');
});

test('the OLDEST piece is the one that falls off, never the newest', () => {
  const out = fitContextBudget([piece(700, 'a'), piece(700, 'b'), piece(700, 'c')]);
  assert.strictEqual(out.length, 2);
  assert.ok(out[out.length - 1].startsWith('c'), 'the piece nearest in time survives whole');
  assert.ok(out[0].startsWith('b'), 'the middle piece survives whole');
  assert.ok(!out.some((t) => t.startsWith('a')), 'the oldest is dropped');
});

test('order is preserved: oldest first, newest last', () => {
  const out = fitContextBudget(['one', 'two', 'three']);
  assert.deepStrictEqual(out, ['one', 'two', 'three']);
});

test('under budget passes through untouched — no trimming when none is needed', () => {
  const input = ['short one.', 'short two.', 'short three.'];
  assert.deepStrictEqual(fitContextBudget(input), input);
});

test('a single over-budget piece keeps its TAIL, not its head', () => {
  const long = piece(1000, 'q') + 'THE-LAST-WORDS-SPOKEN';
  const out = fitContextBudget([long], 100);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].length, 100);
  assert.ok(out[0].endsWith('THE-LAST-WORDS-SPOKEN'), 'the tail is what shapes the next chunk');
});

test('an older piece that does not fit is dropped WHOLE, never torn in half', () => {
  // newest fits with 30 chars to spare; the older piece is 200 chars.
  const out = fitContextBudget([piece(200, 'a'), piece(70, 'b')], 100);
  assert.strictEqual(out.length, 1, 'only the newest survives');
  assert.ok(out[0].startsWith('b'));
});

test('exactly at the budget is allowed — an off-by-one here re-creates the bug', () => {
  const out = fitContextBudget([piece(100, 'a')], 100);
  assert.strictEqual(totalChars(out), 100);
});

test('one char over the budget is not', () => {
  const out = fitContextBudget([piece(101, 'a')], 100);
  assert.strictEqual(totalChars(out), 100, 'truncated to fit, not passed through');
});

test('empty, null and junk inputs return an empty list, never throw', () => {
  assert.deepStrictEqual(fitContextBudget([]), []);
  assert.deepStrictEqual(fitContextBudget(null), []);
  assert.deepStrictEqual(fitContextBudget(undefined), []);
  assert.deepStrictEqual(fitContextBudget(['', null, undefined]), []);
});

test('a bad budget falls back to the default instead of returning nothing', () => {
  const out = fitContextBudget(['hello'], 0);
  assert.deepStrictEqual(out, ['hello'], 'zero must not silently disable context');
  assert.deepStrictEqual(fitContextBudget(['hello'], -5), ['hello']);
  assert.deepStrictEqual(fitContextBudget(['hello'], NaN), ['hello']);
});

test('the default budget leaves headroom under the provider cap of 2000', () => {
  assert.ok(DEFAULT_BUDGET < 2000, 'the provider counts something we do not; leave room');
  assert.ok(DEFAULT_BUDGET >= 1500, 'but not so much room that context stops being useful');
});

test('totalChars counts what the provider counts', () => {
  assert.strictEqual(totalChars(['ab', 'cde']), 5);
  assert.strictEqual(totalChars([]), 0);
  assert.strictEqual(totalChars(null), 0);
});
