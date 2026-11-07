'use strict';
// Nov 6 2026 (a known limit of steering-balance.js that four red-team rounds left open on purpose): a stray %%% that
// sat ALONE ON ITS LINE, between two lines of text, was dropped but its line stayed behind as a blank line. A blank line
// is a paragraph break, so the reply grew a paragraph it never had, and applySteeringTags, which carries the last
// direction onto the paragraphs that open with none and stops after STEER_CARRY_MAX (2) of them, counted one more
// paragraph than the old pairing did: the carry ended one paragraph early, and a direction that should still have been
// stamped on the third paragraph after it was not. The line goes with the stray now when both its neighbours are text
// (next to a blank line it has always been a paragraph break already, and nothing changes there).
// The shipped applySteeringTags is sliced out of server.js (never a copy), the way steering-balance-parity.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sounds = require('./sounds');
const { balanceSteeringRuns, setRepairLogger } = require('./steering-balance');

function loadApplySteeringTags(balance) {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const helperStart = src.indexOf('const CARRY_TEMPO_STRIP =');
  const start = src.indexOf('function applySteeringTags(text) {');
  assert.ok(helperStart > -1 && start > helperStart, 'applySteeringTags and its helper must be in server.js');
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > -1, 'could not bracket-match applySteeringTags');
  const ctx = {
    STEERING_OPEN: '%%%', STEERING_CLOSE: '%%%', STEER_CARRY_MAX: 2,
    soundsIsDirectionTag: sounds.isDirectionTag, soundsIsResetTag: sounds.isResetTag,
    balanceSteeringRuns: balance,
    vocalizeDirection: (s) => s,
    sanitizeDirectionText: (s) => String(s).replace(/\s{2,}/g, ' ').trim(),
    module: {}, exports: {}, process: { env: {} },
    console: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(helperStart, end) + '\nthis.fn = applySteeringTags;', ctx);
  return ctx.fn;
}
const oldPairing = loadApplySteeringTags((s) => s);          // the balancer switched off
const withBalancer = loadApplySteeringTags(balanceSteeringRuns);

// what each paragraph carries in front of it: its [direction], or nothing
const stamps = (out) => String(out).split(/\n\s*\n+/).filter((p) => p.trim()).map((p) => (/^\s*\[([^\]]+)\]/.exec(p) || [])[1] || '');
const speech = (out) => String(out).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

// ── the balancer ────────────────────────────────────────────────────────────────────────────────────────────────────
test('a stray alone on its line, between two lines of text, takes its line with it', () => {
  for (const [input, want] of [
    ['First line.\n%%%\nSecond line.', 'First line.\nSecond line.'],
    ['First line.\r\n%%%\r\nSecond line.', 'First line.\r\nSecond line.'],
    ['First line.\n%%%%%\nSecond line.', 'First line.\nSecond line.'],                       // any size
    ['First line.\n   %%%   \nSecond line.', 'First line.\n   Second line.'],                 // (the blanks in front of it stay)
    ['One.\n%%%\n%%%\nTwo.', 'One.\nTwo.'],                                                  // two stray lines in a row
    ['One.\n%%%\n%%%%%%\n%%\nTwo.', 'One.\nTwo.'],
    ['%%%b%%%\n%%%\n Hello there.', '%%%b%%%\n Hello there.'],                                // between a tag and its speech
    ['Hello there\n%%%\nfriend', 'Hello there\nfriend'],                                     // nothing fuses, nothing is added
    ['First.\n%%%\n' + ' '.repeat(100) + 'Second.', 'First.\n' + ' '.repeat(100) + 'Second.'],   // an indented next line is a line of text
    ['First.\n%%%\r\nSecond.', 'First.\nSecond.'],                                           // (a mixed ending keeps the one after the stray's line out)
  ]) assert.equal(balanceSteeringRuns(input), want, JSON.stringify(input));
  // a next line that starts further than the look-ahead reaches is not recognised: the stray line is left as it always was
  const far = 'First.\n%%%\n' + ' '.repeat(500) + 'Second.';
  assert.equal(balanceSteeringRuns(far), 'First.\n\n' + ' '.repeat(500) + 'Second.');
});

