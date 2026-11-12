'use strict';
/* ask-stream-abort.wire.test.js (Nov 12 2026, gateway audit GW-5 step A).
 * The call lane's paced line against a fake site on 127.0.0.1:
 *  - a caller who leaves mid-turn stops the site job (POST /api/agents/chat/abort) and frees the line;
 *  - a caller who leaves while queued never reaches the site;
 *  - a call turn goes ahead of queued background work (LIBRECHAT_LIVE_FIRST=0 puts it back in line);
 *  - the abort retries once after a 401, and a 409 is logged as NOT stopped;
 *  - a failure at the site while nobody listens is logged, not written to a dead socket;
 *  - a normal turn still ends with [DONE] and sends no abort;
 *  - at the production gap (4 s) a barge-in waits LIBRECHAT_LIVE_GAP_MS (1 s), not 4 s;
 *  - a call turn that arrives while a background job waits out the gap still goes first.
 * Each case loads a fresh copy of librechat.js, because it reads its env once at load. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const unhandled = [];
const onUnhandled = (e) => unhandled.push(e);
process.on('unhandledRejection', onUnhandled);
test.after(() => {
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled.map(String), [], 'no unhandled rejection anywhere in this file');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/* The fake site. Every request is recorded with its time. A stream id's behaviour is set in `streams`:
 * 'hold' writes one word and stays open until release(id); anything else writes the word and the final. */
async function fakeSite() {
  const s = { events: [], streams: {}, starts: 0, held: new Map(), startReplies: [], abortReplies: [] };
  const app = express();
  app.use(express.json());
  const rec = (kind, extra = {}) => s.events.push({ kind, t: Date.now(), ...extra });
  app.post('/api/auth/login', (_req, res) => { rec('login'); res.json({ token: 'tok' }); });
  app.post('/api/agents/chat/abort', (req, res) => {
    rec('abort', { streamId: req.body && req.body.streamId });
    const status = s.abortReplies.shift() || 200;
    res.status(status).json({ ok: status === 200 });
  });
  app.post('/api/agents/chat', async (req, res) => {
    const n = ++s.starts;
    rec('start', { n, text: req.body && req.body.text });
    const reply = s.startReplies.shift();
    if (reply) {
      if (reply.delayMs) await sleep(reply.delayMs);
      return res.status(reply.status).send(reply.body || 'slow down');
    }
    res.json({ streamId: `stream-${n}` });
  });
  app.get('/api/agents/chat/stream/:id', (req, res) => {
    rec('subscribe', { streamId: req.params.id });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ event: 'on_message_delta', data: { delta: { content: [{ type: 'text', text: 'Well, ' }] } } })}\n\n`);
    const final = () => res.end(`data: ${JSON.stringify({ final: true, responseMessage: { text: 'Well, hello there.' } })}\n\n`);
    if (s.streams[req.params.id] === 'hold') {
      s.held.set(req.params.id, final);
      res.on('close', () => { rec('stream-closed', { streamId: req.params.id }); s.held.delete(req.params.id); });
    } else final();
  });
  app.get('/api/agents/:id', (req, res) => { rec('agent-get', { id: req.params.id }); res.json({ id: req.params.id }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  s.base = `http://127.0.0.1:${server.address().port}`;
  s.release = (id) => { const f = s.held.get(id); if (f) f(); };
  s.of = (kind) => s.events.filter((e) => e.kind === kind);
  s.close = () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); };
  return s;
}

