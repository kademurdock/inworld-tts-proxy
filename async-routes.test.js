'use strict';
// Nov 7 2026 (an independent review of the proxy found 25 malformed-request shapes on 8 routes, and about 90 async handlers with no
// guard of their own, that END THE PROCESS): Express 4 ignores what a handler returns, so an async handler that throws is a rejected
// promise nobody listens to, and Node exits on it. async-routes.js patches Express's Layer once so that such a rejection goes to
// next(err), like a synchronous throw always did. These tests run a real Express app on a real socket with the patch installed.
// (The error middleware that answers the request is the next step's; here a small sink stands in for it.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const Layer = require('express/lib/router/layer');
const { install, describeCause, asFailure } = require('./async-routes');

const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a real app on a real socket ───────────────────────────────────────────────────
async function withApp(build, run) {
  const app = express();
  const seen = [];
  build(app);
  // the stand-in for the final error middleware: records what reached it and answers (or, if the answer is out, ends it)
  app.use((err, req, res, next) => {
    seen.push(err);
    if (res.headersSent) { res.end(); return; }
    res.status(500).type('text/plain').send('sink');
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await run({ port: server.address().port, seen });
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
  }
}

function call(port, path, { method = 'GET', agent } = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { req.destroy(); reject(new Error(`no answer within 1.5 s: ${method} ${path}`)); }, 1500);
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: agent === undefined ? false : agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), reused: req.reusedSocket === true, socket: res.socket }); });
    });
    req.on('error', (e) => { clearTimeout(t); reject(e); });
    req.end();
  });
}

// ── install ───────────────────────────────────────────────────────────────────────
test('install() patches Express once, says so, and a second call changes nothing', () => {
  assert.equal(install(), true, 'the first call patches');
  const patched = Layer.prototype.handle_request;
  const patchedError = Layer.prototype.handle_error;
  assert.equal(install(), false, 'the second call finds it already patched');
  assert.equal(install(), false);
  assert.equal(Layer.prototype.handle_request, patched, 'and puts nothing on top of it');
  assert.equal(Layer.prototype.handle_error, patchedError);
  assert.equal(patched.name, 'handle', 'stack traces read as they did');
  assert.equal(patchedError.name, 'handle_error');
});

// ── a rejection goes to next(err) ─────────────────────────────────────────────────
test('a handler that rejects, before or after an await, or returns a rejected promise, reaches the error middleware with the very error', async () => {
  const boom = { early: new Error('early'), late: new Error('late'), plain: new Error('plain') };
  await withApp((app) => {
    app.get('/early', async () => { throw boom.early; });
    app.get('/late', async () => { await sleep(5); throw boom.late; });
    app.get('/plain', () => Promise.reject(boom.plain));
  }, async ({ port, seen }) => {
    for (const name of ['early', 'late', 'plain']) {
      const r = await call(port, '/' + name);
      assert.equal(r.status, 500, name);
      assert.equal(r.body, 'sink', name);
      assert.equal(seen.at(-1), boom[name], `${name}: next() got the very error`);
    }
    assert.equal(seen.length, 3);
  });
});

test('a synchronous throw still goes to the error middleware, as it always did', async () => {
  const boom = new Error('sync');
  await withApp((app) => { app.get('/s', () => { throw boom; }); }, async ({ port, seen }) => {
    assert.equal((await call(port, '/s')).status, 500);
    assert.deepEqual(seen, [boom]);
  });
});

test('a handler that answers is left alone: async, returning res, returning anything that is not a thenable', async () => {
  const noThen = [undefined, null, 'text', 42, true, {}, [], { then: 5 }, Symbol('s')];
  await withApp((app) => {
    app.get('/async', async (req, res) => { await sleep(2); res.json({ ok: 'async' }); });
    app.get('/returns-res', (req, res) => res.status(201).json({ ok: 'res' }));
    noThen.forEach((value, i) => { app.get('/value/' + i, (req, res) => { res.send('v' + i); return value; }); });
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/async')).body, '{"ok":"async"}');
    assert.equal((await call(port, '/returns-res')).status, 201);
    for (let i = 0; i < noThen.length; i++) assert.equal((await call(port, '/value/' + i)).body, 'v' + i, String(i));
    assert.deepEqual(seen, [], 'nothing reached the error middleware');
  });
});

