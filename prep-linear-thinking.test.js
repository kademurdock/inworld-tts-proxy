'use strict';
// Nov 7 2026 (follow-up of prep-linear.test.js): stripThinkingBlock cut everything between an opener and its closer with three
// lazy patterns,
//   /:::thinking[\s\S]*?:::\n?/g    /<think>[\s\S]*?<\/think>\n?/g    /<private-use U+F001>[\s\S]*?<private-use U+F002>/g
// and each tried every opener of the text and, for every one with no closer after it, read on to the end of the text: many
// unclosed openers cost the SQUARE of the text (149,000 of U+F001: 6 seconds; of "<think>": 24 seconds). dropBetween looks for
// the closer with indexOf, and gives up for good at the first opener that has none (no later opener can have one either).
// The real function is sliced out of server.js (never a copy). The old patterns are kept here as the oracle the new code is
// fuzzed against, and a clock test pins each shape: 149,000 characters, well under a second.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
function between(a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  assert.ok(i > -1 && j > i, `server.js no longer holds ${a} .. ${b}`);
  return src.slice(i, j);
}
const ctx = { process: { env: {} }, console };
vm.createContext(ctx);
vm.runInContext([
  between('function dropBetween', '// ── Spoken-text normalizer'),      // dropBetween, stripThinkingBlock and the markdown and citation helpers
  'this.fns = { stripThinkingBlock };',
].join('\n'), ctx);
const { stripThinkingBlock } = ctx.fns;

const A = String.fromCharCode(0xf001), Z = String.fromCharCode(0xf002);   // the private-use markers around reasoning text

// ── the oracle: the function as it was before the fix ────────────────────────────────────────────────────────────────
const OLD_PRIVATE_USE = new RegExp(A + '[\\s\\S]*?' + Z, 'g');   // the third old pattern, with the two markers (written as escapes in server.js)
const oldStrip = (text) => {
  if (!text) return text;
  return text
    .replace(/:::thinking[\s\S]*?:::\n?/g, '')
    .replace(/<think>[\s\S]*?<\/think>\n?/g, '')
    .replace(OLD_PRIVATE_USE, '')
    .trim();
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const LIMIT_MS = 1000;   // the fixed code needs a few milliseconds; the old one needed seconds
function clock(label, fn) {
  let ms = Infinity;
  let out;
  for (let attempt = 0; attempt < 3 && ms >= LIMIT_MS; attempt++) {   // a stalled machine is not a slow rule: a slow rule is slow every time
    const t0 = process.hrtime.bigint();
    out = fn();
    ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
    if (ms >= 20 * LIMIT_MS) break;   // seconds: the square of the text, no second chance
  }
  assert.ok(ms < LIMIT_MS, `${label} took ${ms.toFixed(0)} ms`);
  return out;
}
const BIG = 149000;
const rep = (unit, n = BIG) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

test('reasoning blocks are cut out as they always were', () => {
  for (const [input, want] of [
    [':::thinking\nI should say hello\n:::\nHello there', 'Hello there'],
    ['<think>reasoning</think>\nAnswer', 'Answer'],
    [A + 'reasoning' + Z + 'Answer', 'Answer'],
    ['One <think>a</think> two :::thinking b::: three ' + A + 'c' + Z + ' four', 'One  two  three  four'],
    ['Answer <think>never closed', 'Answer <think>never closed'],                  // an opener with no closer stays
    ['Answer ' + A + 'never closed', 'Answer ' + A + 'never closed'],
    ['Answer :::thinking never closed', 'Answer :::thinking never closed'],
    ['</think> and ' + Z + ' and ::: stay', '</think> and ' + Z + ' and ::: stay'],   // a closer with no opener stays
    [':::thinking:::', ''],
    [':::thinking:::thinking', 'thinking'],                                           // the closer is looked for from the end of the opener, and is the first ":::"
    ['<think></think>', ''],
    ['<think>a<think>b</think>c</think>d', 'c</think>d'],                             // not nested: the first closer ends the block
    ['A :::thinking x:::\nB', 'A B'],                                                 // the line break after a closer goes with it
    ['A <think>x</think>\nB', 'A B'],
    ['A' + A + 'x' + Z + '\nB', 'A\nB'],                                              // but not after the private-use closer
    ['A :::thinking x::: \nB', 'A  \nB'],
    ['  hello  ', 'hello'],
    ['', ''],
  ]) {
    assert.equal(oldStrip(input), want, 'the oracle agrees: ' + JSON.stringify(input));
    assert.equal(stripThinkingBlock(input), want, JSON.stringify(input));
  }
  assert.equal(stripThinkingBlock(undefined), undefined);
  assert.equal(stripThinkingBlock(null), null);
});

test('thinking: the indexOf scan matches the old patterns on every string up to five tokens of a small alphabet', () => {
  const tokens = ['a', '\n', ':::thinking', ':::', '<think>', '</think>', A, Z, ' ', ':', '<'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = stripThinkingBlock(prefix), want = oldStrip(prefix);   // compared first: the message is built only for a mismatch
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 5);
  assert.ok(checked > 177000, `checked ${checked}`);
});

test('thinking: the indexOf scan matches the old patterns on every string up to six tokens of the markers alone', () => {
  const tokens = ['a', '\n', ':::thinking', ':::', '<think>', '</think>', A, Z];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = stripThinkingBlock(prefix), want = oldStrip(prefix);   // compared first: the message is built only for a mismatch
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 299000, `checked ${checked}`);
});

