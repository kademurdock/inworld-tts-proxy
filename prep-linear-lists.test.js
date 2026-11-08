'use strict';
// Nov 7 2026 (follow-up of prep-linear.test.js): the two list-marker rules of stripSpeechMarkdown cost the SQUARE of a long run
// of blank lines. /^\s*[-*•]\s+/gm and /^\s*\d+\.\s+/gm tried every line start inside the run, and each one read the rest of
// the run (\s* crosses line breaks) before it looked for the marker that was not there: 149,000 line breaks took half a
// minute. MD_LIST_BULLET and MD_LIST_NUMBER let a line start through only when no earlier line start lies in the same run of
// blanks, because every line start of a run ends its \s* at the same place and so can only fail where the first one failed;
// the one other start worth trying is a marker right at its line start, whose blanks the marker before it ate.
// The real function and patterns are sliced out of server.js (never a copy). The old patterns are kept here as the oracle
// the new ones are fuzzed against, and a clock test pins each shape: 149,000 characters, well under a second.
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
  between('function stripThinkingBlock', 'const MONTH_NAMES'),       // thinking, markdown and citation helpers
  'this.fns = { stripSpeechMarkdown, MD_LIST_BULLET, MD_LIST_NUMBER };',
].join('\n'), ctx);
const { stripSpeechMarkdown, MD_LIST_BULLET, MD_LIST_NUMBER } = ctx.fns;

// ── the oracles: the patterns as they were before the fix ────────────────────────────────────────────────────────────
const OLD_BULLET = /^\s*[-*•]\s+/gm;
const OLD_NUMBER = /^\s*\d+\.\s+/gm;
const bullets = (t) => t.replace(MD_LIST_BULLET, '');
const numbers = (t) => t.replace(MD_LIST_NUMBER, '');
const oldBullets = (t) => t.replace(OLD_BULLET, '');
const oldNumbers = (t) => t.replace(OLD_NUMBER, '');

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const LIMIT_MS = 1000;   // the fixed code needs a few milliseconds; the old one needed seconds to minutes
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
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029), NBSP = String.fromCharCode(0xa0);

test('list markers are stripped as they always were', () => {
  for (const [input, want] of [
    ['- one\n- two\n* three\n• four', 'one\ntwo\nthree\nfour'],
    ['1. First\n2. Second\n10. Tenth', 'First\nSecond\nTenth'],
    ['  - indented\n\t* tabbed\n   3. numbered', 'indented\ntabbed\nnumbered'],
    ['Intro:\n\n- one\n- two', 'Intro:\none\ntwo'],                       // the blank lines in front of a list item go with its marker
    ['- \n\n- x', 'x'],                                                    // blank lines after a marker go with it, and the next marker is still a marker
    ['1. \n\n2. x', 'x'],
    ['1. \n\n0. x', 'x'],                                                  // the digits 0 and 9 start a marker too, right behind the blanks another marker ate
    ['1. \n\n9. y', 'y'],
    ['a - b and -c and 3.5 and 1.5 and Version 1. Next', 'a - b and -c and 3.5 and 1.5 and Version 1. Next'],
    ['a\n-b\n--\n-', 'a\n-b\n--\n-'],                                      // a marker needs a blank after it
    ['a\r\n- b\r\n1. c', 'a\rb\rc'],                                       // a carriage return ends a line, so the line feed after it is a blank line in front of the marker, and goes with it (old behaviour, kept)
    ['a' + LS + '- b' + PS + '2. c', 'a' + LS + 'b' + PS + 'c'],           // U+2028 and U+2029 end a line too
    ['-' + NBSP + 'x', 'x'],                                               // a no-break space is a blank
    ['\n\n\n- x', 'x'],                                                    // blank lines in front of the first line of the text
    ['x\n\n\n\n- y', 'x\ny'],
    ['x\n   \n  \n- y', 'x\ny'],
    ['x   \n- y', 'x \ny'],                                                // the blanks at the end of the line before stay (the last rule of the function squeezes them to one)
    ['- 1. nested', 'nested'],                                             // the bullet rule runs first, then the number rule
    ['1. - nested', '- nested'],                                           // so this bullet is not at a line start when the bullet rule has looked
    ['-', '-'],
    ['', ''],
  ]) {
    assert.equal(stripSpeechMarkdown(input), want, JSON.stringify(input));
    assert.equal(numbers(bullets(input)), oldNumbers(oldBullets(input)), 'the oracle agrees (the two rules, in the order of the function): ' + JSON.stringify(input));
  }
  // the other jobs of the function are untouched
  assert.equal(stripSpeechMarkdown('# Title\n\n**bold** and [a link](http://x.y) and `code`\n\n> quote\n\n1. one\n2. two'), 'Title\n\nbold and a link and code\n\nquote\none\ntwo');
});

test('lists: the new patterns match the old ones on every string up to six tokens of a small alphabet', () => {
  const tokens = ['a', ' ', '\n', '\r', '\t', '-', '*', '•', '1', '.', LS];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      if (bullets(prefix) !== oldBullets(prefix)) assert.equal(bullets(prefix), oldBullets(prefix), 'bullets ' + JSON.stringify(prefix));   // compared first: the message is built only for a mismatch
      if (numbers(prefix) !== oldNumbers(prefix)) assert.equal(numbers(prefix), oldNumbers(prefix), 'numbers ' + JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 1900000, `checked ${checked}`);
});

