'use strict';
// Nov 6 2026: a stray %%% must not turn the next tag into speech (steering-balance.js). Kiana's last message
// to Kade held "%%%\n%%%warm and curious%%% So what's the shape of it?" and the voice said "warm and curious".
const test = require('node:test');
const assert = require('node:assert/strict');
const { balanceSteeringRuns, tagBody, unclosedLine } = require('./steering-balance');

const pairs = (s) => [...s.matchAll(/%%%([^%]*)%%%/g)].map((m) => m[1]);
const strip = (s) => s.replace(/%%%[^%]*%%%/g, '');

test('the incident: an empty %%% line before a real tag no longer flips it into speech', () => {
  const msg = "%%%to correct with respect%%%\nYeah, you're right, that's on me. The paper trail is thin.\n\n%%%\n%%%warm and curious%%% So what's the shape of it? How far back have you gotten?";
  const out = balanceSteeringRuns(msg);
  assert.deepEqual(pairs(out), ['to correct with respect', 'warm and curious']);
  assert.ok(!/%\s*%/.test(strip(out)), 'no delimiter left over: ' + JSON.stringify(strip(out)));
  assert.doesNotMatch(strip(out), /warm and curious/, 'the direction is a tag, not words in the speech');
  assert.match(strip(out), /So what's the shape of it\? How far back have you gotten\?/);
});

test('well-formed messages come back exactly as they were', () => {
  for (const s of [
    'no tags at all, just 50% of the words',
    '%%%warm and curious%%% So what do you think?',
    '%%%amused%%%\nOne.\n\n%%%a little worried%%%\nTwo. %%%a beat%%% Three.',
    'Before. %%%soft%%% middle %%%reset%%% after.',
    '%%%interested like she\'s leaning into a good question%%% Go on.',
  ]) assert.equal(balanceSteeringRuns(s), s, s);
  assert.equal(balanceSteeringRuns(''), '');
  assert.equal(balanceSteeringRuns(null), '');
});

test('strays of every shape are dropped and the tags after them still read as tags', () => {
  const tag = '%%%warm and curious%%% So what now?';
  for (const [name, input] of [
    ['empty line', `Before.\n\n%%%\n${tag}`],
    ['blank between', `Before.\n%%% %%%${tag.slice(3)}`],
    ['two strays', `Before.\n%%%\n%%%\n${tag}`],
    ['longer stray', `Before.\n%%%%%\n${tag}`],
    ['stray after the tag', `${tag}\n%%%\nAfter.`],
    ['doubled opener', `Before.\n%%%%%%warm and curious%%% So what now?`],
    ['doubled closer', `Before.\n%%%warm and curious%%%%%% So what now?`],
    ['stray at the very start', `%%%\n${tag}`],
    ['stray at the very end', `${tag}\n%%%`],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), ['warm and curious'], name + ': ' + JSON.stringify(out));
    assert.doesNotMatch(strip(out), /warm and curious/, name);
    assert.ok(!/%\s*%/.test(strip(out)), name + ' leaves a delimiter: ' + JSON.stringify(strip(out)));
    assert.match(strip(out), /So what now\?/, name);
  }
});

test('glued runs read as closer + opener: two tags back to back, kept apart so nothing downstream mis-pairs them', () => {
  const out = balanceSteeringRuns('%%%warm%%%%%%curious%%% Hello there.');
  assert.deepEqual(pairs(out), ['warm', 'curious']);
  assert.equal(strip(out).trim(), 'Hello there.');
  assert.doesNotMatch(out, /%{4,}/, 'no run of four or more percent signs is ever emitted: ' + JSON.stringify(out));
});

test('a tag whose closer was forgotten, alone on a short line, is still a direction', () => {
  const out = balanceSteeringRuns('Before.\n%%%warm and curious\nSo what now? It is up to you.\n\n%%%soft%%% And after.');
  assert.deepEqual(pairs(out), ['warm and curious', 'soft']);
  assert.doesNotMatch(strip(out), /warm and curious/);
  assert.match(strip(out), /So what now\? It is up to you\./);
  assert.match(strip(out), /And after\./);
  // the closer on a line of its own
  const own = balanceSteeringRuns('Before.\n%%%warm and curious\n%%%\nSo what now?');
  assert.deepEqual(pairs(own), ['warm and curious']);
  assert.doesNotMatch(strip(own), /warm and curious/);
  assert.match(strip(own), /So what now\?/);
  // nothing after it: the direction is swallowed, never spoken
  assert.doesNotMatch(strip(balanceSteeringRuns('Before.\n%%%warm and curious')), /warm and curious/);
});

