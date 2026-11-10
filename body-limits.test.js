'use strict';
// Nov 8 2026: body-limits.js on its own (no server boot, no network). The wire test says what the running proxy does; this pins the
// two pieces it is made of: afterSecret() (a secret check that reads the JSON body only for a caller it lets through) and speechJson.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { afterSecret, speechJson, GATED_LIMIT, SPEECH_LIMIT } = require('./body-limits');

async function withApp(build, run) {
  const app = express();
  const seen = { reached: [], errors: [] };
  build(app, seen);
  app.use((err, req, res, next) => { seen.errors.push(err); res.status(err.status || 500).json({ error: err.expose ? err.message : 'internal', type: err.type }); }); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await run(server.address().port, seen); } finally { await new Promise((r) => { server.close(r); server.closeAllConnections?.(); }); }
}

function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const echo = (seen) => (req, res) => { seen.reached.push(req.originalUrl); res.json({ body: req.body }); };

test('the limits: 10 MB after a secret check, 256 KB for the speech route', () => {
  assert.equal(GATED_LIMIT, '10mb');
  assert.equal(SPEECH_LIMIT, '256kb');
  assert.equal(afterSecret(() => {}).parsesJson, true, 'the route table of the wire test finds the check by this flag');
  assert.equal(typeof speechJson, 'function');
});

test('afterSecret: a check that answers itself leaves the body unread; a check that calls next() gets its body parsed', async () => {
  await withApp((app, seen) => {
    const check = (req, res, next) => (req.get('x-secret') === 'yes' ? next() : res.status(401).json({ error: 'Unauthorized' }));
    const gated = afterSecret(check);
    app.post('/g', gated, echo(seen));
  }, async (port, seen) => {
    const stranger = await post(port, '/g', '{"not json at all', {});
    assert.equal(stranger.status, 401, 'the check answered before the body was looked at: a body that is not JSON did not turn into a 400');
    assert.equal(stranger.body, '{"error":"Unauthorized"}');
    assert.deepEqual(seen.reached, []);
    const member = await post(port, '/g', '{"a":1}', { 'x-secret': 'yes' });
    assert.equal(member.status, 200);
    assert.equal(member.body, '{"body":{"a":1}}');
    const badJson = await post(port, '/g', '{"a":', { 'x-secret': 'yes' });
    assert.equal(badJson.status, 400);
    assert.equal(seen.errors.at(-1).type, 'entity.parse.failed');
    assert.equal(seen.reached.length, 1, 'the handler did not run for a body that is not JSON');
  });
});

test('afterSecret: the limit after the check is 10 MB of inflated bytes, for a plain body and for a gzip body', async () => {
  await withApp((app, seen) => {
    app.post('/g', afterSecret((req, res, next) => next()), echo(seen));
  }, async (port, seen) => {
    const MB = 1024 * 1024;
    const under = await post(port, '/g', JSON.stringify({ s: 'a'.repeat(9 * MB) }));
    assert.equal(under.status, 200);
    const over = await post(port, '/g', JSON.stringify({ s: 'a'.repeat(10 * MB) }));
    assert.equal(over.status, 413);
    assert.equal(seen.errors.at(-1).type, 'entity.too.large');
    const bomb = zlib.gzipSync(Buffer.from(JSON.stringify({ s: 'a'.repeat(11 * MB) })));
    assert.ok(bomb.length < 64 * 1024, 'the bomb is small on the wire: ' + bomb.length);
    const inflated = await post(port, '/g', bomb, { 'Content-Encoding': 'gzip' });
    assert.equal(inflated.status, 413, 'the limit counts the inflated bytes');
    const fine = await post(port, '/g', zlib.gzipSync(Buffer.from('{"ok":true}')), { 'Content-Encoding': 'gzip' });
    assert.equal(fine.body, '{"body":{"ok":true}}', 'a small gzip body still works');
  });
});

