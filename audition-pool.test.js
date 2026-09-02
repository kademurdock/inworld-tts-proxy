'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LONG, QUICK, pickAudition } = require('./audition-pool');

/* Part 117 (Sep 2 2026): the tag is a FEELING and nothing else. Measured on
 * Voice 595 through this proxy: emotion words move the clock 1-3%, a pace
 * word or a vocal-style word moves it 25-40% (see the header of
 * audition-pool.js and Part 109's table in server.js). That step between
 * paragraphs is the "choppy" she reported. Authored tags reach Inworld
 * verbatim, so the only guard is here. */
const PACE_OR_STYLE = new RegExp(
  '\\b(?:' + [
    // pace (mirrors TEMPO_WORDS in server.js, plus the audition-specific ones)
    'slow(?:ly|er|ing)?', 'unhurried', 'unrushed', 'leisurely', 'languid(?:ly)?',
    'drawn[- ]out', 'dragging', 'lingering', 'ponderous', 'halting', 'measured',
    'deliberate(?:ly)?', 'sluggish', 'crawling', 'glacial', 'lazy', 'lazily',
    'fast(?:er)?', 'quick(?:ly|er)?', 'rapid(?:ly|-fire)?', 'brisk(?:ly)?',
    'hurried(?:ly)?', 'rushed', 'rushing', 'racing', 'breathless(?:ly)?', 'hasty',
    'hastily', 'clipped', 'snappy', 'speedy', 'swift(?:ly)?', 'double[- ]time',
    'picking up speed', 'speeding up', 'slowing down', 'taking (?:your|her|his|their|its) time',
    'no rush', 'at a crawl', 'tempo', 'pace(?:d)?', 'cadence', 'speed', 'rhythmic',
    'urgent(?:ly)?', 'frantic(?:ally)?', 'sleepy', 'drowsy', 'dreamy', 'exhausted',
    // vocal style and volume (Inworld's other axes)
    'hushed', 'whisper(?:ing|ed)?', 'breathy', 'murmur(?:ing|ed)?', 'mumbl(?:e|ing)',
    'shout(?:ing|ed)?', 'yell(?:ing|ed)?', 'scream(?:ing|ed)?', 'loud(?:ly|er)?',
    'quiet(?:ly|er)?', 'soft(?:ly|er)?', 'low', 'high', 'tone', 'pitch', 'sing(?:ing)?',
    'nasal', 'gravelly', 'raspy', 'booming', 'exploding', 'erupting',
    // roles and characters: a tag describes a feeling, not a job
    'newscaster', 'broadcaster', 'announcer', 'auctioneer', 'lawyer', 'grandma',
    'grandpa', 'trainer', 'coach', 'waitress', 'waiter', 'radio', 'host', 'dj',
    'documentary', 'tour guide', 'flight attendant', 'teacher', 'preacher',
    'narrator', 'robot', 'pirate', 'cowboy', 'villain',
  ].join('|') + ')\\b', 'i',
);

const SLOP = [
  /\bI'?m here for you\b/i, /\byou'?ve got this\b/i, /\bit'?s okay to not be okay\b/i,
  /\blet'?s dive in\b/i, /\bat the end of the day\b/i, /\bsit with that\b/i,
  /\bhere'?s the thing\b/i, /\bthat'?s the part that\b/i, /\bjourney\b/i,
  /\bvibes?\b/i, /\bunpack\b/i, /\bnavigate\b/i, /\bself[- ]care\b/i,
  /\bI hear you\b/i, /\bvalid\b/i, /\bspace to\b/i, /\bshow up for\b/i,
  /\bhonestly\b/i, /\bgenuinely\b/i, /\bliterally\b/i,
  /—/, // em dash
];

function tagsOf(script) {
  return script.split('\n\n').map((p) => {
    const m = p.match(/^%%%([^%]*)%%% (.+)$/s);
    assert.ok(m, 'paragraph opens with exactly one tag: ' + p.slice(0, 60));
    return { tag: m[1], words: m[2] };
  });
}