async function loadProxy(base, env = {}) {
  const all = {
    LIBRECHAT_BASE: base, LIBRECHAT_USER: 'offline@example.invalid', LIBRECHAT_PASS: 'offline',
    LIBRECHAT_PROXY_SECRET: 'offline-secret', LIBRECHAT_MIN_GAP_MS: '50',
    LIBRECHAT_LIVE_FIRST: undefined, LIBRECHAT_LIVE_GAP_MS: undefined, ...env,
  };
  const old = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(all)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete require.cache[require.resolve('./librechat')];
  let router;
  try { router = require('./librechat'); } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { port: server.address().port, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

/* One call-lane turn. leaveAfterFirstToken: destroy the socket once a token arrives (a barge-in).
 * leaveAfterMs: destroy it after that long whatever has arrived. */
function askStream(port, { leaveAfterFirstToken = false, leaveAfterMs = 0, text = 'Hi.' } = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ agentId: 'test-agent', messages: [{ role: 'user', content: text }] });
    const req = http.request({ host: '127.0.0.1', port, path: '/librechat/ask-stream', method: 'POST',
      headers: { Authorization: 'Bearer offline-secret', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
    let body = '', leftAt = 0;
    const leave = () => { if (!leftAt) { leftAt = Date.now(); req.destroy(); resolve({ body, leftAt }); } };
    if (leaveAfterMs) setTimeout(leave, leaveAfterMs);
    req.on('error', () => leave());
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (leaveAfterFirstToken && /"token"/.test(body)) leave(); });
      res.on('end', () => { if (!leftAt) resolve({ body, leftAt: 0 }); });
      res.on('error', () => {});
    });
    req.end(data);
  });
}
function getAgent(port, id) {
  return fetch(`http://127.0.0.1:${port}/librechat/agent?id=${id}`, { headers: { Authorization: 'Bearer offline-secret' } }).then((r) => r.json());
}
function captureLogs() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map(String).join(' ')); };
  return { text: () => lines.join('\n'), restore: () => Object.assign(console, orig) };
}

test('1. a barge-in stops the site job at once and the next call turn starts right after', async () => {
  const site = await fakeSite();
  site.streams['stream-1'] = 'hold';
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try {
    const first = await askStream(px.port, { leaveAfterFirstToken: true });
    assert.ok(first.leftAt);
    const second = askStream(px.port, { text: 'Actually, wait.' });
    await until(() => site.of('abort').length === 1, 1000, 'the abort POST');
    assert.equal(site.of('abort')[0].streamId, 'stream-1');
    assert.ok(site.of('abort')[0].t - first.leftAt < 1000);
    const r2 = await second;
    assert.match(r2.body, /hello there/);
    assert.equal(site.starts, 2);
    const start2 = site.of('start')[1].t;
    assert.ok(start2 - first.leftAt < 1000, `second start ${start2 - first.leftAt}ms after the barge-in`);
    await until(() => /site job stream-1 stopped \(200\)/.test(logs.text()), 1000, 'the stopped line');
  } finally { logs.restore(); await px.close(); await site.close(); }
});

test('2. a caller who leaves while queued never reaches the site', async () => {
  const site = await fakeSite();
  site.streams['stream-1'] = 'hold';
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try {
    const first = askStream(px.port);
    await until(() => site.held.has('stream-1'), 3000, 'turn 1 to be streaming');
    await askStream(px.port, { leaveAfterMs: 100, text: 'queued' });
    await until(() => /caller gone: dropped before the site was asked/.test(logs.text()), 1000, 'the dropped line');
    site.release('stream-1');
    await first;
    await sleep(300);
    assert.equal(site.starts, 1, 'the queued turn never posted a start');
    assert.equal(site.of('abort').length, 0);
  } finally { logs.restore(); await px.close(); await site.close(); }
});

for (const liveFirst of [true, false]) {
  test(`3. a call turn ${liveFirst ? 'goes ahead of' : 'waits behind (LIBRECHAT_LIVE_FIRST=0)'} a queued agent lookup`, async () => {
    const site = await fakeSite();
    site.streams['stream-1'] = 'hold';
    const px = await loadProxy(site.base, liveFirst ? {} : { LIBRECHAT_LIVE_FIRST: '0' });
    const logs = captureLogs();
    try {
      const first = askStream(px.port);
      await until(() => site.held.has('stream-1'), 3000, 'turn 1 to be streaming');
      const lookup = getAgent(px.port, 'agent_x');
      await sleep(50);
      const call = askStream(px.port, { text: 'second call turn' });
      await sleep(50);
      site.release('stream-1');
      await Promise.all([first, lookup, call]);
      const order = site.events.filter((e) => (e.kind === 'start' && e.n === 2) || e.kind === 'agent-get').map((e) => e.kind);
      assert.deepEqual(order, liveFirst ? ['start', 'agent-get'] : ['agent-get', 'start']);
    } finally { logs.restore(); await px.close(); await site.close(); }
  });
}

