'use strict';
// Nov 10 2026. The provider timeouts (Fish 30 s, Inworld 20 s) were cleared as soon as the answer's HEADERS arrived, so a provider
// that began a clip and then stalled held the request, and one of the provider slots, with no limit of this service's own: the
// listener heard nothing and no retry ran. The timer now covers the whole answer, body included, and a stalled body counts as a
// timeout (so the four-attempt ladder asks again). Real server; the fixtures block the network, nothing is paid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-body-timeout-'));
  const receipt = path.join(dir, 'requests.jsonl');
  const stalls = path.join(dir, 'stalls.txt');
  fs.writeFileSync(receipt, '');
  fs.writeFileSync(stalls, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt, STALL_RECEIPT: stalls,
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
    FISH_TIMEOUT_MS: '700',
    ...extra,
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'),
    '--require', path.join(__dirname, 'test-fixtures/provider-stalled-body.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null, stalls };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { state, stop };
}
async function ready(port, state) {
  for (let i = 0; i < 400 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
// { kind: 'response', status, raw } or { kind: 'hang' } when nothing came back in `timeoutMs`
function speak(port, voice, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify({ input: 'Hello there, this is a test.', voice }), 'utf8');
    const t0 = Date.now();
    const timer = setTimeout(() => { req.destroy(); resolve({ kind: 'hang', ms: Date.now() - t0 }); }, timeoutMs);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/speech', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ kind: 'response', status: res.statusCode, raw: Buffer.concat(chunks), ms: Date.now() - t0 }); });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ kind: 'reset', ms: Date.now() - t0 }); });
    req.end(data);
  });
}
const fishCalls = (state) => fs.readFileSync(state.stalls, 'utf8').split(/\r?\n/).filter(Boolean).length;

test('a Fish clip that stalls after its headers is cut at the timeout and asked again; the retry that answers is spoken', async () => {
  const s = start(32004, { STALL_FIRST_N: '1' });
  try {
    assert.ok(await ready(32004, s.state), s.state.log.slice(-2000));
    const r = await speak(32004, 'fish:fixture', 20000);
    assert.equal(r.kind, 'response', `an answer came back (before the fix: none, the stalled body was awaited for ever); log: ${s.state.log.slice(-600)}`);
    assert.equal(r.status, 200);
    assert.equal(r.raw.toString('latin1', 0, 4), 'RIFF', 'audio came back');
    assert.equal(fishCalls(s.state), 2, 'the stalled take, then one more that answered');
    assert.match(s.state.log, /fish chunk attempt 1\/4 failed \(Fish request timed out after 700ms\)/);
  } finally {
    await s.stop();
  }
});

test('a Fish that stalls every time fails the chunk after four attempts, and the service stays up', async () => {
  const s = start(32005, {});
  try {
    assert.ok(await ready(32005, s.state), s.state.log.slice(-2000));
    const r = await speak(32005, 'fish:fixture', 30000);
    assert.equal(r.kind, 'response', 'an answer, not a hang');
    assert.ok(r.status >= 500, `a plain failure (got ${r.status})`);
    assert.equal(fishCalls(s.state), 4, 'four attempts, no more');
    assert.equal(s.state.exited, null);
    assert.equal((await fetch('http://127.0.0.1:32005/healthz')).status, 200);
  } finally {
    await s.stop();
  }
});