test('the pool is a bucket: at least 50 long scripts and 50 quick lines', () => {
  assert.ok(LONG.length >= 50, `LONG ${LONG.length}`);
  assert.ok(QUICK.length >= 50, `QUICK ${QUICK.length}`);
});

test('every long script is 1-3 tagged paragraphs of 1-5 sentences, at least 3 sentences in all (117.7: shorter ones allowed)', () => {
  for (const s of LONG) {
    const paras = tagsOf(s);
    assert.ok(paras.length >= 1 && paras.length <= 3, s.slice(0, 50));
    let totalSentences = 0;
    for (const { words } of paras) {
      const n = (words.match(/[.!?]+/g) || []).length;
      assert.ok(n >= 1 && n <= 5, `1-5 sentences: ${n} in ${words.slice(0, 50)}`);
      totalSentences += n;
    }
    assert.ok(totalSentences >= 3, `more than two short sentences: ${totalSentences} in ${s.slice(0, 50)}`);
  }
});

test('quick lines are one tag and under 160 chars', () => {
  for (const q of QUICK) {
    tagsOf(q);
    assert.ok(q.length <= 160, `${q.length}: ${q}`);
  }
});

test('every tag is lowercase feeling words: no commas, no punctuation, no pace, no style, no role', () => {
  for (const s of [...LONG, ...QUICK]) {
    for (const { tag } of tagsOf(s)) {
      assert.ok(tag.length >= 3 && tag.length <= 80, 'tag length: ' + tag);
      assert.ok(!/[,.!?;:"()]/.test(tag), 'no punctuation inside a tag: ' + tag);
      assert.equal(tag, tag.toLowerCase(), 'tags are lowercase: ' + tag);
      const hit = tag.match(PACE_OR_STYLE);
      assert.ok(!hit, `tag carries a pace, style or role word "${hit && hit[0]}": [${tag}]`);
    }
  }
});

test('no shouting in the words: capitals are Inworld emphasis and re-time the sentence', () => {
  for (const s of [...LONG, ...QUICK]) {
    for (const { words } of tagsOf(s)) {
      const caps = words.match(/\b[A-Z]{3,}\b/g);
      assert.ok(!caps, `caps word ${caps && caps[0]} in: ${words.slice(0, 60)}`);
    }
  }
});

test('nothing in the pool names a real person or character on the platform', () => {
  const banned = /\b(kade|kiana|forge|amber|della|zadiana|deuce|koji|lyric|cadence|earl|marisol|vinyl|cole|wade|nia)\b/i;
  for (const s of [...LONG, ...QUICK]) assert.ok(!banned.test(s), s.slice(0, 60));
});

test('nothing in the pool is about being a voice, and nothing is slop', () => {
  const meta = /\b(pick me|this voice|the voice for|seven hundred of us|number twelve|scrolling)\b/i;
  for (const s of [...LONG, ...QUICK]) {
    assert.ok(!meta.test(s), 'no voice-about-itself lines: ' + s.slice(0, 60));
    for (const re of SLOP) assert.ok(!re.test(s), `slop ${re} in: ${s.slice(0, 60)}`);
  }
});

test('no two scripts in a pool share an opening line (quick lines may echo a long one)', () => {
  for (const pool of [LONG, QUICK]) {
    const seen = new Set();
    for (const s of pool) {
      const first = s.split('\n\n')[0].replace(/^%%%[^%]*%%% /, '').slice(0, 40);
      assert.ok(!seen.has(first), 'duplicate opener: ' + first);
      seen.add(first);
    }
  }
});

test('pickAudition never repeats immediately and covers the pool', () => {
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 1500; i++) {
    const x = pickAudition(LONG, 'test');
    assert.notEqual(x, last);
    last = x;
    seen.add(x);
  }
  assert.equal(seen.size, LONG.length);
});