test('install() stops the boot, with a message, on an Express that has no handle_request / handle_error to patch', () => {
  const id = require.resolve('express/lib/router/layer');
  const saved = require.cache[id];
  const fake = (methods) => {
    function FakeLayer() {}
    for (const m of methods) FakeLayer.prototype[m] = function () {};
    return { id, filename: id, loaded: true, exports: FakeLayer };
  };
  try {
    for (const methods of [[], ['handle_request'], ['handle_error']]) {
      require.cache[id] = fake(methods);
      assert.throws(() => install(), /built for Express 4/, methods.join(',') || 'neither');
    }
  } finally {
    require.cache[id] = saved;
  }
  assert.equal(Layer.prototype.handle_request.name, 'handle', 'the real Layer was not touched');
});

// ── what gets handed to next() ────────────────────────────────────────────────────
const FALSY_OR_CONTROL = [undefined, null, 0, '', false, NaN, 'route', 'router'];

test('a failure that is falsy, or the strings "route" / "router", is an Error, never "carry on to the next route"', async () => {
  await withApp((app) => {
    FALSY_OR_CONTROL.forEach((reason, i) => {
      app.get('/rejects/' + i, async () => { throw reason; });
      app.get('/rejects/' + i, (req, res) => res.send('fell through'));
      app.get('/throws/' + i, () => { throw reason; });
      app.get('/throws/' + i, (req, res) => res.send('fell through'));
    });
  }, async ({ port, seen }) => {
    for (const kind of ['rejects', 'throws']) {
      for (let i = 0; i < FALSY_OR_CONTROL.length; i++) {
        const r = await call(port, `/${kind}/${i}`);
        const label = `${kind} ${String(FALSY_OR_CONTROL[i])}`;
        assert.equal(r.body, 'sink', `${label}: answered by the error middleware, not by the next route`);
        assert.ok(seen.at(-1) instanceof Error, label);
        assert.match(seen.at(-1).message, /^handler failed with /, label);
      }
    }
  });
});

test('any other failure value reaches the error middleware untouched: a Symbol, an object without a prototype, a string, a number, an object with a status', async () => {
  const values = [Symbol('s'), Object.create(null), 'boom', 42, { status: 400, message: 'bad' }, [], new TypeError('t'), true];
  await withApp((app) => {
    values.forEach((v, i) => { app.get('/r/' + i, async () => { throw v; }); app.get('/t/' + i, () => { throw v; }); });
  }, async ({ port, seen }) => {
    for (let i = 0; i < values.length; i++) {
      assert.equal((await call(port, '/r/' + i)).body, 'sink');
      assert.equal(seen.at(-1), values[i], `rejected value ${i} is the same value`);
      assert.equal((await call(port, '/t/' + i)).body, 'sink');
      assert.equal(seen.at(-1), values[i], `thrown value ${i} is the same value`);
    }
  });
});

test('asFailure and describeCause: every kind of value has an answer, and no answer throws', () => {
  for (const v of FALSY_OR_CONTROL) assert.ok(asFailure(v) instanceof Error, String(v));
  assert.equal(asFailure('route').message, 'handler failed with "route"');
  assert.equal(asFailure(undefined).message, 'handler failed with undefined');
  assert.equal(asFailure(0).message, 'handler failed with 0');
  const truthy = { a: 1 };
  assert.equal(asFailure(truthy), truthy);
  const nested = JSON.parse('['.repeat(30000) + ']'.repeat(30000));
  const hostile = new Proxy({}, { get() { throw new Error('no'); }, getPrototypeOf() { throw new Error('no'); }, has() { throw new Error('no'); }, ownKeys() { throw new Error('no'); } });
  const cases = [
    [new TypeError('bad thing'), 'TypeError: bad thing'],
    ['plain text', 'plain text'],
    [Symbol('x'), 'Symbol(x)'],
    [null, 'null'],
    [Object.create(null), '[object Object]'],
    [{ toString: 1 }, '[object Object]'],
    [{ get message() { throw new Error('no message for you'); } }, '[object Object]'],
    [nested, '[object Array]'],
    [hostile, 'unprintable value'],
  ];
  for (const [value, want] of cases) assert.equal(describeCause(value), want, want);
  const long = describeCause('x'.repeat(100000));
  assert.ok(long.length <= 303 && long.endsWith('...'), 'a huge string becomes one short line');
  assert.equal(describeCause('y'.repeat(300)), 'y'.repeat(300), 'exactly 300 characters is kept whole');
  assert.equal(describeCause('y'.repeat(301)), 'y'.repeat(300) + '...', 'one more is cut');
  assert.ok(asFailure(hostile) === hostile, 'a truthy value is never inspected on its way to next()');
});