test('afterSecret: whatever the check passes to next() goes on as it would have, and nothing is parsed for it', async () => {
  await withApp((app, seen) => {
    const boom = new Error('the check failed');
    app.post('/error', afterSecret((req, res, next) => next(boom)), echo(seen));
    app.post('/route', afterSecret((req, res, next) => next('route')), echo(seen));
    app.post('/route', (req, res) => res.json({ second: true, parsed: req.body !== undefined && Object.keys(req.body).length > 0 }));
    app.post('/falsy', afterSecret((req, res, next) => next(0)), echo(seen));
    app.get('/get', afterSecret((req, res, next) => next()), (req, res) => res.json({ body: req.body }));
  }, async (port, seen) => {
    const failed = await post(port, '/error', '{"a":1}');
    assert.equal(failed.status, 500);
    assert.equal(seen.errors.at(-1).message, 'the check failed');
    assert.deepEqual(seen.reached, []);
    const skipped = await post(port, '/route', '{"a":1}');
    assert.equal(skipped.body, '{"second":true,"parsed":false}', 'next("route") skips the rest of this route, as in Express, and the body was not parsed for it');
    const falsy = await post(port, '/falsy', '{"a":1}');
    assert.equal(falsy.body, '{"body":{"a":1}}', 'a falsy argument means "carry on", as in Express');
    const got = await fetch(`http://127.0.0.1:${port}/get`);
    assert.equal(await got.text(), '{"body":{}}', 'a request with no body still gets req.body = {} (the routes destructure it)');
  });
});

test('speechJson: 256 KB of JSON, counted after inflating, the fork\'s biggest real request fits, and an empty request still gets req.body = {}', async () => {
  await withApp((app, seen) => {
    app.post('/s', speechJson, echo(seen));
  }, async (port) => {
    const KB = 1024;
    // the biggest request the LibreChat fork's manual lane can make: one `input` of 32,767 characters (TTSService.js cuts longer text into
    // pieces of 4,000). Its auto-play lane sends up to 100,000 in one request (body-limits.js, the correction of Nov 10 2026).
    const cjk = await post(port, '/s', JSON.stringify({ input: '语'.repeat(32767), voice: 'alloy', model: 'tts-1' }));
    assert.equal(cjk.status, 200, '32,767 characters at three bytes each (about 98 KB) are read');
    const controls = await post(port, '/s', JSON.stringify({ input: '\u0001'.repeat(32767) }));
    assert.equal(controls.status, 200, 'and so is the same number of characters that JSON escapes to six bytes each (about 196 KB)');
    const autoPlay = await post(port, '/s', JSON.stringify({ input: 'The river ran low. '.repeat(6000).slice(0, 100000), voice: 'alloy', model: 'tts-1' }));
    assert.equal(autoPlay.status, 200, 'the fork\'s auto-play ceiling, 100,000 characters of plain English in one request, is read');
    const under = await post(port, '/s', JSON.stringify({ input: 'a'.repeat(255 * KB) }));
    assert.equal(under.status, 200);
    const over = await post(port, '/s', JSON.stringify({ input: 'a'.repeat(257 * KB) }));
    assert.equal(over.status, 413);
    const bomb = zlib.gzipSync(Buffer.from('[' + '{},'.repeat(3 * 1024 * 1024) + '{}]'), { level: 9 });
    assert.ok(bomb.length < 64 * 1024, 'the bomb is small on the wire: ' + bomb.length);
    const t0 = Date.now();
    const inflated = await post(port, '/s', bomb, { 'Content-Encoding': 'gzip' });
    assert.equal(inflated.status, 413);
    assert.ok(Date.now() - t0 < 1000, 'refused without a big parse: ' + (Date.now() - t0) + ' ms');
    const empty = await post(port, '/s', '', { 'Content-Type': 'text/plain' });
    assert.equal(empty.body, '{"body":{}}');
  });
});

test('afterSecret hands the request on exactly once: after a good parse, and with an error', async () => {
  await withApp((app, seen) => {
    seen.behind = [];
    // the first handler answers and does not call next(); a second next() from the wrapper would run the handler behind it
    app.post('/once', afterSecret((req, res, next) => next()), (req, res) => { seen.reached.push('A'); res.json({ ok: true }); }, () => { seen.behind.push('B'); });
    app.post('/err', afterSecret((req, res, next) => next(new Error('stop'))), (req, res) => { seen.reached.push('E'); res.end(); }, () => { seen.behind.push('F'); });
    app.post('/skip', afterSecret((req, res, next) => next('route')), (req, res) => { seen.reached.push('S'); res.end(); });
    app.post('/skip', (req, res) => res.json({ second: true }));
  }, async (port, seen) => {
    const good = await post(port, '/once', '{"a":1}');
    assert.equal(good.status, 200);
    const bad = await post(port, '/err', '{"a":1}');
    assert.equal(bad.status, 500);
    const skipped = await post(port, '/skip', '{"a":1}');
    assert.equal(skipped.body, '{"second":true}');
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(seen.reached, ['A'], 'the handler of /once ran once; /err and /skip never reached theirs');
    assert.deepEqual(seen.behind, [], 'no second next() reached a handler behind');
    assert.equal(seen.errors.length, 1, 'the error of /err reached the error handler once');
  });
});

