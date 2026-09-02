'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LONG, QUICK, pickAudition } = require('./audition-pool');

test('every long script is 3-4 tagged paragraphs of 1-5 sentences, no commas in tags', () => {
  assert.ok(LONG.length >= 20, `pool is a bucket, not a template: ${LONG.length}`);
  for (const s of LONG) {
    const paras = s.split('\n\n');
    assert.ok(paras.length >= 3 && paras.length <= 4, s.slice(0, 40));
    for (const p of paras) {
      const m = p.match(/^%%%([^%]*)%%% (.+)$/);
      assert.ok(m, 'paragraph opens with one tag: ' + p.slice(0, 40));
      assert.ok(!m[1].includes(','), 'no comma inside a tag: ' + m[1]);
      const n = (m[2].match(/[.!?]+/g) || []).length;
      assert.ok(n >= 1 && n <= 5, `1-5 sentences: ${n} in ${m[2].slice(0, 40)}`);
    }
  }
});

test('quick lines are one tag, at most two-ish sentences, under 160 chars', () => {
  assert.ok(QUICK.length >= 24);
  for (const q of QUICK) {
    assert.match(q, /^%%%[^%,]*%%% /);
    assert.ok(q.length <= 160, q);
  }
});

test('nothing in the pool names a real person or character on the platform', () => {
  const banned = /\b(kade|kiana|forge|amber|della|zadiana|deuce|koji|lyric|cadence|earl)\b/i;
  for (const s of [...LONG, ...QUICK]) assert.ok(!banned.test(s), s.slice(0, 60));
});

test('pickAudition never repeats immediately and covers the pool', () => {
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 400; i++) {
    const x = pickAudition(LONG, 'test');
    assert.notEqual(x, last);
    last = x;
    seen.add(x);
  }
  assert.equal(seen.size, LONG.length);
});