test('next to a blank line, or at an end of the text, the stray line leaves what it always left', () => {
  for (const [input, want] of [
    ['First.\n\n%%%\nSecond.', 'First.\n\n\nSecond.'],
    ['First.\n%%%\n\nSecond.', 'First.\n\n\nSecond.'],
    ['First.\n\n%%%\n\nSecond.', 'First.\n\n\n\nSecond.'],
    ['%%%\nSecond.', '\nSecond.'],
    ['\n%%%\nSecond.', '\n\nSecond.'],                                                          // nothing in front of it to keep a line from
    ['First.\n%%%\n  \nSecond.', 'First.\n\n  \nSecond.'],                                      // the next line is only blanks
    ['First.\n%%%\n \t \n\nSecond.', 'First.\n\n \t \n\nSecond.'],
    ['First.\n%%%', 'First.\n'],
    ['First.\n%%%\n', 'First.\n\n'],
    // the incident of Nov 6: a blank line in front of the stray, the real tag right behind it
    ["Two different problems.\n\n%%%\n%%%warm and curious%%% So what's the shape of it?", "Two different problems.\n\n\n%%%warm and curious%%% So what's the shape of it?"],
  ]) assert.equal(balanceSteeringRuns(input), want, JSON.stringify(input));
});

test('a stray that shares its line with anything is dropped as before, and the repair is still reported', () => {
  assert.equal(balanceSteeringRuns('First.\nSecond %%% line.\nThird.'), 'First.\nSecond  line.\nThird.');
  assert.equal(balanceSteeringRuns('First.\nSecond%%%line.\nThird.'), 'First.\nSecond line.\nThird.');
  assert.equal(balanceSteeringRuns('First.\n%%% Second.\nThird.'), 'First.\n Second.\nThird.');
  assert.equal(balanceSteeringRuns('First.\nSecond.%%%\nThird.'), 'First.\nSecond.\nThird.');
  const seen = [];
  setRepairLogger((r) => seen.push(r));
  try {
    balanceSteeringRuns('First line.\n%%%\nSecond line.');
    assert.deepEqual(seen, [{ strays: 1, closed: 0 }]);
  } finally { setRepairLogger(null); }
});

// ── what it was for: the carry-forward cap ──────────────────────────────────────────────────────────────────────────
test('the carry-forward cap counts the paragraphs the reply has, with or without a stray line inside one', () => {
  // one direction, five paragraphs, a stray line inside the first
  const strayed = '%%%warm%%% A.\n%%%\nB.\n\nC.\n\nD.\n\nE.';
  const clean = '%%%warm%%% A.\nB.\n\nC.\n\nD.\n\nE.';
  // the old pairing counts A and B as one paragraph (the stray line is swept only at the very end, which is when a blank
  // line appears in what it hands on): C and D carry the direction, E is where it stops
  assert.deepEqual(stamps(oldPairing(strayed)).filter(Boolean), ['warm', 'warm', 'warm', 'reset']);
  // the balancer used to count A and B as two, so D was where it stopped and E carried nothing
  assert.deepEqual(stamps(withBalancer(strayed)), ['warm', 'warm', 'warm', 'reset']);
  assert.deepEqual(stamps(withBalancer(strayed)), stamps(withBalancer(clean)));
  assert.equal(speech(withBalancer(strayed)), 'A. B. C. D. E.');
});

// A reply in the shape the platform produces, but with only SOME paragraphs opening on a direction, so that the carry runs.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const PROSE = ["Yeah, you're right.", 'That is on me.', 'The paper trail is thin.', 'So what is the shape of it?', 'How far back have you gotten?', 'Two different problems.', 'I would go and look.', 'Not a chance.', 'Okay then, let us see.'];
const DIRS = ['warm and curious', 'to correct with respect', 'a little amused', 'quietly', 'dry and flat', 'soft but sure', 'pleased', 'a beat'];
function reply(r) {
  const paragraphs = [];
  for (let p = 0, n = 2 + Math.floor(r() * 5); p < n; p++) {
    const sentences = [];
    for (let s = 0, m = 1 + Math.floor(r() * 3); s < m; s++) sentences.push(PROSE[Math.floor(r() * PROSE.length)]);
    paragraphs.push({ dir: p === 0 || r() < 0.35 ? DIRS[Math.floor(r() * DIRS.length)] : null, text: sentences.join(' ') });
  }
  return paragraphs.map((p) => (p.dir ? `%%%${p.dir}%%% ` : '') + p.text).join('\n\n');
}