test('afterSecret fails closed: a check that throws never lets the handler run, and a check that answers later still gets its body parsed', async () => {
  await withApp((app, seen) => {
    app.post('/boom', afterSecret(() => { throw new Error('the check blew up'); }), (req, res) => { seen.reached.push('boom'); res.json({ ok: true }); });
    app.post('/late', afterSecret((req, res, next) => setTimeout(next, 30)), (req, res) => { seen.reached.push('late'); res.json({ body: req.body }); });
  }, async (port, seen) => {
    const boom = await post(port, '/boom', '{"a":1}');
    assert.equal(boom.status, 500);
    assert.deepEqual(seen.reached, [], 'the handler did not run');
    assert.match(seen.errors.at(-1).message, /the check blew up/);
    const late = await post(port, '/late', '{"a":2}');
    assert.equal(late.body, '{"body":{"a":2}}');
  });
});

test('afterSecret hands back what the check returns: the route guard answers an async check that rejects, and waits for one that is slow (reviewer A, A4)', async () => {
  require('./async-routes').install(); // the Nov 7 route guard follows what a handler returns; this wrapper is a handler
  await withApp((app, seen) => {
    app.post('/rejects', afterSecret(async () => { throw new Error('the async check blew up'); }), (req, res) => { seen.reached.push('rejects'); res.json({ ok: true }); });
    app.post('/slow', afterSecret(async (req, res, next) => { await new Promise((r) => setTimeout(r, 40)); next(); }), echo(seen));
  }, async (port, seen) => {
    const hung = new Promise((r) => setTimeout(() => r({ status: 'no answer in 2 s' }), 2000));
    const rejected = await Promise.race([post(port, '/rejects', '{"a":1}'), hung]);
    assert.equal(rejected.status, 500, 'a rejected check is answered, not left hanging: ' + JSON.stringify(rejected));
    assert.deepEqual(seen.reached, [], 'the handler did not run');
    assert.match(seen.errors.at(-1).message, /the async check blew up/);
    const slow = await post(port, '/slow', '{"a":2}');
    assert.equal(slow.body, '{"body":{"a":2}}', 'a slow check still gets its body parsed after it lets the request through');
  });
});

test('speechJson and afterSecret are strict: a JSON primitive is refused by the parser (400), never handed to the route as the body (reviewer B, B04)', async () => {
  await withApp((app, seen) => {
    app.post('/s', speechJson, echo(seen));
    app.post('/g', afterSecret((req, res, next) => next()), echo(seen));
  }, async (port, seen) => {
    for (const route of ['/s', '/g']) {
      for (const body of ['123', 'null', '"abc"', 'true']) {
        const r = await post(port, route, body);
        assert.equal(r.status, 400, route + ' ' + body + ' ' + r.body);
        assert.equal(seen.errors.at(-1).type, 'entity.parse.failed', route + ' ' + body);
      }
    }
    assert.deepEqual(seen.reached, [], 'no handler saw a primitive');
    const ok = await post(port, '/s', '[1]');
    assert.equal(ok.status, 200, 'an array is still a JSON body the parser takes (as it always was)');
  });
});

test('afterSecret passes an error of the check on exactly once: after the error handler answered, nothing reaches the final handler of the app (reviewer B, R02)', async () => {
  const app = express();
  const finals = [];
  app.post('/err', afterSecret((req, res, next) => next(new Error('stop'))), (req, res) => res.end());
  app.use((err, req, res, next) => { res.status(500).json({ error: 'internal' }); }); // eslint-disable-line no-unused-vars
  // the app's own `done`: where a second next(err) from the wrapper would end up once the error handler is behind it
  const server = await new Promise((resolve) => { const s = http.createServer((req, res) => app(req, res, (err) => { finals.push(err ? 'error: ' + err.message : 'no error'); })); s.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const r = await post(server.address().port, '/err', '{"a":1}');
    assert.equal(r.status, 500);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(finals, [], 'a second next(err) would have reached the final handler');
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
  }
});
