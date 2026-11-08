'use strict';
// Nov 8 2026. The route-guard review of Nov 7 found that the proxy parsed every JSON body, up to 10 MB, BEFORE it knew who was
// asking: `app.use(express.json({ limit: "10mb" }))` was the first layer of the app. A 10 KB gzip body that inflates to a 10 MB
// `[{},{},...]` held the event loop for about five seconds (JSON.parse) and cost about 175 MB of heap, from any stranger, on any path,
// and eight of them at once ended a 1 GB process. This file proves, on the real server through the real HTTP handler, the new rule:
//   - a stranger's body is never parsed: the secret-gated routes check the secret first and read the body after it, the approvals
//     route does the same with its own secret, the speech route reads its JSON after the speech gate and with a small limit, and a path
//     no route answers reads nothing;
//   - what a working request gets back does not change: the secret-gated routes still take bodies up to 10 MB, a speech request under
//     the limit still gets its audio.
// (The provider fixture blocks the network, so nothing leaves the machine.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const SECRETS = {
  LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
  GITHUB_PROXY_SECRET: 'wire-test-github-secret-0123456789',
  RAILWAY_PROXY_SECRET: 'wire-test-railway-secret-0123456789',
  KADE_APPROVAL_SECRET: 'wire-test-approval-secret-0123456789',
};
const SPEECH_SECRET = 'wire-test-speech-secret-0123456789';

function start(port, extra = {}, preload = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-body-limits-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const spy = path.join(dir, 'parsed.txt');
  fs.writeFileSync(spy, '');
  const env = {
    ...process.env, PORT: String(port), ...SECRETS, PROVIDER_RECEIPT: receipt, PARSE_SPY_FILE: spy,
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    GITHUB_PAT: 'ghp_dummy', RAILWAY_API_TOKEN: 'dummy-railway-token', LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
    ...extra,
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
  if (!('SPEECH_GATE' in extra)) delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), '--require', path.join(__dirname, 'test-fixtures/parse-spy.cjs'), ...preload.flatMap((p) => ['--require', path.join(__dirname, 'test-fixtures', p)]), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null, spy };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, stop };
}

async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function withServer(port, extra, run, preload = []) {
  const s = start(port, extra, preload);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    return await run({ port, state: s.state });
  } finally {
    await s.stop();
  }
}

// the sizes (in characters) of every JSON.parse of 64 KB or more the server has made since `from` (a mark from parseMark; test-fixtures/parse-spy.cjs)
const parseMark = (state) => fs.statSync(state.spy).size;
function parsedSince(state, from = 0) {
  return fs.readFileSync(state.spy, 'utf8').slice(from).split(/\r?\n/).filter(Boolean).map(Number);
}

// one request on its own socket: { kind: 'response' | 'reset' | 'hang', status, body, ms }
function send(port, route, headers, body, { method = 'POST', timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const timer = setTimeout(() => { req.destroy(); resolve({ kind: 'hang', ms: Date.now() - t0 }); }, timeoutMs);
    const req = http.request({ host: '127.0.0.1', port, path: route, method, agent: false, headers: { ...(data ? { 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ kind: 'response', status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks), body: Buffer.concat(chunks).toString(), ms: Date.now() - t0 }); });
      res.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    });
    req.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    if (data) req.write(data);
    req.end();
  });
}

// The clock test: while `work` runs, ask /healthz every 25 ms on a fresh socket and keep the slowest answer. A parse that holds the
// event loop for five seconds shows up as a /healthz that takes about five seconds.
async function slowestHealthz(port, work) {
  let running = true;
  let worst = 0;
  const loop = (async () => {
    while (running) {
      const r = await send(port, '/healthz', {}, undefined, { method: 'GET', timeoutMs: 60000 });
      worst = Math.max(worst, r.ms);
      await new Promise((res) => setTimeout(res, 25));
    }
  })();
  await new Promise((res) => setTimeout(res, 100)); // a few quick answers first
  let result;
  try { result = await work(); } finally { running = false; await loop; }
  return { worst, result };
}

const JSON_TYPE = { 'Content-Type': 'application/json' };
const GZIP_JSON = { ...JSON_TYPE, 'Content-Encoding': 'gzip' };
const LIB = { ...JSON_TYPE, Authorization: 'Bearer ' + SECRETS.LIBRECHAT_PROXY_SECRET };
const GH = { ...JSON_TYPE, Authorization: 'Bearer ' + SECRETS.GITHUB_PROXY_SECRET };
const RW = { ...JSON_TYPE, Authorization: 'Bearer ' + SECRETS.RAILWAY_PROXY_SECRET };
const AP = { ...JSON_TYPE, 'x-kade-approval-secret': SECRETS.KADE_APPROVAL_SECRET };
const MB = 1024 * 1024;