test('fuzz: a stray line put anywhere a model would put one changes no paragraph\'s stamp, against the same reply without it (3,000 replies, 5 strays each)', () => {
  const r = rng(20261111);
  let checked = 0;
  for (let trial = 0; trial < 3000; trial++) {
    const clean = reply(r);
    const want = stamps(withBalancer(clean));
    // a stray line goes where a sentence ends, after a tag, or where a paragraph starts or ends
    const cuts = [];
    for (let at = 0; at <= clean.length; at++) {
      const prev = clean.slice(0, at).trimEnd().slice(-1);
      if (clean[at - 1] === '%' && clean[at] === '%') continue;
      if (/[.?!%]/.test(prev) || at === 0) cuts.push(at);
    }
    for (let k = 0; k < 5; k++) {
      const at = cuts[Math.floor(r() * cuts.length)];
      const msg = clean.slice(0, at) + '\n%%%\n' + clean.slice(at);
      const got = stamps(withBalancer(msg));
      assert.deepEqual(got, want, `a stray line moved a stamp: ${JSON.stringify(msg)}`);
      assert.equal(speech(withBalancer(msg)), speech(withBalancer(clean)), `a stray line changed the speech: ${JSON.stringify(msg)}`);
      checked += 1;
    }
  }
  assert.equal(checked, 15000);
});

