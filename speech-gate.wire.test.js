'use strict';
/* Oct 16 2026: the real server, gate enforcing. Strangers get 401 on both paid
 * routes before any provider is called; the secret, the browser preflight and
 * every public page still answer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SECRET = 'wire-test-speech-secret-0123456789';
const PORT = '31871';
const BASE = `http://127.0.0.1:${PORT}`;

test('enforcing gate: 401 for strangers, speech for the secret, public pages untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-gate-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, SPEECH_GATE: 'enforce', KADE_SPEECH_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (x) => (log += x));
  child.stderr.on('data', (x) => (log += x));
  const providerCalls = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).length;
  const speak = (headers = {}) =>
    fetch(`${BASE}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input: 'Hello there.', voice: 'alloy' }) });
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${BASE}/voices.json`)).status === 200; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, log);
    assert.match(log, /\[speech-gate\] mode=enforce, 1 speech secret\(s\) configured/);

    const bare = await speak();
    assert.equal(bare.status, 401);
    assert.match((await bare.json()).error, /only answers the Kade-AI platform/);
    const empty = await fetch(`${BASE}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(empty.status, 401, 'the old free probe no longer reaches the input check');
    assert.equal((await speak({ Authorization: 'Bearer placeholder' })).status, 401);
    assert.equal((await speak({ 'x-proxy-secret': 'not-the-secret-at-all-000' })).status, 401);
    const stt = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: '--x--\r\n' });
    assert.equal(stt.status, 401);
    assert.equal(providerCalls(), 0, 'no refused request reached a paid provider');

    const viaHeader = await speak({ 'x-proxy-secret': SECRET, 'x-kade-caller': 'wire-test' });
    assert.equal(viaHeader.status, 200);
    assert.ok((await viaHeader.arrayBuffer()).byteLength > 44);
    const viaBearer = await speak({ Authorization: `Bearer ${SECRET}` });
    assert.equal(viaBearer.status, 200);
    await viaBearer.arrayBuffer();
    assert.equal(providerCalls(), 2);
    const sttOk = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'x-proxy-secret': SECRET }, body: '--x--\r\n' });
    assert.notEqual(sttOk.status, 401);
    await sttOk.text();

    const preflight = await fetch(`${BASE}/v1/audio/speech`, { method: 'OPTIONS', headers: { Origin: 'https://kademurdock.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204);
    for (const p of ['/health', '/healthz', '/voices.json', '/help', '/lab/limiter']) {
      const r = await fetch(`${BASE}${p}`, { redirect: 'manual' });
      assert.notEqual(r.status, 401, p);
      await r.arrayBuffer();
    }
    assert.ok(!log.includes(SECRET), 'the secret never reaches the log');
    assert.match(log, /\[speech-gate\] refused: missing POST \/v1\/audio\/speech/);
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
});
