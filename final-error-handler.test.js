'use strict';
// Nov 7 2026, step 2 of the route-guard series. async-routes.js (step 1) sends the rejection of any handler to next(err);
// finalErrorHandler is the error middleware that server.js mounts after the last route. It answers 500 {"error":"Proxy
// internal error"} (no stack, no message), keeps a 4xx that an HTTP library attached (body-parser's 400 and 413), logs the
// cause whatever was thrown, and when the answer is already out it ends the response instead of letting Express's own
// handler destroy the socket (which drops every other request on that keep-alive connection).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const { install, finalErrorHandler } = require('./async-routes');

install();
const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── unit: the handler on its own, with fakes ──────────────────────────────────────
function fakeReq(over = {}) {
  return { method: 'POST', path: '/librechat/janitor', url: '/librechat/janitor?token=SECRET-IN-THE-QUERY', ...over };
}
function fakeRes(over = {}) {
  const res = { headersSent: false, statusCode: 200, calls: [] };
  res.status = (c) => { res.calls.push(['status', c]); res.statusCode = c; return res; };
  res.json = (b) => { res.calls.push(['json', JSON.stringify(b)]); return res; };
  res.end = () => { res.calls.push(['end']); };
  return Object.assign(res, over);
}
// run the handler with console.error / console.warn captured
function run(t, err, { req = fakeReq(), res = fakeRes() } = {}) {
  const logs = { error: [], warn: [] };
  t.mock.method(console, 'error', (...a) => { logs.error.push(a.join(' ')); });
  t.mock.method(console, 'warn', (...a) => { logs.warn.push(a.join(' ')); });
  finalErrorHandler(err, req, res, () => { throw new Error('the final handler must not call next'); });
  return { res, logs };
}
const BODY_500 = '{"error":"Proxy internal error"}';

test('an ordinary error is answered 500 {"error":"Proxy internal error"}, with nothing of its message or stack', (t) => {
  const { res, logs } = run(t, new TypeError('Cannot convert object to primitive value, private detail'));
  assert.deepEqual(res.calls, [['status', 500], ['json', BODY_500]]);
  assert.equal(logs.warn.length, 0);
  assert.equal(logs.error.length, 1);
});

test('the log line names the request (method and path, never the query string) and the cause, with at most five stack frames', (t) => {
  const { logs } = run(t, new TypeError('Cannot convert object to primitive value'));
  const lines = logs.error[0].split('\n');
  assert.equal(lines[0], '[proxy] POST /librechat/janitor failed with 500: TypeError: Cannot convert object to primitive value');
  assert.ok(lines.length >= 2 && lines.length <= 6, `first line plus 1 to 5 frames, got ${lines.length}`);
  for (const frame of lines.slice(1)) assert.match(frame, /^\s+at /);
  assert.ok(!logs.error[0].includes('SECRET-IN-THE-QUERY'));
});

test('a request with no path property is logged by its url without the query; a request that cannot be read still logs', (t) => {
  const a = run(t, new Error('x'), { req: { method: 'GET', url: '/p/q?secret=1' } });
  assert.match(a.logs.error[0], /^\[proxy\] GET \/p\/q failed with 500: Error: x/);
  assert.ok(!a.logs.error[0].includes('secret=1'));
  t.mock.restoreAll();
  const b = run(t, new Error('x'), { req: null });
  assert.match(b.logs.error[0], /^\[proxy\] \(request unknown\) failed with 500: Error: x/);
  assert.deepEqual(b.res.calls, [['status', 500], ['json', BODY_500]]);
});