test('4. the abort retries once after a 401; a 409 is logged as NOT stopped', async () => {
  const site = await fakeSite();
  site.streams['stream-1'] = 'hold';
  site.streams['stream-2'] = 'hold';
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try {
    site.abortReplies.push(401, 200);
    await askStream(px.port, { leaveAfterFirstToken: true });
    await until(() => /site job stream-1 stopped \(200\)/.test(logs.text()), 2000, 'stopped after the re-login');
    assert.equal(site.of('abort').length, 2);
    const loginsAfterFirstStart = site.of('login').filter((e) => e.t >= site.of('start')[0].t).length;
    assert.equal(loginsAfterFirstStart, 1, 'one re-login');

    site.abortReplies.push(409);
    await askStream(px.port, { leaveAfterFirstToken: true });
    await until(() => /site job stream-2 NOT stopped, the site answered 409/.test(logs.text()), 2000, 'the NOT stopped warning');
    assert.doesNotMatch(logs.text(), /site job stream-2 stopped/);
  } finally { logs.restore(); await px.close(); await site.close(); }
});

test('5. a 429 at the site while the caller has left is logged with its text', async () => {
  const site = await fakeSite();
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try {
    site.startReplies.push({ status: 429, delayMs: 300, body: 'Too many messages' });
    await askStream(px.port, { leaveAfterMs: 150 });
    await until(() => /turn failed with nobody listening/.test(logs.text()), 2000, 'the nobody-listening line');
    assert.match(logs.text(), /turn failed with nobody listening \(anti-abuse\/forbidden 429: Too many messages\)/);
    assert.doesNotMatch(logs.text(), /\[lcAskStream\] error:/);
  } finally { logs.restore(); await px.close(); await site.close(); }
});

test('6. a normal turn ends with its words and [DONE], and sends no abort', async () => {
  const site = await fakeSite();
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try {
    const r = await askStream(px.port);
    assert.match(r.body, /"token":"Well, "/);
    assert.match(r.body, /"token":"hello there\."/);
    assert.ok(r.body.trimEnd().endsWith('data: [DONE]'));
    await sleep(100);
    assert.equal(site.of('abort').length, 0);
    assert.equal(site.of('subscribe').length, 1);
    assert.ok(site.of('subscribe')[0].t - site.of('start')[0].t < 250, 'no 300 ms wait before the subscribe');
  } finally { logs.restore(); await px.close(); await site.close(); }
});

test('production gap: a barge-in waits LIBRECHAT_LIVE_GAP_MS (1 s), a background job still waits 4 s', async () => {
  const site = await fakeSite();
  site.streams['stream-1'] = 'hold';
  const px = await loadProxy(site.base, { LIBRECHAT_MIN_GAP_MS: undefined }); // the production 4 s
  const logs = captureLogs();
  try {
    const first = await askStream(px.port, { leaveAfterFirstToken: true });
    const r2 = await askStream(px.port, { text: 'the correction' });
    assert.match(r2.body, /hello there/);
    const waited = site.of('start')[1].t - first.leftAt;
    assert.ok(waited >= 900 && waited < 2000, `the call turn after a barge-in started ${waited}ms later`);
    // A turn that ended normally is followed by the full gap, for a lookup as for anything else.
    const doneAt = Date.now();
    await getAgent(px.port, 'agent_y');
    const gap = site.of('agent-get')[0].t - doneAt;
    assert.ok(gap >= 3700, `the lookup after a finished turn waited only ${gap}ms`);
  } finally { logs.restore(); await px.close(); await site.close(); }
});

test('a call turn that arrives while a lookup waits out the gap goes first', async () => {
  const site = await fakeSite();
  const px = await loadProxy(site.base, { LIBRECHAT_MIN_GAP_MS: '600' });
  const logs = captureLogs();
  try {
    await askStream(px.port); // sets the gap clock
    const lookup = getAgent(px.port, 'agent_z'); // waits ~600 ms for the gap
    await sleep(200);
    const call = askStream(px.port, { text: 'arrived during the gap' });
    await Promise.all([lookup, call]);
    const order = site.events.filter((e) => (e.kind === 'start' && e.n === 2) || e.kind === 'agent-get').map((e) => e.kind);
    assert.deepEqual(order, ['start', 'agent-get']);
  } finally { logs.restore(); await px.close(); await site.close(); }
});
