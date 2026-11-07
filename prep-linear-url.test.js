'use strict';
// Nov 7 2026 (follow-up of prep-linear.test.js): rules 2+3 of normalizeForSpeech (URLs and bare domains) cost the SQUARE of a
// long run of labels. The old statement,
//   t.replace(/(?:\bhttps?:\/\/(?:www\.)?|\b)((?:[a-zA-Z0-9-]+\.)+(?:com|org|...))\b(\/[^\s)\]}"'<>]*)?/g, ...)
// tried a match at every word boundary, and each try read the whole run of labels in front of it ("a.a.a.", "1-1-1-", "1.1.1.")
// before it looked for the top-level domain: 149,000 characters took 8 to 20 seconds. speakUrls runs the same pattern sticky,
// one try at a time, and skips the rest of a run of labels after a try that failed at a word boundary inside it (every start
// in the run needs the same ".tld", so none can match where the first did not; an "http://" at the end of the run can, and
// the skip stops short of it).
// The real functions are sliced out of server.js (never a copy). The old statement is kept here as the oracle the new code is
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
  between('const MONTH_NAMES', '// This is the endpoint LibreChat will hit'),        // TLD_SPOKEN, speakEmails, speakUrls, normalizeForSpeech
  'this.fns = { normalizeForSpeech, speakUrls, TLD_SPOKEN };',
].join('\n'), ctx);
const { normalizeForSpeech, speakUrls, TLD_SPOKEN } = ctx.fns;

// ── the oracle: the statement as it was before the fix ─────────────────────────────────────────────────────────────────
const oldUrls = (t) => t.replace(
  new RegExp(String.raw`(?:\bhttps?:\/\/(?:www\.)?|\b)((?:[a-zA-Z0-9-]+\.)+(?:${TLD_SPOKEN}))\b(\/[^\s)\]}"'<>]*)?`, 'g'),
  (_, host, path) => {
    const spokenHost = host.replace(/\./g, ' dot ');
    if (!path || path === '/') return spokenHost;
    const clean = path.replace(/[?#].*$/, '');
    const segs = clean.split('/').filter(Boolean);
    if (segs.length === 0 || segs.length > 3 || clean.length > 40) return spokenHost;
    return `${spokenHost} slash ${segs.join(' slash ')}`;
  },
);

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

test('web addresses are spoken as they always were', () => {
  for (const [input, want] of [
    ['see example.com now', 'see example dot com now'],
    ['http://www.example.com/a/b is up', 'example dot com slash a slash b is up'],
    ['https://example.org/ and https://example.org', 'example dot org and example dot org'],
    ['go to www.example.co/path?x=1#top please', 'go to www dot example dot co slash path please'],
    ['http://example.net/a/b/c/d ok', 'example dot net ok'],                      // four segments: the host only
    ['http://example.net/' + 'x'.repeat(41), 'example dot net'],                  // a path over 40 characters: the host only
    ['mail me at kade.murdock.io, thanks', 'mail me at kade dot murdock dot io, thanks'],
    ['server.js and 3.14 and version 2.0.1 stay', 'server.js and 3.14 and version 2.0.1 stay'],
    ['the file readme.md is not a site', 'the file readme.md is not a site'],
    ['a.b.com.', 'a dot b dot com.'],
    ['my_site.com is left alone', 'my_site.com is left alone'],                   // an underscore is not a label character
    ['_ab-c.com', '_ab-c dot com'],                                                // the first word boundary of the run is the "-"
    ['example.com-and-more.org', 'example dot com-and-more dot org'],
    ['x.com.http://y.org/z', 'x dot com.y dot org slash z'],                      // a scheme at the very end of a run of labels still starts a match
    ['http://www.com', 'www dot com'],                                             // "www." given back when nothing is left after it
    ['EXAMPLE.COM and Example.Com', 'EXAMPLE.COM and Example.Com'],               // the top-level domains are lower case
    ['a..b.com and a.b..com', 'a..b dot com and a.b..com'],
    ['Kade.Murdock.com and A1-B2.org', 'Kade dot Murdock dot com and A1-B2 dot org'],   // upper case and digits are label characters
    ['http://example.com/a#frag and example.com/a?x=1', 'example dot com slash a and example dot com slash a'],
    ['example.com// and example.com/// ok', 'example dot com and example dot com ok'],   // a path of nothing but slashes names no segment
    ['example.com/a/b/c and example.com/a/b/c/d', 'example dot com slash a slash b slash c and example dot com'],
    ['x.com/' + 'y'.repeat(39) + ' x.com/' + 'y'.repeat(40), 'x dot com slash ' + 'y'.repeat(39) + ' x dot com'],   // the path counts its slash: 40 characters is still short, 41 is not
    ['', ''],
  ]) {
    assert.equal(oldUrls(input), want, 'the oracle agrees: ' + JSON.stringify(input));
    assert.equal(speakUrls(input), want, JSON.stringify(input));
  }
  assert.equal(normalizeForSpeech('Visit https://www.example.com/docs for 5 more.'), 'Visit example dot com slash docs for 5 more.');
});

test('urls: the linear scan matches the old statement on every string up to five tokens of a small alphabet', () => {
  const tokens = ['a', '1', '-', '.', '_', ' ', '/', ':', ')', 'com', 'co', 'io', 'http', 's', 'www'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = speakUrls(prefix), want = oldUrls(prefix);   // compared first: the message is built only for a mismatch
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 5);
  assert.ok(checked > 800000, `checked ${checked}`);
});

test('urls: the linear scan matches the old statement on every string up to six tokens built around an http:// start', () => {
  const tokens = ['a', '.', '-', 'com', 'http', 'https', '://', 'www.', ' ', '_', '/'];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = speakUrls(prefix), want = oldUrls(prefix);   // compared first: the message is built only for a mismatch
      if (got !== want) assert.equal(got, want, JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 6);
  assert.ok(checked > 1900000, `checked ${checked}`);
});

test('urls: the linear scan matches the old statement on 200,000 random strings that look like text with addresses in it', () => {
  const r = rng(20261107);
  const pieces = ['a', 'b', '1', '9', '-', '--', '.', '.', '..', '_', '_a', ' ', ' ', '\n', '/', '//', '/x', '/a/b/c/d', ':', '://', 'com', 'co', 'io', 'org', 'info', 'audio', 'biz', 'net', 'http', 'https', 'www', 'www.', '?', '?q=1', '#', '#top', ')', ']', '}', '"', "'", '<', '>', 'é', 'COM', 'Co', 'x.y', 'example', 'mail@', '3.14', '%%%', 'server.js', 'e.g.', 'a.b.c.d.e'];
  for (let trial = 0; trial < 200000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 24); k > 0; k--) s += pieces[Math.floor(r() * pieces.length)];
    const got = speakUrls(s), want = oldUrls(s);
    if (got !== want) assert.equal(got, want, JSON.stringify(s));
  }
});

