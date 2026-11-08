'use strict';
// Nov 8 2026, the server half of error-text.test.js. On the real server, with a network that fails with an error whose text carries a path
// inside the container, a key in a URL and a Bearer token, every secret-gated route (railway, github, librechat, the approvals executor) answers
// with its error text CLEANED and every other word kept; a success answer, even one whose data holds the same things, comes back untouched.
// (The text itself stays on these routes on purpose: Forge, an LLM, diagnoses from it, and the bridge's battery matches /403|forbidden/ in it.)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 31925;
const SECRETS = {
  LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
  GITHUB_PROXY_SECRET: 'wire-test-github-secret-0123456789',
  RAILWAY_PROXY_SECRET: 'wire-test-railway-secret-0123456789',
  KADE_APPROVAL_SECRET: 'wire-test-approval-secret-0123456789',
};
const CLEAN = 'connect failed: open "<path>" via https://svc.test/path?key=<hidden> and Authorization: Bearer <hidden>';

function start(extra = {}) {
  const env = {
    ...process.env, PORT: String(PORT), ...SECRETS, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', VOICE_AUTO_MOVE: '0',
    GITHUB_PAT: 'ghp_dummy', RAILWAY_API_TOKEN: 'dummy-railway-token', LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', ...extra,
  };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/fetch-leaks.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, stop };
}

async function ready(state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function call(method, route, headers, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true }); }, 15000);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: route, method, agent: false, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message }); });
    req.end(data || undefined);
  });
}

const LIB = { Authorization: 'Bearer ' + SECRETS.LIBRECHAT_PROXY_SECRET };
const GH = { Authorization: 'Bearer ' + SECRETS.GITHUB_PROXY_SECRET };
const RW = { Authorization: 'Bearer ' + SECRETS.RAILWAY_PROXY_SECRET };
const AP = { 'x-kade-approval-secret': SECRETS.KADE_APPROVAL_SECRET };

const NEVER = [/SUPERSECRET123/, /ghp_0a1b/, /\/app\/node_modules/];