// Arrays nested as deep as `bytes` allows, '[[[[...]]]]': about 1.2 s and 435 MB for JSON.parse to read 10 MB of it in a fresh process
// (`[{},{},...]` takes 0.6 s and 175 MB: the review's shape), and about 10 KB once gzipped
function nestedArrays(bytes) { return '['.repeat(Math.floor(bytes / 2)) + ']'.repeat(Math.floor(bytes / 2)); }
function gzipBomb(bytes) { return zlib.gzipSync(Buffer.from(nestedArrays(bytes)), { level: 9 }); }

test('the bomb really is a bomb: about 10 KB on the wire, ten megabytes inflated', () => {
  const bomb = gzipBomb(10 * MB);
  assert.ok(bomb.length < 20 * 1024, 'on the wire: ' + bomb.length);
  assert.ok(zlib.gunzipSync(bomb).length >= 10 * MB - 3, 'inflated');
});

test('speech route: JSON over 256 KB is refused 413 without being parsed, a 200 KB request still gets its audio, a gzip bomb costs nothing', async () => {
  await withServer(31963, {}, async ({ port, state }) => {
    const speak = (extraBytes, headers = JSON_TYPE) => send(port, '/v1/audio/speech', headers, JSON.stringify({ input: 'Hello there.', voice: 'alloy', note: 'x'.repeat(extraBytes) }));
    const started = parseMark(state); // the server read its own big JSON files while booting
    const small = await speak(200 * 1024);
    assert.equal(small.status, 200, small.body.slice(0, 200));
    assert.equal(small.raw.toString('latin1', 0, 4), 'RIFF', 'audio came back');
    assert.equal(parsedSince(state, started).length, 1, 'and its body was read (one parse of about 200 KB)');
    const mark = parseMark(state);
    const over = await speak(300 * 1024);
    assert.equal(over.status, 413);
    assert.equal(over.body, '{"error":"Payload Too Large"}');
    assert.deepEqual(parsedSince(state, mark), [], 'the 300 KB body was refused before JSON.parse saw it');

    // the same ten megabytes of `[{},{},...]` as a 10 KB gzip body: refused as soon as the inflated bytes pass the limit; the loop never stalls
    const bomb = gzipBomb(10 * MB);
    const before = parseMark(state);
    const { worst, result } = await slowestHealthz(port, () => Promise.all([send(port, '/v1/audio/speech', GZIP_JSON, bomb), send(port, '/v1/audio/speech', GZIP_JSON, bomb)]));
    for (const r of result) {
      assert.equal(r.status, 413, r.body || JSON.stringify(r));
      assert.ok(r.ms < 2000, 'answered in ' + r.ms + ' ms');
    }
    assert.deepEqual(parsedSince(state, before), [], 'the inflated bytes were counted against the limit and the parse never ran');
    assert.ok(worst < 400, '/healthz was held up for ' + worst + ' ms');
    assert.equal(state.exited, null);
  });
});

test('a stranger\'s ten megabytes are never parsed, on any path: a gzip bomb to each kind of route holds /healthz up for no time at all', async () => {
  await withServer(31964, {}, async ({ port, state }) => {
    const bomb = gzipBomb(10 * MB);
    const cases = [
      ['a path no route answers', 'POST', '/no/such/route', GZIP_JSON, [404]],
      ['a secret-gated route, no secret (librechat)', 'POST', '/librechat/agent', GZIP_JSON, [401]],
      ['a secret-gated route, wrong secret (github)', 'POST', '/github/commit', { ...GZIP_JSON, Authorization: 'Bearer not-the-secret' }, [401]],
      ['a secret-gated route, no secret (railway)', 'POST', '/railway/redeploy', GZIP_JSON, [401]],
      ['the approvals route, no secret', 'POST', '/approvals/execute', GZIP_JSON, [403]],
      ['the approvals route, wrong secret', 'POST', '/approvals/execute', { ...GZIP_JSON, 'x-kade-approval-secret': 'x'.repeat(SECRETS.KADE_APPROVAL_SECRET.length) }, [403]],
      ['a GET with a body', 'GET', '/healthz', GZIP_JSON, [200]],
    ];
    for (const [label, method, route, headers, want] of cases) {
      const before = parseMark(state);
      const { worst, result } = await slowestHealthz(port, () => Promise.all([send(port, route, headers, bomb, { method }), send(port, route, headers, bomb, { method })]));
      for (const r of result) {
        assert.equal(r.kind, 'response', `${label}: ${JSON.stringify(r)}`);
        assert.ok(want.includes(r.status), `${label}: HTTP ${r.status} ${r.body.slice(0, 120)}`);
      }
      assert.deepEqual(parsedSince(state, before), [], `${label}: a stranger's body was parsed`);
      assert.ok(worst < 400, `${label}: /healthz was held up for ${worst} ms`);
    }
    assert.equal(state.exited, null, state.log.slice(-600));
  });
});