// ── handler chains, routers, middleware ───────────────────────────────────────────
test('a chain of handlers: next() still moves on, a rejection stops the chain, an explicit next(err) still works', async () => {
  const boom = new Error('first');
  await withApp((app) => {
    app.get('/moves-on', async (req, res, next) => { await sleep(2); next(); }, (req, res) => res.send('second'));
    app.get('/stops', async () => { throw boom; }, (req, res) => res.send('second ran'));
    app.get('/explicit', (req, res, next) => next(boom), (req, res) => res.send('second ran'));
    app.get('/explicit-async', async (req, res, next) => { next(boom); }, (req, res) => res.send('second ran'));
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/moves-on')).body, 'second');
    assert.equal((await call(port, '/stops')).body, 'sink');
    assert.equal((await call(port, '/explicit')).body, 'sink');
    assert.equal((await call(port, '/explicit-async')).body, 'sink');
    assert.deepEqual(seen, [boom, boom, boom]);
  });
});

test('routers and app.use middleware are covered, not only app.get', async () => {
  const boom = new Error('in the router');
  const wall = new Error('in the middleware');
  await withApp((app) => {
    const router = express.Router();
    router.post('/deep', async () => { throw boom; });
    router.use('/sub', async () => { throw boom; });
    app.use('/api', router);
    app.use(async (req, res, next) => { if (req.path === '/walled') throw wall; next(); });
    app.get('/walled', (req, res) => res.send('past the wall'));
    app.get('/open', (req, res) => res.send('open'));
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/api/deep', { method: 'POST' })).body, 'sink');
    assert.equal((await call(port, '/api/sub/x')).body, 'sink');
    assert.equal((await call(port, '/walled')).body, 'sink');
    assert.equal((await call(port, '/open')).body, 'open', 'the middleware lets others through');
    assert.deepEqual(seen, [boom, boom, wall]);
  });
});

test('a four-argument function in a request position is skipped, as in Express', async () => {
  await withApp((app) => {
    app.get('/skip', (a, b, c, d) => { throw new Error('must not run'); }, (req, res) => res.send('after'));
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/skip')).body, 'after');
    assert.deepEqual(seen, []);
  });
});

// ── error handlers ────────────────────────────────────────────────────────────────
test('an error handler that rejects or throws passes its own failure on to the next error handler', async () => {
  const first = new Error('first');
  const second = new Error('second from an async error handler');
  const third = new Error('third from a sync error handler');
  const order = [];
  await withApp((app) => {
    for (const p of ['/a', '/b', '/c', '/d']) app.get(p, async () => { throw first; });
    app.use('/a', async (err, req, res, next) => { order.push(['a1', err]); throw second; });
    app.use('/b', (err, req, res, next) => { order.push(['b1', err]); throw third; });
    // a failure that is falsy must not read as "carry on" inside an error handler either
    app.use('/c', async (err, req, res, next) => { order.push(['c1', err]); throw undefined; });
    app.use('/d', (err, req, res, next) => { order.push(['d1', err]); throw undefined; });
    app.use('/c', (req, res) => { order.push(['fell', null]); res.send('fell through'); });
    app.use('/d', (req, res) => { order.push(['fell', null]); res.send('fell through'); });
    // a function that is not exactly four arguments long is passed over in an error position, as in Express
    app.use((req, res, next) => { order.push(['never3', null]); next(); });
    app.use((a, b, c, d, e) => { order.push(['never5', null]); });
  }, async ({ port, seen }) => {
    for (const p of ['/a', '/b', '/c', '/d']) assert.equal((await call(port, p)).body, 'sink', p);
    assert.deepEqual(order, [['a1', first], ['b1', first], ['c1', first], ['d1', first]]);
    assert.deepEqual(seen.slice(0, 2), [second, third]);
    for (const e of seen.slice(2)) { assert.ok(e instanceof Error); assert.equal(e.message, 'handler failed with undefined'); }
    assert.equal(seen.length, 4);
  });
});

