'use strict';
// Nov 7 2026, step 4 of the route-guard series. An independent review of the proxy (three reviewers on frozen trees, every
// finding re-run by a skeptic) found 25 malformed-request shapes on 8 routes that END THE PROCESS in production, all behind
// a secret: a body field of the wrong type reaches `String(x)`, `x.includes(...)` or `encodeURIComponent(x)` inside an async
// Express 4 handler, the promise rejects, and Node exits. Steps 1 and 2 (async-routes.js) make every route answer its own
// failure; this file proves it on the real server, through the real HTTP handler, for every one of the 25.
// (The provider fixture blocks the network, so nothing leaves the machine.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SECRETS = {
  LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
  GITHUB_PROXY_SECRET: 'wire-test-github-secret-0123456789',
  RAILWAY_PROXY_SECRET: 'wire-test-railway-secret-0123456789',
  KADE_APPROVAL_SECRET: 'wire-test-approval-secret-0123456789',
};

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-route-malformed-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = {
    ...process.env, PORT: String(port), ...SECRETS, PROVIDER_RECEIPT: receipt,
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    GITHUB_PAT: 'ghp_dummy', RAILWAY_API_TOKEN: 'dummy-railway-token', LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).length;
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, rows, stop };
}

async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function withServer(port, run) {
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    return await run({ port, state: s.state, rows: s.rows });
  } finally {
    await s.stop();
  }
}

// one request on its own socket: { kind: 'response' | 'reset' | 'hang', status, body, ms }
function send(port, route, headers, body, { method = 'POST', timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const data = body === undefined ? null : Buffer.from(body, 'utf8');
    const timer = setTimeout(() => { req.destroy(); resolve({ kind: 'hang', ms: Date.now() - t0 }); }, timeoutMs);
    const req = http.request({ host: '127.0.0.1', port, path: route, method, agent: false, headers: { ...(data ? { 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ kind: 'response', status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), ms: Date.now() - t0 }); });
      res.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    });
    req.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    if (data) req.write(data);
    req.end();
  });
}

const JSON_TYPE = { 'Content-Type': 'application/json' };
const LIB = { ...JSON_TYPE, Authorization: 'Bearer ' + SECRETS.LIBRECHAT_PROXY_SECRET };
const GH = { ...JSON_TYPE, Authorization: 'Bearer ' + SECRETS.GITHUB_PROXY_SECRET };
const AP = { ...JSON_TYPE, 'x-kade-approval-secret': SECRETS.KADE_APPROVAL_SECRET };
const BODY_500 = '{"error":"Proxy internal error"}';

// JSON texts, because most of them cannot be written by JSON.stringify
const TO_STRING_OBJ = '{"toString":1}';
const ARRAY_OF_TO_STRING_OBJ = '[{"toString":1}]';
const DEEP_ARRAY = '['.repeat(30000) + ']'.repeat(30000);
const LONE_SURROGATE = '"' + String.fromCharCode(92) + 'ud800"';   // the six characters backslash u d 8 0 0 inside quotes: a JSON escape for half a pair

// the 25 shapes of the review: [label, route, headers, JSON body text]
const SHAPES = [];
function shapes(route, headers, build, values) {
  for (const [label, value] of values) SHAPES.push([`${route} ${label}`, route, headers, build(value)]);
}
const POISON3 = [['{"toString":1}', TO_STRING_OBJ], ['[{"toString":1}]', ARRAY_OF_TO_STRING_OBJ], ['an array nested 30,000 deep', DEEP_ARRAY]];
shapes('/librechat/seat-speech', LIB, (v) => `{"seat":"vischeck","input":${v}}`, POISON3.map(([l, v]) => ['input = ' + l, v]));
shapes('/librechat/actions', LIB, (v) => `{"agentId":"a","functions":[{"function":{"name":${v}}}],"metadata":{"k":1}}`, [['functions[0].function.name = {"toString":1}', TO_STRING_OBJ]]);
shapes('/librechat/add-credits', LIB, (v) => `{"userId":"u","amountUSD":${v}}`, POISON3.map(([l, v]) => ['amountUSD = ' + l, v]));
shapes('/librechat/memory/delete', LIB, (v) => `{"key":${v}}`, [['key = a lone surrogate', LONE_SURROGATE]]);
shapes('/librechat/memory/delete', LIB, (v) => `{"key":"x","agentId":${v}}`, [['agentId = a lone surrogate', LONE_SURROGATE]]);
shapes('/librechat/ask-stream', LIB, (v) => `{"agentId":"a","messages":[],"userEmail":${v}}`, POISON3.map(([l, v]) => ['userEmail = ' + l, v]));
shapes('/librechat/janitor', LIB, (v) => `{"maxPages":${v}}`, POISON3.map(([l, v]) => ['maxPages = ' + l, v]));
shapes('/github/branch', GH, (v) => `{"owner":"o","repo":"r","branch":${v}}`, [
  ['branch = {"toString":1}', TO_STRING_OBJ], ['branch = 5', '5'], ['branch = true', 'true'], ['branch = [{"toString":1}]', ARRAY_OF_TO_STRING_OBJ],
  ['branch = an array nested 30,000 deep', DEEP_ARRAY], ['branch = 1e999', '1e999'], ['branch = -1', '-1'],
]);
shapes('/approvals/execute', AP, (v) => `{"kind":${v}}`, POISON3.map(([l, v]) => ['kind = ' + l, v]));

test('there are 25 shapes, on 8 routes', () => {
  assert.equal(SHAPES.length, 25);
  assert.equal(new Set(SHAPES.map((s) => s[1])).size, 8);
});