test('the secret is checked before the body is read: no secret and a body that is not JSON is 401 or 403, with the secret it is still 400', async () => {
  await withServer(31965, {}, async ({ port }) => {
    const NOT_JSON = '{"oops": ';
    const strangers = [
      ['/librechat/agent', JSON_TYPE, 401],
      ['/librechat/ask', { ...JSON_TYPE, Authorization: 'Bearer wrong' }, 401],
      ['/github/commit', JSON_TYPE, 401],
      ['/railway/redeploy', JSON_TYPE, 401],
      ['/approvals/execute', JSON_TYPE, 403],
      ['/approvals/execute', { ...JSON_TYPE, 'x-kade-approval-secret': 'not-the-secret' }, 403],
    ];
    for (const [route, headers, status] of strangers) {
      const r = await send(port, route, headers, NOT_JSON);
      assert.equal(r.status, status, `${route} without the secret: ${r.body}`);
    }
    const members = [['/librechat/agent', LIB], ['/github/commit', GH], ['/railway/redeploy', RW], ['/approvals/execute', AP]];
    for (const [route, headers] of members) {
      const r = await send(port, route, headers, NOT_JSON);
      assert.equal(r.status, 400, `${route} with the secret: ${r.body}`);
      assert.equal(r.body, '{"error":"Bad Request"}', route);
    }
    const unknown = await send(port, '/no/such/route', JSON_TYPE, NOT_JSON);
    assert.equal(unknown.status, 404, 'a path no route answers does not read its body, so it cannot find it malformed');
  });
});

test('with the secret the old 10 MB limit still holds on the routes that need big bodies: avatars, whole files, approved commits', async () => {
  await withServer(31966, {}, async ({ port, state }) => {
    const big = (mb, field = 'content') => JSON.stringify({ [field]: 'a'.repeat(mb * MB) });
    // the handler is reached (the answer is the handler's own, whatever it is), never the parser's 413 or the gate's 401, and the body really was parsed
    const reach = async (route, headers, bodyText, label) => {
      const before = parseMark(state);
      const r = await send(port, route, headers, bodyText);
      assert.equal(r.kind, 'response', label + ': ' + JSON.stringify(r));
      assert.ok(![401, 403, 413].includes(r.status), `${label}: HTTP ${r.status} ${r.body.slice(0, 160)}`);
      assert.deepEqual(parsedSince(state, before), [bodyText.length], `${label}: the whole body was parsed, once`);
    };
    await reach('/github/commit', GH, JSON.stringify({ owner: 'o', repo: 'r', path: 'big.js', message: 'm', content: 'a'.repeat(3 * MB) }), 'github commit, 3 MB file');
    await reach('/librechat/agent-avatar', LIB, JSON.stringify({ id: 'agent_x', image_b64: 'A'.repeat(3 * MB) }), 'agent avatar, 3 MB of base64');
    await reach('/approvals/execute', AP, JSON.stringify({ approvalId: 'a', kind: 'no-such-kind', params: { content: 'a'.repeat(3 * MB) } }), 'approvals execute, 3 MB of params');
    await reach('/railway/redeploy', RW, JSON.stringify({ serviceId: 's', environmentId: 'e', note: 'a'.repeat(2 * MB) }), 'railway redeploy, 2 MB');
    await reach('/github/commit', GH, JSON.stringify({ owner: 'o', repo: 'r', path: 'big.js', message: 'm', content: 'a'.repeat(9 * MB + 512 * 1024) }), 'github commit, 9.5 MB file');
    const over = await send(port, '/github/commit', GH, big(10));
    assert.equal(over.status, 413, 'over 10 MB is still refused: ' + over.body.slice(0, 120));
    assert.equal(over.body, '{"error":"Payload Too Large"}');
    const overGz = await send(port, '/librechat/agent', { ...LIB, 'Content-Encoding': 'gzip' }, gzipBomb(11 * MB));
    assert.equal(overGz.status, 413, 'a gzip body is held to the same 10 MB once it is inflated: ' + overGz.body.slice(0, 120));
    assert.equal(state.exited, null, state.log.slice(-600));
  });
});

