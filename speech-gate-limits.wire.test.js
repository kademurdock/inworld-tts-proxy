'use strict';
// Nov 8 2026: the clock test for speech-gate.js's callerNet(). On the real server, twelve strangers at once, each with a 15.8 KB
// X-Forwarded-For header of digits, held /healthz for 2.8 seconds (the review of Nov 7 2026, finding A3): the gate looks at every
// request to the two paid routes before it knows who is asking, and the regex that cuts the caller's address down to its /24 was
// quadratic in the length of that header. (speech-gate-limits.test.js has the same thing without a server, and the memory half.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SPEECH_SECRET = 'wire-test-speech-secret-0123456789';

function start(port, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-gate-limits-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0', ...extra };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
  if (!('SPEECH_GATE' in extra)) delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function withServer(port, extra, run) {
  const s = start(port, extra);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    return await run({ port, state: s.state });
  } finally {
    await s.stop();
  }
}

function send(port, route, headers, body, { method = 'POST', timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const data = body === undefined ? null : Buffer.from(body, 'utf8');
    const timer = setTimeout(() => { req.destroy(); resolve({ kind: 'hang', ms: Date.now() - t0 }); }, timeoutMs);
    const req = http.request({ host: '127.0.0.1', port, path: route, method, agent: false, headers: { ...(data ? { 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ kind: 'response', status: res.statusCode, body: Buffer.concat(chunks).toString(), ms: Date.now() - t0 }); });
      res.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    });
    req.on('error', (e) => { clearTimeout(timer); resolve({ kind: 'reset', err: e.code || e.message, ms: Date.now() - t0 }); });
    if (data) req.write(data);
    req.end();
  });
}

// while `work` runs, ask /healthz every 25 ms on a fresh socket and keep the slowest answer
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
  await new Promise((res) => setTimeout(res, 100));
  let result;
  try { result = await work(); } finally { running = false; await loop; }
  return { worst, result };
}

const JSON_TYPE = { 'Content-Type': 'application/json' };
const HEADER_OF_DIGITS = '1'.repeat(15800);

for (const [port, mode, extra, want] of [
  [31947, 'log', {}, 400],
  [31948, 'enforce', { SPEECH_GATE: 'enforce', KADE_SPEECH_SECRET: SPEECH_SECRET }, 401],
]) {
  test(`gate mode ${mode}: twelve strangers at once with a 15.8 KB X-Forwarded-For of digits do not hold /healthz up`, async () => {
    await withServer(port, extra, async ({ state }) => {
      const hold = (route) => Promise.all(Array.from({ length: 12 }, () => send(port, route, { ...JSON_TYPE, 'x-forwarded-for': HEADER_OF_DIGITS }, '{}')));
      const { worst, result } = await slowestHealthz(port, () => hold('/v1/audio/speech'));
      for (const r of result) {
        assert.equal(r.kind, 'response', JSON.stringify(r));
        assert.equal(r.status, want, `${mode} mode answers a stranger's empty speech request ${want}: ${r.body}`);
      }
      assert.ok(worst < 400, `/healthz was held up for ${worst} ms`);
      const sttHeld = await slowestHealthz(port, () => hold('/v1/audio/transcriptions'));
      assert.ok(sttHeld.worst < 400, `the transcription route: /healthz was held up for ${sttHeld.worst} ms`);
      assert.match(state.log, /\[speech-gate\] (would refuse|refused): missing POST \/v1\/audio\/speech caller=unnamed origin=none net=\? ua="none"/, 'the stranger is still named in the log, with a short net label');
      assert.equal(state.exited, null);
    });
  });
}