test('a path with line breaks or control characters stays on one line, and a long path is cut', (t) => {
  const evil = '/x' + String.fromCharCode(10) + '[proxy] FAKE LINE' + String.fromCharCode(1) + String.fromCharCode(13);
  const a = run(t, new Error('x'), { req: fakeReq({ path: evil }) });
  const first = a.logs.error[0].split('\n')[0];
  assert.equal(first, '[proxy] POST /x?[proxy] FAKE LINE?? failed with 500: Error: x');
  t.mock.restoreAll();
  const b = run(t, new Error('x'), { req: fakeReq({ path: '/' + 'p'.repeat(5000) }) });
  const where = b.logs.error[0].split('\n')[0];
  assert.equal(where, '[proxy] POST /' + 'p'.repeat(199) + ' failed with 500: Error: x');
  t.mock.restoreAll();
  const c = run(t, new Error('x'), { req: fakeReq({ method: 'M'.repeat(100) }) });
  assert.equal(c.logs.error[0].split('\n')[0], '[proxy] ' + 'M'.repeat(16) + ' /librechat/janitor failed with 500: Error: x');
});

test('a 4xx that an HTTP library put on the error keeps its status, with the standard reason, one warn line and no stack', (t) => {
  const table = [[400, 'Bad Request'], [401, 'Unauthorized'], [404, 'Not Found'], [413, 'Payload Too Large'], [415, 'Unsupported Media Type'], [422, 'Unprocessable Entity'], [499, 'Bad Request']];
  for (const [status, reason] of table) {
    for (const field of ['status', 'statusCode']) {
      const err = Object.assign(new SyntaxError('Unexpected token } in JSON, private detail'), { [field]: status });
      const { res, logs } = run(t, err);
      assert.deepEqual(res.calls, [['status', status], ['json', JSON.stringify({ error: reason })]], `${field} ${status}`);
      assert.equal(logs.error.length, 0, 'a 4xx is the caller\'s fault: no error line');
      assert.equal(logs.warn.length, 1);
      assert.equal(logs.warn[0], `[proxy] POST /librechat/janitor refused with ${status}: SyntaxError: Unexpected token } in JSON, private detail`);
      t.mock.restoreAll();
    }
  }
});

test('a status that is not a 4xx integer is a 500', (t) => {
  for (const status of [399, 500, 503, 600, '400', '404', 400.5, NaN, Infinity, -400, 0, null, undefined, {}, [400], true, 4e2 + 0.1]) {
    const { res } = run(t, Object.assign(new Error('x'), { status }));
    assert.deepEqual(res.calls, [['status', 500], ['json', BODY_500]], String(status));
    t.mock.restoreAll();
  }
  const { res } = run(t, Object.assign(new Error('x'), { status: 500, statusCode: 404 }));
  assert.equal(res.calls[0][1], 404, 'statusCode counts when status says nothing usable');
});

const deepArray = JSON.parse('['.repeat(30000) + ']'.repeat(30000));
const HOSTILE = [
  ['a Symbol', Symbol('s')],
  ['an object without a prototype', Object.create(null)],
  ['null', null],
  ['undefined', undefined],
  ['zero', 0],
  ['an empty string', ''],
  ['a string', 'plain text'],
  ['an object with a toString that is not a function', { toString: 1 }],
  ['an object whose message getter throws', { get message() { throw new Error('no message'); } }],
  ['an object whose status getter throws', { get status() { throw new Error('no status'); }, message: 'm' }],
  ['an Error whose stack getter throws', Object.defineProperty(new Error('e'), 'stack', { get() { throw new Error('no stack'); } })],
  ['an Error with a stack that is not text', Object.defineProperty(new Error('e'), 'stack', { value: 42 })],
  ['an array nested 30,000 deep', deepArray],
  ['a Proxy that throws on everything', new Proxy({}, { get() { throw new Error('no'); }, getPrototypeOf() { throw new Error('no'); }, has() { throw new Error('no'); }, ownKeys() { throw new Error('no'); } })],
];

test('whatever was thrown, even something that cannot be printed, is logged once and answered 500', (t) => {
  for (const [name, err] of HOSTILE) {
    const { res, logs } = run(t, err);
    assert.deepEqual(res.calls, [['status', 500], ['json', BODY_500]], name);
    assert.equal(logs.error.length, 1, name + ': one line');
    assert.match(logs.error[0], /^\[proxy\] POST \/librechat\/janitor failed with 500: /, name);
    t.mock.restoreAll();
  }
});