test('speech is never swallowed: an opener followed by a sentence, or by a long line, is only a stray', () => {
  assert.equal(strip(balanceSteeringRuns('%%% Hello there, how are you.\nNext line.')).replace(/\s+/g, ' ').trim(), 'Hello there, how are you. Next line.');
  const long = 'This is a long line of ordinary speech that goes on well past eighty characters without any punctuation at all really';
  assert.equal(strip(balanceSteeringRuns('%%%' + long + '\nNext.')).replace(/\s+/g, ' ').trim(), long + ' Next.');
  assert.equal(strip(balanceSteeringRuns('Before %%% after')).replace(/\s+/g, ' ').trim(), 'Before after');
});

test('the helpers: what counts as a direction body and as an unclosed line', () => {
  assert.equal(tagBody('warm and curious'), 'warm and curious');
  assert.equal(tagBody('  quietly  '), 'quietly');
  for (const bad of ['', ' ', '\n', '12', 'two\nlines', 'x'.repeat(300)]) assert.equal(tagBody(bad), null, JSON.stringify(bad.slice(0, 12)));
  assert.equal(unclosedLine('warm and curious\nSo what?'), 'warm and curious');
  assert.equal(unclosedLine('Hello there.\nNext'), null);
  assert.equal(unclosedLine('\nwarm'), null);
});

// A seeded generator of messages the way models actually break them. Every tag carries a unique marker
// word; the invariant is that no marker is ever left in the speech, no prose word is lost, and no
// delimiter survives outside a pair.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const PROSE = ["Yeah, you're right.", 'That is on me.', 'The paper trail is thin.', 'So what is the shape of it?', 'How far back have you gotten?', 'Two different problems.', 'I would go and look.', 'Not a chance.', 'Okay then, let us see.']
const DIRS = ['warm and curious', 'to correct with respect', 'a little amused', 'quietly', 'interested like she is leaning in', 'dry and flat', 'soft but sure'];

function build(r, n) {
  const items = [];
  let marker = 0;
  for (let k = 0; k < n; k++) {
    if (r() < 0.55) items.push({ type: 'tag', body: `${DIRS[Math.floor(r() * DIRS.length)]} zq${marker++}x` });
    items.push({ type: 'prose', text: PROSE[Math.floor(r() * PROSE.length)] });
  }
  return items;
}

function corrupt(r, items) {
  let out = '';
  const strays = ['%%%', '%%', '%%%%', '%%%%%'];
  items.forEach((it, idx) => {
    if (r() < 0.35) out += (r() < 0.6 ? '\n' : ' ') + strays[Math.floor(r() * strays.length)] + (r() < 0.7 ? '\n' : ' '); // a stray run
    if (it.type === 'prose') { out += (out && !/\s$/.test(out) ? ' ' : '') + it.text; return; }
    const open = '%'.repeat(2 + Math.floor(r() * 4));       // 2..5
    const close = '%'.repeat(2 + Math.floor(r() * 4));
    const pad = r() < 0.2 ? ' ' : '';
    const lineStart = out === '' || out.endsWith('\n');
    if (lineStart && r() < 0.15) {                           // forgot the closer, tag alone on its line
      out += open + it.body + '\n';
      return;
    }
    out += (out && !/\s$/.test(out) ? (r() < 0.5 ? '\n\n' : ' ') : '') + open + pad + it.body + pad + close + (r() < 0.5 ? ' ' : '\n');
    if (r() < 0.1) out += '%'.repeat(2 + Math.floor(r() * 3)) + '\n';
  });
  return out;
}

test('fuzz: across 4,000 broken messages no direction word is ever left in the speech and no prose is lost', () => {
  const r = rng(20261106);
  let leaks = 0;
  let lost = 0;
  const examples = [];
  for (let trial = 0; trial < 4000; trial++) {
    const items = build(r, 2 + Math.floor(r() * 5));
    const msg = corrupt(r, items);
    const out = balanceSteeringRuns(msg);
    const speech = strip(out);
    if (/%{4,}/.test(out)) leaks++;   // a touching pair would defeat the converter that follows
    const markers = items.filter((i) => i.type === 'tag').map((i) => i.body.match(/zq\d+x/)[0]);
    const bad = markers.filter((m) => speech.includes(m));
    const prose = items.filter((i) => i.type === 'prose').map((i) => i.text).join(' ').replace(/\s+/g, ' ');
    const left = speech.replace(/%+/g, '').replace(/\s+/g, ' ').trim();
    if (bad.length || /%/.test(speech) || left !== prose) {
      if (bad.length) leaks++; else lost++;
      if (examples.length < 3) examples.push({ msg, out });
    }
  }
  assert.equal(leaks + lost, 0, `${leaks} leaks, ${lost} lost/extra; first: ${JSON.stringify(examples[0])}`);
});
