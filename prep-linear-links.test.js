'use strict';
// Nov 7 2026 (follow-up of prep-linear.test.js): the link rule of stripSpeechMarkdown, /\[([^\]]+)\]\(([^)]*)\)/g -> "$1", tried
// a match at every "[", and each try read its label on to the next "]" (to the end of the text when there is none) before it
// looked for the "(" behind it: a long run of "[" cost the SQUARE of the run ("[a[a[a...", 149,000 characters: 6 to 18 seconds).
// stripMarkdownLinks goes by the "](" instead: the label is what lies between the last "]" (or the end of the last link) and it,
// from the first "[" there that leaves a character for the label; the target runs to the first ")"; and when no ")" is left no
// later link can close either.
// The real functions are sliced out of server.js (never a copy). The old pattern is kept here as the oracle the new code is
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
  between('function stripThinkingBlock', 'const MONTH_NAMES'),       // thinking, markdown and citation helpers
  'this.fns = { stripSpeechMarkdown, stripMarkdownLinks };',
].join('\n'), ctx);
const { stripSpeechMarkdown, stripMarkdownLinks } = ctx.fns;

// ── the oracle: the pattern as it was before the fix ─────────────────────────────────────────────────────────────────
const oldLinks = (t) => t.replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1');

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

test('links keep their words as they always did', () => {
  for (const [input, want] of [
    ['[a link](http://x.y)', 'a link'],
    ['See [the docs](https://x.com/a) and [more](b) here.', 'See the docs and more here.'],
    ['[a](b) [c](d)', 'a c'],
    ['[a][b](c)', '[a]b'],                                     // the label runs from the last "]" before the "(", not from the first "["
    ['[](x) and [ ](y)', '[](x) and  '],                       // a label needs a character
    ['[a]()', 'a'],                                            // an empty target is a target
    ['[a](b', '[a](b'],                                        // no ")" anywhere: not a link
    ['x [a [b](c) y', 'x a [b y'],                             // a label may hold "["
    ['[a\nb](c)', 'a\nb'],                                     // and line breaks
    ['[a](b\nc) d', 'a d'],                                    // and so may a target
    ['[a]\n(b)', '[a]\n(b)'],                                  // but the "(" must follow the "]" at once
    ['[a] (b)', '[a] (b)'],
    ['[[a]](b)', '[[a]](b)'],
    ['[a](b)(c)', 'a(c)'],
    ['[a](b](c)', 'a'],                                        // the target runs to the first ")", whatever it holds
    ['[a](b[c) [d](e)', 'a d'],
    ['[a] [b](c)', '[a] b'],
    ['[a]]( [b](c)', '[a]]( b'],
    ['](a) [b](c)', '](a) b'],
    ['[bare bracket span] stays', '[bare bracket span] stays'],
    ['no brackets', 'no brackets'],
    ['', ''],
  ]) {
    assert.equal(oldLinks(input), want, 'the oracle agrees: ' + JSON.stringify(input));
    assert.equal(stripMarkdownLinks(input), want, JSON.stringify(input));
  }
  // the other jobs of the function are untouched, and the link step still comes after the emphasis rules and before the code ticks
  assert.equal(stripSpeechMarkdown('**[bold link](http://x.y)** and *[it](u)* and `[code](v)` and [~~gone~~](w)'), 'bold link and it and code and gone');
  assert.equal(stripSpeechMarkdown('1. [one](a)\n2. [two](b)'), 'one\ntwo');
  assert.equal(stripSpeechMarkdown(''), '');
});

test('links: the "](" scan matches the old pattern on every string up to seven characters of a small alphabet', () => {
  const tokens = ['[', ']', '(', ')', 'a', ' ', '\n'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = stripMarkdownLinks(prefix), want = oldLinks(prefix);   // compared first: the message is built only for a mismatch
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 7);
  assert.ok(checked > 960000, `checked ${checked}`);
});

test('links: the "](" scan matches the old pattern on every string up to seven tokens that stress nested brackets', () => {
  const tokens = ['[', ']', '](', ')', 'a', '(', '[a'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = stripMarkdownLinks(prefix), want = oldLinks(prefix);
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 7);
  assert.ok(checked > 960000, `checked ${checked}`);
});