// ── things a handler might return ─────────────────────────────────────────────────
test('a thenable that rejects is followed; one whose then() throws is followed; one whose `then` cannot even be read is left alone', async () => {
  const boom = new Error('thenable');
  const thrown = new Error('then threw');
  await withApp((app) => {
    app.get('/thenable', () => ({ then(_ok, no) { no(boom); } }));
    app.get('/then-throws', () => ({ then() { throw thrown; } }));
    app.get('/late-thenable', () => ({ then(_ok, no) { setTimeout(() => no(boom), 3); } }));
    app.get('/then-getter', (req, res) => { res.send('answered itself'); return { get then() { throw new Error('unreadable'); } }; });
    app.get('/resolves', () => ({ then(ok) { ok('fine'); } }));
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/thenable')).body, 'sink');
    assert.equal((await call(port, '/then-throws')).body, 'sink');
    assert.equal((await call(port, '/late-thenable')).body, 'sink');
    assert.deepEqual(seen, [boom, thrown, boom]);
    assert.equal((await call(port, '/then-getter')).body, 'answered itself');
    assert.equal(seen.length, 3);
  });
});

test('a promise that resolves never calls next, and next is called once for a rejection that comes after the answer', async () => {
  const boom = new Error('after the answer');
  await withApp((app) => {
    app.get('/ok', async (req, res) => { res.send('fine'); });
    app.get('/answers-then-fails', async (req, res) => { res.send('answered'); await sleep(2); throw boom; });
  }, async ({ port, seen }) => {
    assert.equal((await call(port, '/ok')).body, 'fine');
    await sleep(10);
    assert.deepEqual(seen, [], 'a resolved promise sent nothing to the error middleware');
    assert.equal((await call(port, '/answers-then-fails')).body, 'answered');
    await sleep(10);
    assert.deepEqual(seen, [boom], 'the late rejection reached the error middleware exactly once');
  });
});

// ── the patch itself never throws or rejects ──────────────────────────────────────
function fakeRes({ headersSent = false, endThrows = false } = {}) {
  const res = { headersSent, statusCode: 200, ended: 0 };
  res.end = () => { res.ended += 1; if (endThrows) throw new Error('socket gone'); };
  return res;
}

test('if next() itself throws while a rejection is being handed over, the request is ended and the process is not', async () => {
  const handle = Layer.prototype.handle_request;
  const layer = { handle: async () => { throw new Error('x'); } };
  const before = unhandled.length;
  const fresh = fakeRes();
  handle.call(layer, {}, fresh, () => { throw new Error('next blew up'); });
  await settle();
  assert.equal(fresh.statusCode, 500, 'an empty 500');
  assert.equal(fresh.ended, 1);
  const started = fakeRes({ headersSent: true });
  handle.call(layer, {}, started, () => { throw new Error('next blew up'); });
  await settle();
  assert.equal(started.statusCode, 200, 'a response that already started keeps its status');
  assert.equal(started.ended, 1, 'and is ended');
  const dead = fakeRes({ endThrows: true });
  handle.call(layer, {}, dead, () => { throw new Error('next blew up'); });
  await settle();
  assert.equal(dead.ended, 1, 'a dead socket is not a second crash');
  assert.equal(unhandled.length, before, 'none of it became an unhandled rejection');
  // and with no response object at all
  handle.call(layer, {}, undefined, () => { throw new Error('next blew up'); });
  await settle();
  assert.equal(unhandled.length, before);
});

test('the patched function takes the handler from the layer it is called on, and hands it req, res and next', () => {
  const handle = Layer.prototype.handle_request;
  let got = null;
  const layer = { handle: (req, res, next) => { got = [req, res, typeof next]; } };
  const req = {}; const res = {};
  handle.call(layer, req, res, () => {});
  assert.deepEqual(got, [req, res, 'function']);
});

// ── the wiring in server.js ───────────────────────────────────────────────────────
test('server.js installs the patch right after it requires express, before the app is made and before any router is mounted', () => {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const at = src.search(/const express = require\("express"\);\r?\nrequire\("\.\/async-routes"\)\.install\(\);/);
  assert.ok(at === 0, 'the first two lines of server.js');
  assert.ok(src.indexOf('require("./async-routes")') < src.indexOf('const app = express();'));
  assert.ok(src.indexOf('require("./async-routes")') < src.indexOf('app.use(require("./help"))'));
});

test('nothing in this file became an unhandled rejection', async () => {
  await settle();
  assert.deepEqual(unhandled, []);
});