test('speech gate enforcing: a stranger with a body that is not JSON gets the gate\'s 401 (the body is never read); the secret gets the parser\'s 400', async () => {
  await withServer(31967, { SPEECH_GATE: 'enforce', KADE_SPEECH_SECRET: SPEECH_SECRET }, async ({ port, state }) => {
    const stranger = await send(port, '/v1/audio/speech', JSON_TYPE, '{"input": ');
    assert.equal(stranger.status, 401);
    assert.match(stranger.body, /only answers the Kade-AI platform/);
    const before = parseMark(state);
    const { worst, result } = await slowestHealthz(port, () => send(port, '/v1/audio/speech', GZIP_JSON, gzipBomb(10 * MB)));
    assert.equal(result.status, 401);
    assert.deepEqual(parsedSince(state, before), [], "the stranger's body was never parsed");
    assert.ok(worst < 400, '/healthz was held up for ' + worst + ' ms');
    const member = await send(port, '/v1/audio/speech', { ...JSON_TYPE, 'x-proxy-secret': SPEECH_SECRET }, '{"input": ');
    assert.equal(member.status, 400);
    assert.equal(member.body, '{"error":"Bad Request"}');
    const memberBomb = await send(port, '/v1/audio/speech', { ...GZIP_JSON, 'x-proxy-secret': SPEECH_SECRET }, gzipBomb(10 * MB));
    assert.equal(memberBomb.status, 413, 'even with the secret the speech route reads at most 256 KB');
  });
});

test('the running server has no global JSON parser, and every route that takes a body reads it after a secret check, with its own parser, or not at all (multipart)', async () => {
  await withServer(31968, {}, async ({ port }) => {
    const table = await (await fetch(`http://127.0.0.1:${port}/__routes`)).json();
    assert.ok(table.routes.length >= 100, 'a real app: ' + table.routes.length + ' routes');
    assert.ok(!table.topLevel.includes('jsonParser'), 'no body parser is mounted at the top of the app, ahead of the secret checks: ' + table.topLevel.join(', '));
    const BODY_METHODS = ['post', 'put', 'patch', 'delete'];
    const NOT_JSON = new Set(['post /v1/audio/transcriptions']); // multipart, read by busboy
    const bodyRoutes = table.routes.filter((r) => BODY_METHODS.includes(r.method));
    const problems = [];
    for (const r of bodyRoutes) {
      const key = `${r.method} ${r.path}`;
      const afterSecret = r.chain[0].parsesJson === true; // body-limits.js afterSecret(): the check is the route's first handler, the parse comes after it
      const ownParser = r.chain.slice(0, -1).some((h) => h.name === 'jsonParser');
      if (!afterSecret && !ownParser && !NOT_JSON.has(key)) problems.push(key);
    }
    assert.deepEqual(problems, [], 'these routes take a body but have no parser of their own and no secret check in front of one (see body-limits.js): ' + problems.join(', '));
    const gated = table.routes.filter((r) => r.chain[0].parsesJson === true);
    for (const want of ['post /github/commit', 'post /librechat/agent-avatar', 'post /librechat/ask', 'post /railway/redeploy', 'post /approvals/execute']) {
      assert.ok(gated.some((r) => `${r.method} ${r.path}` === want), want + ' reads its body after a secret check');
    }
    assert.ok(gated.length >= 80, 'the secret-gated routes of librechat, github, railway and approvals: ' + gated.length);
    const speech = table.routes.find((r) => r.method === 'post' && r.path === '/v1/audio/speech');
    assert.equal(speech.chain[0].name, 'jsonParser', 'the speech route has its own parser, the first thing in its chain (the speech gate is mounted ahead of the route)');
    assert.equal(table.routes.filter((r) => r.chain.some((h) => h.parsesJson) && r.chain.slice(1).some((h) => h.parsesJson)).length, 0, 'no route checks a secret twice');
  }, ['route-table.cjs']);
});
