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
  try { return await run(server.address().port, seen); } finally { await new Promise((r) => server.close(r)); server.closeAllConnections?.(); }
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
    // the biggest request the LibreChat fork can make: one `input` of 32,767 characters (TTSService.js cuts longer text into pieces of 4,000)
    const cjk = await post(port, '/s', JSON.stringify({ input: '语'.repeat(32767), voice: 'alloy', model: 'tts-1' }));
    assert.equal(cjk.status, 200, '32,767 characters at three bytes each (about 98 KB) are read');
    const controls = await post(port, '/s', JSON.stringify({ input: '\u0001'.repeat(32767) }));
    assert.equal(controls.status, 200, 'and so is the same number of characters that JSON escapes to six bytes each (about 196 KB)');
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
