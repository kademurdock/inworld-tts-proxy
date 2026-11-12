'use strict';
// Nov 8 2026. createLimiter (the cap on simultaneous calls to Inworld and to Fish) lived inside server.js, untested. Its chain
// `fn().then(resolve, reject).finally(() => { active--; next(); })` had no end of its own: a function that throws before it returns a
// promise (instead of returning a rejected one) left its slot taken forever when it was the first in line, and when it was started from
// inside the `.finally` it made that promise reject with nobody listening (an unhandled rejection), the caller never heard back, and
// the slot was lost (route-guard review of Nov 7 2026: "unreachable today", because every caller passes an async function). Now the
// limiter is its own module and survives a function of any kind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLimiter } = require('./call-limiter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: never settled')), ms))]);

// every unhandled rejection that happens while `work` runs
async function watchUnhandled(work) {
  const seen = [];
  const listener = (reason) => seen.push(reason);
  process.on('unhandledRejection', listener);
  try {
    await work();
    await sleep(30); // an unhandled rejection is reported on a later turn
  } finally {
    process.off('unhandledRejection', listener);
  }
  return seen;
}

test('no more than the limit run at once, they start in the order they were asked, and every caller gets its own result', async () => {
  const limit = createLimiter(2);
  let running = 0;
  let peak = 0;
  const started = [];
  const task = (n) => limit(async () => {
    running++;
    peak = Math.max(peak, running);
    started.push(n);
    await sleep(10);
    running--;
    return n * 2;
  });
  const out = await Promise.all([1, 2, 3, 4, 5, 6].map(task));
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6]);
});

test('a rejection reaches the caller who asked, frees the slot, and does not touch the others', async () => {
  const limit = createLimiter(1);
  const results = await Promise.allSettled([
    limit(async () => 'first'),
    limit(async () => { throw new Error('second failed'); }),
    limit(async () => 'third'),
  ]);
  assert.equal(results[0].value, 'first');
  assert.match(results[1].reason.message, /second failed/);
  assert.equal(results[2].value, 'third');
});

test('a function that throws before it returns a promise: its caller hears about it and the limiter keeps working', async () => {
  const limit = createLimiter(1);
  const seen = await watchUnhandled(async () => {
    await assert.rejects(withTimeout(limit(() => { throw new Error('boom now'); }), 500), /boom now/);
    assert.equal(await withTimeout(limit(async () => 'still alive'), 500), 'still alive', 'the one slot was given back');
    assert.equal(await withTimeout(limit(async () => 'and again'), 500), 'and again');
  });
  assert.deepEqual(seen, [], 'nothing was left unhandled');
});

test('a function that throws when its turn comes, from inside the queue: its caller hears about it, nobody is left with an unhandled rejection', async () => {
  const limit = createLimiter(1);
  const seen = await watchUnhandled(async () => {
    const a = limit(async () => { await sleep(20); return 'a'; });
    const b = limit(() => { throw new Error('boom in the queue'); });
    const c = limit(async () => 'c');
    assert.equal(await withTimeout(a, 500), 'a');
    await assert.rejects(withTimeout(b, 500), /boom in the queue/);
    assert.equal(await withTimeout(c, 500), 'c', 'the call behind the one that threw still runs');
  });
  assert.deepEqual(seen, [], 'nothing was left unhandled');
});

test('a function that returns a plain value (not a promise) resolves with it', async () => {
  const limit = createLimiter(2);
  assert.equal(await withTimeout(limit(() => 41 + 1), 500), 42);
  assert.equal(await withTimeout(limit(() => undefined), 500), undefined);
  assert.equal(await withTimeout(limit(async () => 'async'), 500), 'async');
});

test('a thenable that never settles holds its slot, as before (the callers put their own timeouts on the calls)', async () => {
  const limit = createLimiter(1);
  limit(() => new Promise(() => {})).catch(() => {});
  await assert.rejects(withTimeout(limit(async () => 'blocked behind it'), 100), /timeout/);
});

test('server.js uses this module for both of its limiters and keeps no copy of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(src.includes('const { createLimiter } = require("./call-limiter");'), 'server.js requires call-limiter.js');
  assert.ok(!src.includes('function createLimiter('), 'and defines no createLimiter of its own');
  assert.ok(src.includes('const inworldLimiter = createLimiter(MAX_CONCURRENT_INWORLD_CALLS, TTS_LIVE_RESERVE);'), 'the Inworld limiter');
  assert.ok(src.includes('const fishLimiter = createLimiter(MAX_CONCURRENT_FISH_CALLS, TTS_LIVE_RESERVE);'), 'the Fish limiter');
});