test('when the answer is already out the response is ended, nothing is written, and the cause is still logged', (t) => {
  const { res, logs } = run(t, new Error('after the answer'), { res: fakeRes({ headersSent: true }) });
  assert.deepEqual(res.calls, [['end']]);
  assert.equal(logs.error.length, 1);
  assert.match(logs.error[0], /after the answer/);
});

test('if writing the answer fails, the request is ended with an empty 500 and nothing is thrown', (t) => {
  const broken = fakeRes();
  broken.json = () => { throw new Error('socket gone'); };
  const a = run(t, new Error('x'), { res: broken });
  assert.equal(a.res.statusCode, 500);
  assert.ok(a.res.calls.some(([c]) => c === 'end'), 'ended');
  t.mock.restoreAll();
  const brokenEnd = fakeRes({ headersSent: true });
  brokenEnd.end = () => { brokenEnd.calls.push(['end']); throw new Error('socket gone'); };
  run(t, new Error('x'), { res: brokenEnd });   // (it does not throw)
  assert.ok(brokenEnd.calls.length >= 1 && brokenEnd.calls.every(([c]) => c === 'end'), 'it tried to end, and wrote nothing');
});

test('a console that throws does not make the handler fail', (t) => {
  t.mock.method(console, 'error', () => { throw new Error('stderr closed'); });
  const res = fakeRes();
  finalErrorHandler(new Error('x'), fakeReq(), res, () => {});
  assert.deepEqual(res.calls, [['status', 500], ['json', BODY_500]]);
});

// ── the wiring in server.js ───────────────────────────────────────────────────────
test('server.js mounts finalErrorHandler after the last route, right before it listens, with nothing mounted after it', () => {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const mount = 'app.use(require("./async-routes").finalErrorHandler);';
  const at = src.indexOf(mount);
  assert.ok(at > 0, 'mounted');
  assert.equal(src.indexOf(mount, at + 1), -1, 'once');
  assert.ok(at > src.indexOf('app.post("/v1/audio/transcriptions"'), 'after the transcription route, the last route');
  assert.match(src.slice(at + mount.length, src.indexOf('app.listen(PORT', at)), /^\s*$/, 'directly before app.listen');
  assert.doesNotMatch(src.slice(at + mount.length), /\bapp\.(get|post|put|patch|delete|all|use)\(/, 'no route or middleware after it');
});

// ── wire: a real Express app on a real socket, with the patch and the handler ──────
async function withApp(build, run, { jsonLimit = '10mb', final = true } = {}) {
  const app = express();
  app.use(express.json({ limit: jsonLimit }));
  build(app);
  if (final) app.use(finalErrorHandler);
  const server = http.createServer(app);
  const sockets = [];
  server.on('connection', (s) => { sockets.push(s); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await run({ port: server.address().port, sockets });
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
  }
}

function call(port, path, { method = 'GET', agent, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { req.destroy(); reject(new Error(`no answer within 1.5 s: ${method} ${path}`)); }, 1500);
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: agent === undefined ? false : agent, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), reused: req.reusedSocket === true }); });
      res.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(t); reject(e); });
    req.end(body);
  });
}

test('a rejected handler gets a 500 JSON answer with no stack or message in it, and the very next request is served', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withApp((app) => {
    app.post('/boom', async () => { throw new TypeError('inside the handler, private detail'); });
    app.post('/symbol', async () => { throw Symbol('private symbol'); });
    app.get('/ok', (req, res) => res.send('ok'));
  }, async ({ port }) => {
    for (const path of ['/boom', '/symbol']) {
      const r = await call(port, path, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      assert.equal(r.status, 500, path);
      assert.match(r.headers['content-type'], /^application\/json/);
      assert.equal(r.body, BODY_500, path);
      assert.ok(!/private|TypeError|\bat \S+\.js/.test(r.body));
    }
    assert.equal((await call(port, '/ok')).body, 'ok');
  });
  assert.equal(console.error.mock.callCount(), 2, 'both causes were logged');
});