test('lists: the new patterns match the old ones on every string up to eight tokens that stress runs of blank lines', () => {
  const tokens = ['a', ' ', '\n', '\r', '-', '1.', '•'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      if (bullets(prefix) !== oldBullets(prefix)) assert.equal(bullets(prefix), oldBullets(prefix), 'bullets ' + JSON.stringify(prefix));   // compared first: the message is built only for a mismatch
      if (numbers(prefix) !== oldNumbers(prefix)) assert.equal(numbers(prefix), oldNumbers(prefix), 'numbers ' + JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 8);
  assert.ok(checked > 5700000, `checked ${checked}`);
});

test('lists: the new patterns match the old ones on 200,000 random texts with lists in them', () => {
  const r = rng(20261107);
  const pieces = ['a', 'word', ' ', ' ', '  ', '\t', NBSP, '\n', '\n', '\n\n', '\r\n', '\r', LS, PS, '- ', '-', '* ', '*', '• ', '1. ', '12. ', '0. ', '9. ', '1.', '.', ',', '3.5', '# ', '> ', '**', '_', '[x](y)', '|', '`'];
  for (let trial = 0; trial < 200000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 24); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    if (bullets(s) !== oldBullets(s)) assert.equal(bullets(s), oldBullets(s), 'bullets ' + JSON.stringify(s));
    if (numbers(s) !== oldNumbers(s)) assert.equal(numbers(s), oldNumbers(s), 'numbers ' + JSON.stringify(s));
    if (numbers(bullets(s)) !== oldNumbers(oldBullets(s))) assert.equal(numbers(bullets(s)), oldNumbers(oldBullets(s)), 'both ' + JSON.stringify(s));
  }
});

test('lists: on long runs of every shape the new patterns still say what the old ones said', () => {
  // the old patterns cost the square of the run, so these are a few thousand characters, not 149,000
  const families = [
    ['\n', ''], ['\n', '- y'], ['\n', '1. y'], ['\n', '-'], ['\n \n', '- y'], ['\n\t\n', '2. y'], ['\r\n', '* y'], ['\n', 'y'], [' \n', '• y'], ['\n\n- a', ''], ['- a\n', ''],
    ['1. a\n', ''], ['-\n', ''], ['1.\n', ''], [LS, '- y'], [PS + ' ', '3. y'], [NBSP + '\n', '- y'], [' '.repeat(40) + '\n', '- y'], ['\n1' + '1'.repeat(30), '.'], ['\n- ', ''], ['- \n', 'x'],
  ];
  for (const [unit, tail] of families) {
    for (const size of [400, 2500]) {
      for (const text of ['x' + rep(unit, size) + tail, rep(unit, size) + tail, 'x' + rep(unit, size) + 'y' + tail]) {
        assert.equal(bullets(text), oldBullets(text), 'bullets ' + JSON.stringify([unit, tail, size]));
        assert.equal(numbers(text), oldNumbers(text), 'numbers ' + JSON.stringify([unit, tail, size]));
      }
    }
  }
});

test('lists: 149,000 characters of every shape that used to cost the square of the run finish in a blink', () => {
  const shapes = [
    ['line breaks', 'x' + rep('\n', BIG - 2) + 'y'],
    ['blank lines', 'x' + rep('\n \n', BIG - 2) + 'y'],
    ['tabbed blank lines', 'x' + rep('\n\t\n', BIG - 2) + 'y'],
    ['carriage returns and line feeds', 'x' + rep('\r\n', BIG - 2) + 'y'],
    ['carriage returns', 'x' + rep('\r', BIG - 2) + 'y'],
    ['line separators', 'x' + rep(LS, BIG - 2) + 'y'],
    ['paragraph separators and blanks', 'x' + rep(PS + ' ', BIG - 2) + 'y'],
    ['no-break spaces and line breaks', 'x' + rep(NBSP + '\n', BIG - 2) + 'y'],
    ['blanks, then line breaks', 'x' + rep(' ', BIG / 2) + rep('\n', BIG / 2 - 2) + 'y'],
    ['lines of a thousand blanks', rep(rep(' ', 1000) + '\n')],
    ['line breaks, then a bullet', 'x' + rep('\n', BIG - 4) + '- y'],
    ['line breaks, then a number', 'x' + rep('\n', BIG - 5) + '1. y'],
    ['line breaks, then a bare dash', 'x' + rep('\n', BIG - 2) + '-'],
    ['line breaks, then a number with no dot', 'x' + rep('\n', BIG - 3) + '12'],
    ['a bullet, then line breaks', '- ' + rep('\n', BIG - 4) + 'y'],
    ['a number, then line breaks', '1. ' + rep('\n', BIG - 5) + 'y'],
    ['bullets', rep('- a\n')],
    ['numbers', rep('1. a\n')],
    ['empty bullets', rep('-\n')],
    ['empty bullets with blanks', rep('- \n')],
    ['bullets after blank lines', rep('\n\n- a')],
    ['numbers after blank lines', rep('\n\n1. a')],
    ['lines of digits', rep('\n' + rep('1', 500))],
    ['lines of digits and dots', rep('\n' + rep('1', 500) + '.')],
    ['lines of prose', rep('Hello there.\nAnd more words here.\n\n')],
    ['bullets of one dash in front of blank lines', rep('-\n\n\n')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 6, `${name} is ${text.length} characters`);
    clock(`stripSpeechMarkdown on ${name}`, () => stripSpeechMarkdown(text));
    clock(`the list patterns on ${name}`, () => numbers(bullets(text)));
  }
});

test('lists: a long run of blank lines in front of a marker is still eaten with it', () => {
  const run = rep('\n', 20000);
  assert.equal(stripSpeechMarkdown('x' + run + '- y'), 'x\ny');            // the line break that ends the line of "x" stays, the blank lines after it go
  assert.equal(stripSpeechMarkdown('x' + run + '1. y'), 'x\ny');
  assert.equal(stripSpeechMarkdown('x' + run + 'y'), 'x' + run + 'y');
  assert.equal(stripSpeechMarkdown('- ' + run + '- ' + run + '- z'), 'z');
});