test('urls: on long runs of every shape the linear scan still says what the old statement said', () => {
  // the old statement costs the square of the run, so these are a few thousand characters, not 149,000
  const families = [
    ['a.', ''], ['a.', 'x'], ['a.', 'com'], ['a.', '.com/path'], ['1-', '.'], ['1-', '.com'], ['a-', '.org'], ['1.', ''], ['1.1', 'io'], ['.', ''],
    ['a.b.c.d ', ''], ['a.com', ''], ['a.com-a.', ''], ['co.', 'co'], ['-.', 'a.com'], ['a..', 'b.com'], ['http://', 'a.com'],
    ['http://www.', 'a.com'], ['www.', 'com'], ['a.', 'http://x.com'], ['a.', 'https://www.x.com/y'], ['https://' + 'a.'.repeat(20), 'z.com'],
    ['_a.', 'a.com'], ['x.com ', ''], ['Hello there, friend. See www.example.com/a/b today - ok? ', ''],
  ];
  for (const [unit, tail] of families) {
    for (const size of [600, 3000]) {
      const text = rep(unit, size) + tail;
      assert.equal(speakUrls(text), oldUrls(text), JSON.stringify([unit, tail, size]));
      const head = tail + rep(unit, size);
      assert.equal(speakUrls(head), oldUrls(head), JSON.stringify([tail, unit, size]));
    }
  }
});

test('urls: 149,000 characters of every shape that used to cost the square of the run finish in a blink', () => {
  const shapes = [
    ['dotted letters', rep('a.')],
    ['dotted letters, then a letter', rep('a.', BIG - 1) + 'x'],
    ['dashed digits, then a dot', rep('1-', BIG - 1) + '.'],
    ['dashed letters, then a dot', rep('a-', BIG - 1) + '.'],
    ['dotted digits', rep('1.')],
    ['dotted digit pairs', rep('1.1')],
    ['dots', rep('.')],
    ['one long label, then .x', rep('a', BIG - 2) + '.x'],
    ['one long label, then .com', rep('a', BIG - 4) + '.com'],
    ['a long label with a dash in every second place', rep('ab-')],
    ['many short runs with no top-level domain', rep('a.b.c.d ')],
    ['top-level domains only', rep('.com')],
    ['a domain that repeats', rep('a.com')],
    ['an address, then a long run with none', 'a.com' + rep('-a.', BIG - 5)],
    ['a run with a scheme at its end', rep('a.', BIG - 4) + 'http'],
    ['a run with a scheme at its end and a real address behind it', rep('a.', BIG - 17) + 'http://x.com/yy'],
    ['schemes', rep('http://')],
    ['a scheme, then a long run', 'http://' + rep('a.', BIG - 7)],
    ['schemes with www', rep('http://www.')],
    ['www', rep('www.')],
    ['schemes, each with a short run', rep('https://' + 'a.'.repeat(50))],
    ['an underscore in front of a long run', '_' + rep('a.', BIG - 1)],
    ['dashes and dots', rep('-.')],
    ['dashes', rep('-')],
    ['double dots', rep('a..')],
    ['a thousand real addresses', rep('x.com ')],
    ['prose with addresses', rep('See www.example.com/a/b and example.org/x?y=1 now - ok? ')],
    ['prose', rep('Hello there, friend. It is 72% of 3.5 GB at noon - ok? ')],
  ];
  for (const [name, text] of shapes) {
    assert.ok(Math.abs(text.length - BIG) <= 17, `${name} is ${text.length} characters`);
    clock(`speakUrls on ${name}`, () => speakUrls(text));
  }
  // through the whole normalizer, on the shapes only this rule used to hurt
  for (const [name, text] of shapes.filter(([n]) => ['dotted letters', 'dotted letters, then a letter', 'dashed digits, then a dot', 'dotted digits', 'dotted digit pairs', 'one long label, then .x', 'many short runs with no top-level domain', 'an address, then a long run with none', 'a thousand real addresses'].includes(n))) {
    clock(`normalizeForSpeech on ${name}`, () => normalizeForSpeech(text));
  }
});

test('urls: a long run that ends in an address is still spoken whole, and the real address behind a scheme at its end is found', () => {
  const run = rep('ab.', 3000);
  assert.equal(speakUrls(run + 'com'), (run + 'com').replace(/\./g, ' dot '));   // one address, every dot spoken
  assert.equal(speakUrls('x.' + run + 'http://y.org/z'), oldUrls('x.' + run + 'http://y.org/z'));
  assert.match(speakUrls('x.' + run + 'http://y.org/z'), /y dot org slash z$/);
});
