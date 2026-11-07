'use strict';
// Nov 6 2026 (red teams, steering-balance review): two rules of the speech prep chain cost the SQUARE of the text.
//   1. normalizeForSpeech's email rule, /\b([a-zA-Z0-9._%+-]+)@.../, ran its name part to the end of the run at every
//      word boundary before it looked for the "@": 70,000 characters of "%%%a%%%" (steering delimiters are made of
//      percent signs, and the name class holds %) took over a second, "a.a.a.a." ten times that.
//   2. stripCitationMarkers' /\s+([.,!?;:])/ did the same on a long run of blanks, and it deleted the LINE BREAKS in
//      front of a "..." or a ":)" that opened a paragraph, so that paragraph joined the one above it.
// The real functions are sliced out of server.js (never a copy). The pre-fix patterns are kept here as the oracle the
// new code is fuzzed against, and a clock test pins each shape: 149,000 characters, well under a second.
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
  between('function stripThinkingBlock', 'const MONTH_NAMES'),                       // thinking, markdown and citation helpers
  between('const MONTH_NAMES', '// This is the endpoint LibreChat will hit'),        // speakDigits, speakEmails, normalizeForSpeech
  'this.fns = { stripCitationMarkers, normalizeForSpeech, speakEmails };',
].join('\n'), ctx);
const { stripCitationMarkers, normalizeForSpeech, speakEmails } = ctx.fns;

// ── the oracles: the patterns as they were before the fix ───────────────────────────────────────────────────────────
const oldEmails = (t) => t.replace(/\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,10})\b/g, (_, user, dom, tld) =>
  `${user.replace(/\./g, ' dot ')} at ${dom.replace(/\./g, ' dot ')} dot ${tld}`);
const oldCitationTail = (t) => t.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const LIMIT_MS = 1000;   // the fixed code needs a few milliseconds; the old one needed seconds to minutes
function clock(label, fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < LIMIT_MS, `${label} took ${ms.toFixed(0)} ms`);
  return out;
}
const BIG = 149000;
const rep = (unit, n = BIG) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

// ── emails ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('emails are spoken as they always were: name at domain dot tld', () => {
  for (const [input, want] of [
    ['write to kade.murdock@example.com today', 'write to kade dot murdock at example dot com today'],
    ['kade@example.com', 'kade at example dot com'],
    ['a@b.co and c@d.org', 'a at b dot co and c at d dot org'],
    ['mail first.last+tag@sub.example.co.uk, please', 'mail first dot last+tag at sub dot example dot co dot uk, please'],
    ['100%@a.bc', '100% at a dot bc'],
    ['no address here, just 5 @ 3 and a@b', 'no address here, just 5 @ 3 and a@b'],
    ['@example.com alone', '@example.com alone'],
    ['a@b.c is too short a tld', 'a@b.c is too short a tld'],
    ['-a@b.com', '-a at b dot com'],
    ['..@b.com', '..@b.com'],
    ['a@b.com@c.com', 'a at b dot com@c.com'],
    ['x@y.abcdefghij ok', 'x at y dot abcdefghij ok'],             // a top-level domain of ten letters
    ['x@y.abcdefghijk no', 'x@y.abcdefghijk no'],                  // eleven is not one
    ['x@y.com1 no', 'x@y.com1 no'],                                // the word boundary after the tld
    ['_a@b.com and a_@b.com', '_a at b dot com and a_ at b dot com'],
  ]) {
    assert.equal(speakEmails(input), want, input);
    assert.equal(oldEmails(input), want, 'the oracle agrees: ' + input);
  }
  assert.equal(normalizeForSpeech('Mail kade@example.com now.'), 'Mail kade at example dot com now.');
  assert.equal(speakEmails(''), '');
});

test('emails: the linear scan matches the old pattern on every string up to six characters of a small alphabet', () => {
  const alphabet = ['a', '.', '-', '%', '@', ' ', '_'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      assert.equal(speakEmails(prefix), oldEmails(prefix), JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 137000, `checked ${checked}`);
});

test('emails: the linear scan matches the old pattern on 80,000 random strings that look like text with addresses in it', () => {
  const r = rng(20261106);
  const pieces = ['a', 'b', 'Z', '7', 'kade', 'x_y', '.', '.', '-', '%', '+', '@', '@', ' ', ' ', '\n', 'com', 'co', 'org', 'uk', 'c', 'example', '"', '(', ',', '!', '%%%', 'é', '1'];
  for (let trial = 0; trial < 80000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 14); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    assert.equal(speakEmails(s), oldEmails(s), JSON.stringify(s));
  }
});