test('links: the "](" scan matches the old pattern on 200,000 random texts with links in them', () => {
  const r = rng(20261107);
  const pieces = ['[', '[', ']', ']', '(', ')', '](', '](', ')', 'a', 'word', ' ', ' ', '\n', '[a](b)', '[the docs](https://x.com/a)', '[x]', '(y)', '[[', ']]', '()', '[]', 'http://z.com/q?a=1', '*', '`', '~~'];
  for (let trial = 0; trial < 200000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 24); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    const got = stripMarkdownLinks(s), want = oldLinks(s);
    if (got !== want) assert.equal(got, want, JSON.stringify(s));
  }
});

test('links: on long runs of every shape the "](" scan still says what the old pattern said', () => {
  // the old pattern costs the square of the run, so these are a few thousand characters, not 149,000
  const families = [
    ['[', ''], ['[a', ''], ['[a)', ''], ['[a](', ''], ['[a](', ')'], ['[a]', '(b)'], ['[', '](x)'], ['[a', '](x)'], [']', ''], ['](', ''], ['](', ')'], ['[a](b)', ''], ['[a](b) ', ''],
    ['[a][a]( ', ''], ['[a](b]', ''], ['[a]((', ')'], ['[]', '(x)'], ['[](', ')'], ['[a]\n', '(b)'], ['a ', '[b](c)'], ['[[', ']]'], ['[a](b)(', ')'],
  ];
  for (const [unit, tail] of families) {
    for (const size of [400, 3000]) {
      for (const text of [rep(unit, size) + tail, tail + rep(unit, size), rep(unit, size) + tail + rep(unit, size)]) {
        assert.equal(stripMarkdownLinks(text), oldLinks(text), JSON.stringify([unit, tail, size]));
      }
    }
  }
});

test('links: 149,000 characters of every shape that used to cost the square of the run finish in a blink', () => {
  const shapes = [
    ['opening brackets', rep('[')],
    ['opening brackets and letters', rep('[a')],
    ['opening brackets, a letter and a closing parenthesis', rep('[a)')],
    ['links with no closing parenthesis anywhere', rep('[a](')],
    ['closing brackets', rep(']')],
    ['closing brackets and parentheses, no opening bracket', rep('](')],
    ['empty labels', rep('[](')],
    ['empty labels and a closing parenthesis at the end', rep('[](', BIG - 1) + ')'],
    ['real links', rep('[a](b)')],
    ['real links and spaces', rep('[a](b) ')],
    ['brackets that close without a parenthesis behind them', rep('[a][a]( ')],
    ['opening brackets, then one link', rep('[', BIG - 4) + '](x)'],
    ['opening brackets on both sides of one link', rep('[', 74498) + '](x)' + rep('[', 74498)],
    ['one link with a long target', '[a](' + rep('b', BIG - 5) + ')'],
    ['one link with a long label', '[' + rep('b', BIG - 5) + '](c)'],
    ['targets that hold closing brackets', rep('[a](b]')],
    ['targets that hold opening parentheses', rep('[a]((', BIG - 1) + ')'],
    ['all the openers, then all the closers', rep('[', BIG / 2) + rep(']', BIG / 2)],
    ['all the closers, then all the openers', rep(']', BIG / 2) + rep('[', BIG / 2)],
    ['nested brackets', rep('[[a]](b)')],
    ['links with line breaks inside', rep('[a\nb](c\nd)\n')],
    ['prose with links', rep('See [the docs](https://x.com/a) and [more](b) here. [not a link] ')],
    ['prose', rep('Hello there, friend. ')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 6, `${name} is ${text.length} characters`);
    clock(`stripMarkdownLinks on ${name}`, () => stripMarkdownLinks(text));
    clock(`stripSpeechMarkdown on ${name}`, () => stripSpeechMarkdown(text));
  }
});

test('links: a long label and a long target are still one link', () => {
  const label = rep('word ', 40000), target = rep('p/', 40000);
  assert.equal(stripMarkdownLinks('start [' + label + '](' + target + ') end'), 'start ' + label + ' end');
  assert.equal(stripMarkdownLinks(rep('[x](y)', 60000)), 'x'.repeat(10000));
});