test('every secret-gated route cleans the error text it answers, keeps the other words, and keeps its status', async () => {
  const s = start();
  try {
    assert.ok(await ready(s.state), s.state.log);
    const cases = [
      ['github read', 'GET', '/github/file?owner=o&repo=r&path=p', GH, undefined, 502, (j) => j.error],
      ['github commit (details)', 'POST', '/github/commit', GH, { owner: 'o', repo: 'r', path: 'p', content: 'c', message: 'm' }, 502, (j) => { assert.equal(j.error, 'GitHub commit failed'); return j.details; }],
      ['railway read', 'GET', '/railway/overview', RW, undefined, 502, (j) => j.error],
      ['librechat (fail helper)', 'GET', '/librechat/agents', LIB, undefined, 502, (j) => j.error],
      ['approvals read (checks its own Bearer)', 'GET', '/approvals/abc123', LIB, undefined, 502, (j) => j.error],
      ['approvals executor', 'POST', '/approvals/execute', AP, { approvalId: 'a', kind: 'github-commit', params: { owner: 'o', repo: 'r', path: 'p', content: 'c', message: 'm' } }, 502, (j) => { assert.equal(j.ok, false); return j.error; }],
    ];
    for (const [label, method, route, headers, body, status, pick] of cases) {
      const r = await call(method, route, headers, body);
      assert.ok(!r.hang && !r.reset, `${label}: ${JSON.stringify(r)}`);
      assert.equal(r.status, status, `${label}: ${r.text.slice(0, 200)}`);
      for (const bad of NEVER) assert.doesNotMatch(r.text, bad, `${label}: the answer still holds ${bad}`);
      assert.equal(pick(JSON.parse(r.text)), CLEAN, label);
    }
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});

test('the other answers of a gated route are as they were: 401 for no secret, 400 for a bad request, 200 for data that holds the same things', async () => {
  const s = start({ FETCH_FIXTURE_MODE: 'ok' });
  try {
    assert.ok(await ready(s.state), s.state.log);
    const none = await call('GET', '/github/file?owner=o&repo=r&path=p', {});
    assert.equal(none.status, 401);
    assert.equal(none.text, '{"error":"Unauthorized"}');
    const bad = await call('GET', '/github/file?owner=o', GH);
    assert.equal(bad.status, 400);
    assert.equal(bad.text, '{"error":"owner, repo, and path are required"}');
    const ok = await call('GET', '/github/file?owner=o&repo=r&path=p', GH);
    assert.equal(ok.status, 200, ok.text);
    const j = JSON.parse(ok.text);
    assert.equal(j.content, 'see /app/x.js and https://svc.test/p?key=abc123 and Bearer abcdefgh12345678 in this file', 'a file is data: it is not an error text');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});

test('ask-stream writes its error as a Server-Sent-Events frame, and the frame is cleaned too', async () => {
  const s = start();
  try {
    assert.ok(await ready(s.state), s.state.log);
    const r = await call('POST', '/librechat/ask-stream', LIB, { agentId: 'agent_x', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    const frames = r.text.split('data: ').slice(1).map((f) => f.trim());
    const errorFrame = frames.find((f) => f.startsWith('{"error"'));
    assert.ok(errorFrame, 'an error frame came back: ' + r.text.slice(0, 300));
    for (const bad of NEVER) assert.doesNotMatch(errorFrame, bad, `the frame still holds ${bad}`);
    assert.equal(JSON.parse(errorFrame).error, CLEAN);
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});

const SEAT_ENV = { LIBRECHAT_SEAT_VISCHECK_USER: 'seat@example.invalid', LIBRECHAT_SEAT_VISCHECK_PASS: 'seat-pass' };

test('seat-speech hands back the site\'s reply in a 200 answer, and the reply is cleaned (said, and the transcript text)', async () => {
  for (const [mode, ask, check] of [
    ['seat-error', { seat: 'vischeck', input: 'Hello there.' }, (j) => { assert.equal(j.status, 500); assert.equal(j.said, 'the site failed at <path> with ?key=<hidden> and Bearer <hidden>'); }],
    ['seat-stt', { seat: 'vischeck', input: 'Hello there.', transcribe: true }, (j) => { assert.equal(j.status, 200); assert.equal(j.stt.text, 'transcript read from <path> ?key=<hidden>'); }],
  ]) {
    const s = start({ FETCH_FIXTURE_MODE: mode, ...SEAT_ENV });
    try {
      assert.ok(await ready(s.state), s.state.log);
      const r = await call('POST', '/librechat/seat-speech', LIB, ask);
      assert.equal(r.status, 200, `${mode}: ${r.text.slice(0, 300)}`);
      for (const bad of [/SECRET99/, /SECRET77/, /abcdefgh12345678/, /\/app\/api/, /\/app\/y\.js/]) assert.doesNotMatch(r.text, bad, `${mode}: the answer still holds ${bad}`);
      check(JSON.parse(r.text));
      assert.equal(s.state.exited, null);
    } finally {
      await s.stop();
    }
  }
});

test('/balances answers 200 with an error text per source that failed: those are cleaned too', async () => {
  const s = start({ FLUX_API_KEY: 'dummy-flux', MOONSHOT_API_KEY: 'dummy-moonshot', OPENROUTER_API_KEY: 'dummy-openrouter', TWILIO_ACCOUNT_SID: 'ACdummy', TWILIO_AUTH_TOKEN: 'dummy-twilio' });
  try {
    assert.ok(await ready(s.state), s.state.log);
    const r = await call('GET', '/balances', LIB);
    assert.equal(r.status, 200, r.text.slice(0, 300));
    for (const bad of NEVER) assert.doesNotMatch(r.text, bad, `the answer still holds ${bad}`);
    const j = JSON.parse(r.text);
    for (const source of ['flux', 'moonshot', 'openrouter', 'fish', 'twilio', 'search']) assert.equal(j[source] && j[source].error, CLEAN, source);
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