test('thinking: the indexOf scan matches the old patterns on 200,000 random texts with reasoning in them', () => {
  const r = rng(20261107);
  const pieces = ['a', 'word ', ' ', '\n', '\n\n', ':::thinking', ':::thinking\n', ':::', ':::\n', '<think>', '</think>', '</think>\n', A, Z, A + Z, ':', '::', '<', '</', 'think>', 'thinking', '\r\n', 'Hello there. '];
  for (let trial = 0; trial < 200000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 24); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    const got = stripThinkingBlock(s), want = oldStrip(s);
    if (got !== want) assert.equal(got, want, JSON.stringify(s));
  }
});

test('thinking: on long runs of every shape the indexOf scan still says what the old patterns said', () => {
  // the old patterns cost the square of the run, so these are a few thousand characters, not 149,000
  const families = [
    [A, ''], [A, Z], [A + 'a', Z], ['<think>', ''], ['<think>', '</think>'], ['<think>x', '</think>\n'], [':::thinking ', ''], [':::thinking ', ':::\n'], [':::thinking x', ':::'],
    [A + '<think>:::thinking ', Z + '</think>:::'], [A + Z, A], ['<think>a</think>\n', '<think>'], [':::thinking a:::\n', ':::thinking'], [A + 'a' + Z + '\n', A], ['<think></think>', ''],
  ];
  for (const [unit, tail] of families) {
    for (const size of [600, 4000]) {
      for (const text of [rep(unit, size) + tail, tail + rep(unit, size), rep(unit, size) + tail + rep(unit, size)]) {
        assert.equal(stripThinkingBlock(text), oldStrip(text), JSON.stringify([unit, tail, size]));
      }
    }
  }
});

test('thinking: 149,000 characters of every shape that used to cost the square of the text finish in a blink', () => {
  const shapes = [
    ['unclosed private-use openers', rep(A)],
    ['unclosed <think>', rep('<think>')],
    ['unclosed :::thinking with a line break each', rep(':::thinking\n')],
    ['openers of all three kinds, none closed', rep(A + '<think>:::thinking ')],
    ['private-use openers, one closer at the very end', rep(A, BIG - 1) + Z],
    ['<think> openers, one closer at the very end', rep('<think>', BIG - 8) + '</think>'],
    [':::thinking openers, one closer at the very end', rep(':::thinking x', BIG - 3) + ':::'],
    ['private-use closers only', rep(Z)],
    ['</think> closers only', rep('</think>')],
    ['a closer, then unclosed openers', Z + rep(A, BIG - 1)],
    ['many complete private-use blocks', rep(A + 'a' + Z)],
    ['many complete <think> blocks', rep('<think>x</think>\n')],
    ['many complete :::thinking blocks', rep(':::thinking x:::\n')],
    ['complete blocks, then unclosed openers', rep(A + 'a' + Z, BIG / 2) + rep(A, BIG / 2)],
    ['unclosed openers, then complete blocks', rep('<think>', BIG / 2) + rep('<think>x</think>', BIG / 2)],
    ['prose', rep('Hello there, friend. ')],
    ['nothing but line breaks', rep('\n')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 16, `${name} is ${text.length} characters`);
    clock(`stripThinkingBlock on ${name}`, () => stripThinkingBlock(text));
  }
});

test('thinking: reasoning in front of a long answer is cut out and the answer stays whole', () => {
  const answer = rep('This is the answer. ', 100000);
  assert.equal(stripThinkingBlock('<think>' + rep('thought ', 50000) + '</think>\n' + answer), answer.trim());
  assert.equal(stripThinkingBlock(A + rep('thought ', 50000) + Z + answer), answer.trim());
  assert.equal(stripThinkingBlock(':::thinking\n' + rep('thought ', 50000) + ':::\n' + answer), answer.trim());
  assert.equal(stripThinkingBlock(rep(A, 50000) + answer), (rep(A, 50000) + answer).trim());
});
