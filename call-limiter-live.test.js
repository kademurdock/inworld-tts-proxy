'use strict';
// Nov 12 2026 (gateway audit GW-9): a live call's sentence never waits behind a read-aloud, and an abandoned request gives its place up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { createLimiter } = require('./call-limiter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a live call starts ahead of every queued read-aloud chunk, on the slot kept for it', async () => {
  const limit = createLimiter(6, 1);
  const started = [];
  let running = 0;
  let peak = 0;
  const reads = Array.from({ length: 30 }, (_, i) => limit(async () => { started.push(`read${i}`); running++; peak = Math.max(peak, running); await sleep(40); running--; }));
  await sleep(5);
  assert.equal(peak, 5, 'a read-aloud fills five of the six slots');
  const t0 = Date.now();
  let waited = -1;
  const call = limit(async () => { waited = Date.now() - t0; started.push('call'); }, { live: true });
  await Promise.all([...reads, call]);
  assert.ok(waited < 15, `the call waited ${waited} ms`);
  assert.equal(started.indexOf('call'), 5, 'right after the five that were already running');
  assert.equal(peak, 5);
});

test('live calls may use every slot, and never more than the limit', async () => {
  const limit = createLimiter(3, 1);
  let running = 0;
  let peak = 0;
  const job = () => limit(async () => { running++; peak = Math.max(peak, running); await sleep(10); running--; }, { live: true });
  await Promise.all(Array.from({ length: 9 }, job));
  assert.equal(peak, 3);
});

test('without a reserve a live call still jumps the queue: it waits for one slot, not for the read', async () => {
  const limit = createLimiter(2);
  const reads = Array.from({ length: 20 }, () => limit(() => sleep(30)));
  await sleep(5);
  const t0 = Date.now();
  let waited = -1;
  await limit(async () => { waited = Date.now() - t0; }, { live: true });
  assert.ok(waited < 60, `waited ${waited} ms`);
  await Promise.all(reads);
});

test('an abandoned queued request is dropped before it runs, frees its place, and leaves no listener behind', async () => {
  const limit = createLimiter(1);
  const gone = new AbortController();
  const stays = new AbortController();
  let ran = false;
  const first = limit(() => sleep(30), { signal: stays.signal });
  const abandoned = limit(async () => { ran = true; }, { signal: gone.signal });
  const third = limit(async () => 'third', { signal: stays.signal });
  assert.equal(getEventListeners(stays.signal, 'abort').length, 1, 'the running call took its listener off; the queued one keeps its own');
  gone.abort();
  await assert.rejects(abandoned, (e) => e.name === 'AbortError' && e.isAbandoned === true);
  await first;
  assert.equal(await third, 'third');
  assert.equal(ran, false);
  assert.equal(getEventListeners(stays.signal, 'abort').length, 0);
  assert.equal(getEventListeners(gone.signal, 'abort').length, 0);
  await assert.rejects(limit(async () => 'late', { signal: gone.signal }), (e) => e.isAbandoned === true, 'a signal that already fired never queues');
});

test('a signal that fires while its call is running does not touch the limiter: the call answers for itself', async () => {
  const limit = createLimiter(1);
  const gone = new AbortController();
  const running = limit(async () => { await sleep(20); return 'finished'; }, { signal: gone.signal });
  gone.abort();
  assert.equal(await running, 'finished');
  assert.equal(await limit(async () => 'next'), 'next');
});

test('TTS_LIVE_FIRST=0: no live lane and no reserve, every slot is back for everyone', async () => {
  process.env.TTS_LIVE_FIRST = '0';
  try {
    const limit = createLimiter(2, 1);
    const order = [];
    let running = 0;
    let peak = 0;
    const job = (n, opts) => limit(async () => { order.push(n); running++; peak = Math.max(peak, running); await sleep(10); running--; }, opts);
    await Promise.all([job(1), job(2), job(3), job(4, { live: true }), job(5)]);
    assert.equal(peak, 2);
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
  } finally {
    delete process.env.TTS_LIVE_FIRST;
  }
});

test('a reserve or a limit that is not a number never leaves a queue that nothing leaves', async () => {
  const withTimeout = (p) => Promise.race([p, sleep(200).then(() => { throw new Error('never ran'); })]);
  assert.equal(await withTimeout(createLimiter(6, NaN)(async () => 'a')), 'a');
  assert.equal(await withTimeout(createLimiter(6, -3)(async () => 'b')), 'b');
  assert.equal(await withTimeout(createLimiter(6, 99)(async () => 'c')), 'c', 'a reserve as big as the limit still leaves one slot for the rest');
  assert.equal(await withTimeout(createLimiter(NaN, 1)(async () => 'd')), 'd');
  assert.equal(await withTimeout(createLimiter(0, 1)(async () => 'e')), 'e');
});

test('no options: the old first-in, first-out order', async () => {
  const limit = createLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3, 4].map((n) => limit(async () => { order.push(n); await sleep(2); })));
  assert.deepEqual(order, [1, 2, 3, 4]);
});