test('every one of the 25 shapes is answered 500 {"error":"Proxy internal error"} within a second, once logged, and the proxy never goes down', async () => {
  await withServer(31995, async ({ port, state }) => {
    assert.equal((await send(port, '/healthz', {}, undefined, { method: 'GET', timeoutMs: 3000 })).status, 200);   // warmed up
    for (const [name, route, headers, body] of SHAPES) {
      const r = await send(port, route, headers, body);
      assert.equal(state.exited, null, `${name} ended the process: ${state.log.slice(-600)}`);
      assert.equal(r.kind, 'response', `${name}: ${JSON.stringify(r)}`);
      assert.equal(r.status, 500, name);
      assert.equal(r.body, BODY_500, name);
      assert.match(r.headers['content-type'], /^application\/json/, name);
      assert.ok(r.ms < 1000, `${name}: ${r.ms} ms`);
    }
    const logged = state.log.split('\n').filter((l) => /^\[proxy\] POST \S+ failed with 500: /.test(l));
    assert.equal(logged.length, 25, 'one log line per shape');
    for (const route of new Set(SHAPES.map((s) => s[1]))) {
      assert.equal(logged.filter((l) => l.startsWith(`[proxy] POST ${route} failed with 500: `)).length, SHAPES.filter((s) => s[1] === route).length, route);
    }
    assert.doesNotMatch(state.log, /Unhandled|uncaught|node:internal\/process\/promises/i);
    const health = await send(port, '/health', {}, undefined, { method: 'GET', timeoutMs: 3000 });
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).status, 'ok');
  });
});

test('all 25 at once, four times over, with big bodies alongside: every request is answered and none is left open', async () => {
  await withServer(31996, async ({ port, state }) => {
    const pad = ',"pad":"' + 'x'.repeat(1024 * 1024) + '"}';
    const jobs = [];
    for (let round = 0; round < 4; round++) {
      for (const [name, route, headers, body] of SHAPES) jobs.push([name, send(port, route, headers, body, { timeoutMs: 5000 })]);
    }
    // a few poisoned requests that also carry a megabyte each
    for (let i = 0; i < 12; i++) jobs.push([`padded ${i}`, send(port, '/librechat/janitor', LIB, '{"maxPages":{"toString":1}' + pad, { timeoutMs: 5000 })]);
    const results = await Promise.all(jobs.map(([, p]) => p));
    results.forEach((r, i) => {
      assert.equal(r.kind, 'response', `${jobs[i][0]}: ${JSON.stringify(r)}`);
      assert.equal(r.status, 500, jobs[i][0]);
    });
    assert.equal(state.exited, null, state.log.slice(-600));
    assert.equal((await send(port, '/healthz', {}, undefined, { method: 'GET', timeoutMs: 3000 })).status, 200);
  });
});

test('body-parser errors keep their status and answer in JSON; an unknown path is still Express\'s own 404', async () => {
  await withServer(31997, async ({ port, state }) => {
    const bad = await send(port, '/v1/audio/speech', JSON_TYPE, '{"input": "no closing brace"');
    assert.equal(bad.status, 400);
    assert.equal(bad.body, '{"error":"Bad Request"}');
    const big = await send(port, '/v1/audio/speech', JSON_TYPE, '{"input":"' + 'x'.repeat(11 * 1024 * 1024) + '"}', { timeoutMs: 8000 });
    assert.equal(big.status, 413);
    assert.equal(big.body, '{"error":"Payload Too Large"}');
    const missing = await send(port, '/no/such/route', {}, undefined, { method: 'GET' });
    assert.equal(missing.status, 404);
    assert.match(missing.headers['content-type'], /^text\/html/);
    assert.doesNotMatch(state.log, /\[proxy\] .* failed with 500/, 'a client\'s bad request is not logged as the proxy\'s failure');
    assert.equal(state.exited, null);
  });
});

test('a streamed speech response arrives whole: the patch and the final handler leave a working route\'s answer alone', async () => {
  await withServer(31998, async ({ port, state, rows }) => {
    const speak = async (stream) => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: JSON_TYPE, body: JSON.stringify({ input: 'Hello there, friend. This is a streaming check.', voice: 'alloy', stream }) });
      return { status: r.status, type: r.headers.get('content-type'), streamed: r.headers.get('x-kade-tts-streamed'), bytes: Buffer.from(await r.arrayBuffer()) };
    };
    const streamed = await speak(true);
    const buffered = await speak(false);
    assert.equal(streamed.status, 200);
    assert.equal(streamed.streamed, '1', 'it really took the streamed lane');
    assert.equal(buffered.streamed, null);
    assert.equal(streamed.type, 'audio/wav');
    assert.equal(streamed.bytes.toString('latin1', 0, 4), 'RIFF');
    assert.equal(streamed.bytes.toString('latin1', 8, 12), 'WAVE');
    assert.equal(streamed.bytes.toString('latin1', 36, 40), 'data');
    assert.equal(streamed.bytes.length, buffered.bytes.length, 'the streamed answer is as long as the buffered one: nothing cut off');
    assert.ok(streamed.bytes.length > 24000, 'and it holds the fixture\'s whole clip');
    assert.equal(rows(), 2, 'one provider request each');
    // the same lane after a poisoned request on another route
    const poisoned = await send(port, '/librechat/janitor', LIB, '{"maxPages":{"toString":1}}');
    assert.equal(poisoned.status, 500);
    const again = await speak(true);
    assert.equal(again.bytes.length, streamed.bytes.length);
    assert.equal(state.exited, null);
  });
});