test('body-parser errors keep their status and answer in JSON: 400 for a body that is not JSON, 413 for one over the limit', async (t) => {
  const warns = [];
  const errors = [];
  t.mock.method(console, 'warn', (...a) => { warns.push(a.join(' ')); });
  t.mock.method(console, 'error', (...a) => { errors.push(a.join(' ')); });
  await withApp((app) => { app.post('/echo', (req, res) => res.json(req.body)); }, async ({ port }) => {
    const json = { 'Content-Type': 'application/json' };
    const bad = await call(port, '/echo', { method: 'POST', body: '{not json', headers: json });
    assert.equal(bad.status, 400);
    assert.equal(bad.body, '{"error":"Bad Request"}');
    const big = await call(port, '/echo', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(5000) }), headers: json });
    assert.equal(big.status, 413);
    assert.equal(big.body, '{"error":"Payload Too Large"}');
    const fine = await call(port, '/echo', { method: 'POST', body: '{"a":1}', headers: json });
    assert.equal(fine.body, '{"a":1}');
  }, { jsonLimit: '1kb' });
  assert.equal(errors.length, 0, 'a 4xx is the caller\'s fault: no error line');
  assert.equal(warns.length, 2);
  assert.match(warns[0], /^\[proxy\] POST \/echo refused with 400: SyntaxError/);
  assert.match(warns[1], /^\[proxy\] POST \/echo refused with 413: /);
  for (const w of warns) assert.ok(!w.includes('\n'), 'one line each');
});

test('a handler that rejects after it answered does not destroy the socket: the next request rides the same connection', async (t) => {
  t.mock.method(console, 'error', () => {});
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await withApp((app) => {
      app.get('/late', async (req, res) => { res.send('answered'); throw new Error('after the answer'); });
      app.get('/ok', (req, res) => res.send('ok'));
    }, async ({ port, sockets }) => {
      const first = await call(port, '/late', { agent });
      assert.equal(first.body, 'answered');
      await sleep(20);
      assert.equal(sockets.length, 1);
      assert.equal(sockets[0].destroyed, false, 'the server did not destroy the connection');
      const second = await call(port, '/ok', { agent });
      assert.equal(second.body, 'ok');
      assert.equal(second.reused, true, 'the same socket served it');
      assert.equal(sockets.length, 1, 'no second connection was needed');
    });
  } finally {
    agent.destroy();
  }
});

test('(control) without the final handler Express destroys that socket, so the test above can tell', async (t) => {
  t.mock.method(console, 'error', () => {});
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await withApp((app) => {
      app.get('/late', async (req, res) => { res.send('answered'); throw new Error('after the answer'); });
    }, async ({ port, sockets }) => {
      await call(port, '/late', { agent }).catch(() => {});
      await sleep(30);
      assert.equal(sockets[0].destroyed, true);
    }, { final: false });
  } finally {
    agent.destroy();
  }
});

test('a handler that fails halfway through a streamed answer ends it cleanly: the part that was sent arrives, then the end', async (t) => {
  t.mock.method(console, 'error', () => {});
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await withApp((app) => {
      app.get('/stream', async (req, res) => { res.write('first-chunk'); await sleep(5); throw new Error('died mid-stream'); });
      app.get('/ok', (req, res) => res.send('ok'));
    }, async ({ port, sockets }) => {
      const r = await call(port, '/stream', { agent });
      assert.equal(r.status, 200);
      assert.equal(r.body, 'first-chunk');
      assert.equal(sockets[0].destroyed, false);
      const next = await call(port, '/ok', { agent });
      assert.equal(next.body, 'ok');
      assert.equal(next.reused, true);
    });
  } finally {
    agent.destroy();
  }
});

test('nothing in this file became an unhandled rejection', async () => {
  await sleep(10);
  assert.deepEqual(unhandled, []);
});
