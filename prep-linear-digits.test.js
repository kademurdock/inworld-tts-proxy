'use strict';
// Nov 7 2026 (follow-up of prep-linear.test.js): four patterns of normalizeForSpeech began with an unanchored \d+, so a
// long run of digits cost the SQUARE of the run -- every digit was tried as a start, and each start read the rest of the run
// before it looked for the "%" or the degree sign that was not there (149,000 digits: about a minute per pattern):
//   rule 7   /(\d+(?:\.\d+)?)\s?%(?!%)/g            percent
//   rule 8   /(\d+(?:\.\d+)?)\s?°\s?F\b/g           degrees Fahrenheit
//            /(\d+(?:\.\d+)?)\s?°\s?C\b/g           degrees Celsius
//            /(\d+(?:\.\d+)?)\s?°(?![FC])/g         bare degrees
// The fix puts (?<!\d) in front of each: a number starts at the first digit of its run. That is exact, because the match from
// a digit depends only on where its run ends, so a start inside the run can only fail where the first digit failed.
// The real function is sliced out of server.js (never a copy). The oracle the new code is fuzzed against is the same slice with
// the lookbehind taken off again (the old patterns), and a clock test pins each shape: 149,000 characters, well under a second.
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
const NORMALIZER = between('const MONTH_NAMES', '// This is the endpoint LibreChat will hit');   // speakDigits, speakEmails, normalizeForSpeech
function load(code) {
  const ctx = { process: { env: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.fn = normalizeForSpeech;', ctx);
  return ctx.fn;
}
const normalizeForSpeech = load(NORMALIZER);

// The oracle is the same source with the lookbehind taken off the four patterns, whatever it says: the patterns as they were.
// (So a mutation of the lookbehind changes the real function and not the oracle, and the fuzz below sees the difference.)
const GUARD = /\(\?<[!=][^()]*\)(?=\(\\d\+\(\?:\\\.\\d\+\)\?\)\\s\?[%°])/g;
const oldAll = load(NORMALIZER.replace(GUARD, ''));

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

test('all four number patterns carry the lookbehind', () => {
  assert.equal((NORMALIZER.match(GUARD) || []).length, 4);
  assert.notEqual(NORMALIZER, NORMALIZER.replace(GUARD, ''));
});

test('percent and degrees are spoken as they always were', () => {
  for (const [input, want] of [
    ['92% of it', '92 percent of it'],
    ['92 % of it', '92 percent of it'],
    ['3.5% and 12.75 % more', '3.5 percent and 12.75 percent more'],
    ['100%', '100 percent'],
    ['x5% and COVID19%', 'x5 percent and COVID19 percent'],           // a number glued to a letter is still a number
    ['1.2.3%', '1.2.3 percent'],                                       // the second number of a version-like run is the percentage
    ['12345%', '12345 percent'],
    ['5\xa0%', '5 percent'],                                           // a no-break space is a blank too
    ['5%6%', '5 percent6 percent'],                                    // the next number starts right after the sign
    ['5%%', '5%%'],                                                    // part of a doubled sign, not a percentage
    ['%%%5%%%', '%%%5%%%'],                                            // a steering delimiter after a number
    ['no number %', 'no number %'],
    ['72°F today', '72 degrees Fahrenheit today'],
    ['72 °F and 72° F', '72 degrees Fahrenheit and 72 degrees Fahrenheit'],
    ['21.5 °C', '21.5 degrees Celsius'],
    ['45° north', '45 degrees north'],
    ['x45°C', 'x45 degrees Celsius'],
    ['3°FC', '3°FC'],                                        // the old rules' own answer for a degree sign followed by two letters
    ['3°FF and 3°CC', '3°FF and 3°CC'],            // F or C must end the word, and the bare rule leaves a sign in front of either alone
    ['21°C. 21 ° C 21° C', '21 degrees Celsius. 21 degrees Celsius 21 degrees Celsius'],
    ['72 ° F', '72 degrees Fahrenheit'],
    ['72°  F', '72 degrees F'],                                   // one blank only: the bare rule speaks the sign and leaves the letter
  ]) {
    assert.equal(normalizeForSpeech(input), oldAll(input), 'the oracle agrees: ' + JSON.stringify(input));
    assert.equal(normalizeForSpeech(input), want, JSON.stringify(input));
  }
  assert.equal(normalizeForSpeech(''), '');
});

test('percent: the lookbehind rule matches the old pattern on every string up to seven characters of a small alphabet', () => {
  const alphabet = ['1', '.', '%', ' ', 'x', '\xa0'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      assert.equal(normalizeForSpeech(prefix), oldAll(prefix), JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 7);
  assert.ok(checked > 335000, `checked ${checked}`);
});

test('degrees: the lookbehind rules match the old patterns on every string up to six characters of a small alphabet', () => {
  const alphabet = ['1', '.', '°', ' ', 'F', 'C', 'x'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      assert.equal(normalizeForSpeech(prefix), oldAll(prefix), JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 137000, `checked ${checked}`);
});

test('percent and degrees: the new rules match the old patterns on 80,000 random strings that look like text with numbers in it', () => {
  const r = rng(20261107);
  const pieces = ['1', '2', '9', '10', '3.5', '.', '.', ',', '%', '%', '%%', '%%%', ' ', ' ', '\n', '\xa0', '°', '°', 'F', 'C', 'S', 'x', 'a', '$', '-', '/', ':', 'KB', 'mph', 'about ', 'e.g. ', '(', ')'];
  for (let trial = 0; trial < 80000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 16); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    assert.equal(normalizeForSpeech(s), oldAll(s), JSON.stringify(s));
  }
});

test('percent and degrees: 149,000 characters of every shape that used to cost the square of the run finish in a blink', () => {
  const shapes = [
    ['digits', rep('1')],
    ['every digit in turn', rep('0123456789')],
    ['every digit in turn, then a letter', rep('0123456789', BIG - 1) + 'x'],
    ['nines', rep('9')],
    ['digits, then a letter', rep('1', BIG - 1) + 'x'],
    ['digits, a dot, digits', rep('1', BIG / 2) + '.' + rep('1', BIG / 2 - 1)],
    ['digits, then a percent sign', rep('1', BIG - 1) + '%'],
    ['digits, a blank, a percent sign', rep('1', BIG - 2) + ' %'],
    ['digits, then a doubled percent sign', rep('1', BIG - 2) + '%%'],
    ['digits, then a degree sign', rep('1', BIG - 1) + '°'],
    ['digits, a degree sign, F', rep('1', BIG - 2) + '°F'],
    ['digits, a degree sign, a blank, C', rep('1', BIG - 3) + '° C'],
    ['digits, then blanks', rep('1', BIG / 2) + rep(' ', BIG / 2)],
    ['digit, blank', rep('1 ')],
    ['digit, doubled percent sign', rep('1%%')],
    ['digit, percent sign', rep('1%')],
    ['two digits, degree sign, letter', rep('12°x')],
    ['many runs of 200 digits', rep(rep('9', 200) + 'x')],
    ['digits among percent signs', rep('%%%1111111111%%%')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 4, `${name} is ${text.length} characters`);
    clock(`normalizeForSpeech on ${name}`, () => normalizeForSpeech(text));
  }
});

test('percent and degrees: a long run of digits is still read as one number when the sign follows it', () => {
  const run = rep('7', 5000);
  assert.equal(normalizeForSpeech(run + '%'), run + ' percent');
  assert.equal(normalizeForSpeech(run + ' %'), run + ' percent');
  assert.equal(normalizeForSpeech(run + '.' + run + '%'), run + '.' + run + ' percent');
  assert.equal(normalizeForSpeech(run + '°F'), run + ' degrees Fahrenheit');
  assert.equal(normalizeForSpeech(run + '°'), run + ' degrees');
  assert.equal(normalizeForSpeech('3' + run + 'x%'), '3' + run + 'x%');
});