// ── the paragraph break the stray's line was ────────────────────────────────────────────────────────────────────────
// An independent review (Nov 7 2026) found that taking the stray's line away also took away the blank line the forgotten-closer
// rule leaned on: after a line that ends in a letter or a comma, `%%%pleased Thanks.` is a sentence start only when a blank
// line came between, and the stray used to supply it. The direction word was then SPOKEN. The line still goes (the cap fix
// above), but the paragraph break it was is remembered until anything but blanks is written.
test('a stray line before a tag whose closer was forgotten still lets the tag be closed, after a line that ends in a letter or a comma', () => {
  for (const [input, want] of [
    ['Dear Kade,\n%%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],
    ['Hello there\n%%%\n%%%pleased Thanks for coming over.', 'Hello there\n%%%pleased%%% Thanks for coming over.'],
    ['Hi Kade,\n%%%\n%%%warm Good to see you again.', 'Hi Kade,\n%%%warm%%% Good to see you again.'],
    ['Chapter Three\n%%%\n%%%wry Dear Kade, it was a long night.', 'Chapter Three\n%%%wry%%% Dear Kade, it was a long night.'],
    ['# Chapter Three\n%%%\n%%%wry Dear Kade, it was a long night.', '# Chapter Three\n%%%wry%%% Dear Kade, it was a long night.'],   // (a heading is a line that ends in a letter)
    ['Dear Kade,\r\n%%%\r\n%%%pleased Thanks for coming over.', 'Dear Kade,\r\n%%%pleased%%% Thanks for coming over.'],
    ['Dear Kade,\n \t%%% \t\n%%%pleased Thanks for coming over.', 'Dear Kade,\n \t%%%pleased%%% Thanks for coming over.'],
    ['Dear Kade,\n%%%\n%%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],      // two stray lines in a row
    ['Dear Kade,\n%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],          // any size
    ['Dear Kade,\n%%%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],
    ['Dear Kade,\n%%%%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],
    ['Dear Kade,\n%%%%%%\n%%%pleased Thanks for coming over.', 'Dear Kade,\n%%%pleased%%% Thanks for coming over.'],
    ['Dear Kade,\n%%%\n  %%%pleased Thanks for coming over.', 'Dear Kade,\n  %%%pleased%%% Thanks for coming over.'],      // blanks in front of the tag do not end it
    ['Dear Kade,\n%%%\n%%%pleased\nThanks for coming over.', 'Dear Kade,\n%%%pleased%%%\nThanks for coming over.'],       // the tag alone on its line
  ]) assert.equal(balanceSteeringRuns(input), want, JSON.stringify(input));
});

test('what that never did stays as it was: the reply without the stray, speech that opens like speech, text written in between, a blank line in front', () => {
  // without any stray the forgotten closer after a comma line is not repaired (a known limit of the head rule): the word is spoken
  assert.equal(balanceSteeringRuns('Dear Kade,\n%%%pleased Thanks for coming over.'), 'Dear Kade,\npleased Thanks for coming over.');
  // speech that opens like speech is never taken for a direction
  assert.equal(balanceSteeringRuns('Dear Kade,\n%%%\n%%%yeah okay so then'), 'Dear Kade,\nyeah okay so then');
  // the remembered break ends with the first text written after it
  assert.equal(balanceSteeringRuns('Dear Kade,\n%%%\nShe walked in and sat down by the window, and then she waited\n%%%pleased Thanks for coming over.'),
    'Dear Kade,\nShe walked in and sat down by the window, and then she waited\npleased Thanks for coming over.');
  // a blank line in front of the stray: nothing to restore, the line stays as it always did
  assert.equal(balanceSteeringRuns('Dear Kade,\n\n%%%\n%%%pleased Thanks for coming over.'), 'Dear Kade,\n\n\n%%%pleased%%% Thanks for coming over.');
  // only a stray ALONE on its line leaves the break: one that shares its line with text changes nothing about the line after it
  assert.equal(balanceSteeringRuns('Dear Kade,%%%\n%%%pleased Thanks for coming over.'), 'Dear Kade,\npleased Thanks for coming over.');
  assert.equal(balanceSteeringRuns('Dear Kade, %%%\n%%%pleased Thanks for coming over.'), 'Dear Kade, \npleased Thanks for coming over.');
  assert.equal(balanceSteeringRuns('Dear Kade,%%%%%\n%%%pleased Thanks for coming over.'), 'Dear Kade,\npleased Thanks for coming over.');
});

test('through the shipped applySteeringTags: the direction is a cue, never speech, and nothing else of the reply moves', () => {
  for (const [input, dir, rest] of [
    ['Dear Kade,\n%%%\n%%%pleased Thanks for coming over.', 'pleased', 'Dear Kade, Thanks for coming over.'],
    ['# Chapter Three\n%%%\n%%%wry Dear Kade, it was a long night.', 'wry', '# Chapter Three Dear Kade, it was a long night.'],
  ]) {
    const out = withBalancer(input);
    assert.match(out, new RegExp(`\\[${dir}\\]`), `${dir} must become a cue: ${JSON.stringify(out)}`);
    assert.equal(speech(out), rest, JSON.stringify(input));
  }
});

test('fuzz: a stray line, any size, any number, after any line that ends in a letter or a comma, in front of a tag with a forgotten closer: the direction is never speech (4,000 replies)', () => {
  const r = rng(20261107);
  const OPENERS = ['Dear Kade,', 'Hi Kade,', 'Hello there', 'Chapter Three', '# Chapter Three', 'Well,', 'So here is the thing', 'Good morning'];
  const SIZES = ['%%', '%%%', '%%%%', '%%%%%', '%%%%%%'];
  const BLANKS = ['', '', ' ', ' \t'];
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (let trial = 0; trial < 4000; trial++) {
    const eol = r() < 0.2 ? '\r\n' : '\n';
    const opener = pick(OPENERS);
    const dir = pick(DIRS);
    const prose = pick(PROSE);
    let msg = opener + eol;
    for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) msg += pick(BLANKS) + pick(SIZES) + pick(BLANKS) + eol;
    msg += pick(['', '', '  ']) + `%%%${dir} ${prose}`;
    const out = balanceSteeringRuns(msg);
    const tags = [...out.matchAll(/%%%([^%]*)%%%/g)].map((m) => m[1].trim());
    assert.deepEqual(tags, [dir], `the direction must be a tag: ${JSON.stringify(msg)} -> ${JSON.stringify(out)}`);
    assert.equal(out.replace(/%%%[^%]*%%%/g, ' ').replace(/\s+/g, ' ').trim(), `${opener} ${prose}`, `the speech must be the opener and the prose: ${JSON.stringify(msg)}`);
  }
});