test('emails: 149,000 characters of every shape that used to cost the square of the text finish in a blink', () => {
  const shapes = [
    ['steering delimiters', rep('%%%a%%%')],
    ['percent-led names', rep('%a')],
    ['plus signs', rep('a+')],
    ['underscores', rep('a_')],
    ['dots', rep('a.')],
    ['dots then an at-sign', rep('a.', BIG - 2) + '@b'],
    ['dashes', rep('a-')],
    ['digits and dots', rep('1.')],
    ['one long name, no at-sign', rep('a')],
    ['one long name, then an at-sign', rep('a', BIG - 1) + '@'],
    ['at-signs only', rep('@')],
    ['name at name at name', rep('a@')],
    ['a domain with no tld after the at-sign', 'a@' + rep('b.', BIG - 2)],
    ['a domain of dashes', 'a@' + rep('-', BIG - 2)],
    ['a tld that is too long', 'a@b.' + rep('c', BIG - 4)],
    ['a thousand real addresses and filler', rep('write kade@example.com now ')],
  ];
  for (const [name, text] of shapes) {
    assert.equal(text.length, BIG, name);
    clock(`speakEmails on ${name}`, () => speakEmails(text));
  }
  // through the whole normalizer, on the shapes only this rule used to hurt (dots, dashes and digits wake up other rules)
  for (const [name, text] of shapes.filter(([n]) => ['steering delimiters', 'percent-led names', 'plus signs', 'underscores', 'one long name, no at-sign', 'at-signs only', 'name at name at name'].includes(n))) {
    clock(`normalizeForSpeech on ${name}`, () => normalizeForSpeech(text));
  }
});

// ── citation blanks ─────────────────────────────────────────────────────────────────────────────────────────────────
test('citation blanks: a blank in front of punctuation still goes, and a line break never does', () => {
  for (const [input, want] of [
    ['word  ,   next', 'word, next'],
    ['Wait , what ? Really !', 'Wait, what? Really!'],
    ['word\u00a0, next', 'word, next'],                            // a no-break space is a blank too
    ['one\ttwo \t;three', 'one\ttwo;three'],
    // the old rule joined these paragraphs ("Done....and then") and glued the smiley to the word before it
    ['Done.\n\n...and then', 'Done.\n\n...and then'],
    ['Okay\n\n:) fine', 'Okay\n\n:) fine'],
    ['First line\n, second line', 'First line\n, second line'],
    ['a \n .', 'a \n.'],                                           // only the blank in front of the stop goes
    ['line one\r\n\r\n.NET is fun', 'line one\r\n\r\n.NET is fun'],
    ['Done.\r...and then', 'Done.\r...and then'],                  // a lone carriage return is a line break too
    ['a\u2028.', 'a\u2028.'],
    ['', ''],
  ]) assert.equal(stripCitationMarkers(input), want, JSON.stringify(input));
  // the other jobs of the function are untouched
  assert.equal(stripCitationMarkers('It works.\ue202turn0search7 Next.'), 'It works. Next.');
  assert.equal(stripCitationMarkers('See this \\ue202turn0search7 , and that.'), 'See this, and that.');
});

test('citation blanks: without a line break in the text it is exactly the old rule, on every string up to six characters of a small alphabet', () => {
  const alphabet = ['a', ' ', '\t', '\u00a0', '.', ',', '!', '?', ':'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      assert.equal(stripCitationMarkers(prefix), oldCitationTail(prefix), JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 597000, `checked ${checked}`);
});

test('citation blanks: with line breaks in the text, none is ever deleted, no blank is left in front of punctuation, and a second pass changes nothing', () => {
  const r = rng(20261107);
  const pieces = ['a', 'word', ' ', ' ', '  ', '\t', '\u00a0', '\n', '\n\n', '\r\n', '\r', '\u2028', '\u2029', '.', ',', '!', '?', ';', ':', '...', ':)'];
  const breaks = (s) => (s.match(/[\r\n\u2028\u2029]/g) || []).join('');
  let withBreaks = 0;
  for (let trial = 0; trial < 60000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 16); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    const out = stripCitationMarkers(s);
    assert.equal(breaks(out), breaks(s.trim()), 'a line break was deleted or invented: ' + JSON.stringify([s, out]));
    assert.doesNotMatch(out, /[^\S\r\n\u2028\u2029][.,!?;:]/, 'a blank is left in front of punctuation: ' + JSON.stringify([s, out]));
    assert.equal(stripCitationMarkers(out), out, 'not stable: ' + JSON.stringify([s, out]));
    if (breaks(s)) withBreaks += 1;
  }
  assert.ok(withBreaks > 20000, `only ${withBreaks} of the strings held a line break`);
});

test('citation blanks: 149,000 characters of every shape of blank that used to cost the square of the text finish in a blink', () => {
  const shapes = [
    ['line breaks', rep('\n') + 'x'],
    ['line breaks then a stop', rep('\n') + '.'],
    ['blank lines', rep('\n \n') + 'x'],
    ['no-break spaces', rep('\u00a0') + 'x'],
    ['no-break spaces then a stop', rep('\u00a0') + '.'],
    ['mixed blanks', rep(' \u00a0') + 'x'],
    ['mixed blanks and line breaks', rep(' \n\u00a0\t') + ','],
    ['carriage returns', rep('\r') + 'x'],
    ['paragraph separators', rep('\u2029 ') + 'x'],
    ['tabs and line breaks', rep('\t\n') + ':'],
    ['spaces and stops', rep(' .')],
    ['no-break spaces and stops', rep('\u00a0.')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 4, `${name} is ${text.length} characters`);
    clock(`stripCitationMarkers on ${name}`, () => stripCitationMarkers(text));
  }
});
