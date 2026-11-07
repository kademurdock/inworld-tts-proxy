'use strict';
// Nov 7 2026: the last net on the real server (rejection-net.js is tested on its own in rejection-net.test.js). A preload makes
// the proxy see unhandled promise rejections as soon as it is serving (test-fixtures/reject-later.cjs). The three rules:
// starting up is fatal, a rejection after that is logged and counted in /health while the proxy keeps speaking, and a storm
// ends the process. PROXY_BOOT_GRACE_MS / PROXY_REJECTION_WINDOW_MS / PROXY_REJECTION_LIMIT shorten the numbers for the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-rejection-net-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0', ...extraEnv };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), '--require', path.join(__dirname, 'test-fixtures/reject-later.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  return fn();
}
async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await sleep(100);
  }
  return false;
}
const health = async (port) => (await fetch(`http://127.0.0.1:${port}/health`)).json();

async function withServer(port, env, run) {
  const s = start(port, env);
  try {
    return await run(s.state, s);
  } finally {
    await s.stop();
  }
}

test('a clean boot reports no rejections in /health, and the health status is untouched', async () => {
  await withServer(31984, { REJECT_COUNT: '0' }, async (state) => {
    assert.ok(await ready(31984, state), state.log);
    const h = await health(31984);
    assert.equal(h.status, 'ok');
    assert.deepEqual(h.unhandledRejections, { total: 0, recent: 0, windowSeconds: 60 });
  });
});

test('starting up is fatal: a rejection in the first 30 seconds ends the process with the cause in the log', async () => {
  await withServer(31985, { REJECT_COUNT: '1', PROXY_BOOT_GRACE_MS: '600000' }, async (state) => {
    assert.ok(await until(() => state.exited !== null, 15000), 'the process should have ended: ' + state.log.slice(-500));
    assert.equal(state.exited.code, 1);
    assert.match(state.log, /\[proc\] unhandled rejection while starting up, ending the process so the deploy fails its health check: Error: fixture rejection after listen 1/);
  });
});

test('after the grace a rejection is logged, counted in /health, and the proxy keeps serving and speaking', async () => {
  await withServer(31986, { REJECT_COUNT: '3', PROXY_BOOT_GRACE_MS: '0' }, async (state) => {
    assert.ok(await ready(31986, state), state.log);
    assert.ok(await until(() => (state.log.match(/\[proc\] unhandled rejection #\d/g) || []).length === 3), state.log.slice(-800));
    assert.equal(state.exited, null);
    const h = await health(31986);
    assert.equal(h.status, 'ok', 'the rejections are shown, not turned into a failing health check');
    assert.deepEqual(h.unhandledRejections, { total: 3, recent: 3, windowSeconds: 60 });
    assert.match(state.log, /\[proc\] unhandled rejection #1 \(1 in the last 60 seconds\): it belongs to no request and the proxy stays up: Error: fixture rejection after listen 1\n\s+at /);
    const r = await fetch('http://127.0.0.1:31986/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'Hello there, friend.', voice: 'alloy' }) });
    assert.equal(r.status, 200);
    assert.ok((await r.arrayBuffer()).byteLength > 44);
  });
});

test('20 in a minute are tolerated, 21 end the process, and the log says how many', async () => {
  await withServer(31987, { REJECT_COUNT: '20', PROXY_BOOT_GRACE_MS: '0' }, async (state) => {
    assert.ok(await ready(31987, state), state.log);
    assert.ok(await until(() => (state.log.match(/\[proc\] unhandled rejection #\d/g) || []).length === 20), state.log.slice(-800));
    await sleep(300);
    assert.equal(state.exited, null, '20 is the limit, not over it');
    assert.equal((await health(31987)).unhandledRejections.recent, 20);
  });
  await withServer(31988, { REJECT_COUNT: '21', PROXY_BOOT_GRACE_MS: '0' }, async (state) => {
    assert.ok(await until(() => state.exited !== null, 15000), state.log.slice(-500));
    assert.equal(state.exited.code, 1);
    assert.match(state.log, /\[proc\] 21 unhandled rejections in the last 60 seconds, ending the process so the platform restarts it; the last one: Error: fixture rejection after listen 21/);
  });
});

test('the window slides on the real server: 20, then 20 more after the window has passed, is no storm', async () => {
  await withServer(31989, { REJECT_COUNT: '20', REJECT_AGAIN_AFTER_MS: '1800', PROXY_BOOT_GRACE_MS: '0', PROXY_REJECTION_WINDOW_MS: '1000' }, async (state) => {
    assert.ok(await ready(31989, state), state.log);
    assert.ok(await until(() => (state.log.match(/\[proc\] unhandled rejection #\d/g) || []).length === 40, 12000), state.log.slice(-800));
    assert.equal(state.exited, null, 'the first 20 had left the window when the second 20 came');
    const h = await health(31989);
    assert.equal(h.unhandledRejections.total, 40);
    assert.equal(h.unhandledRejections.windowSeconds, 1);
  });
});

test('PROXY_REJECTION_LIMIT lowers the storm limit', async () => {
  await withServer(31979, { REJECT_COUNT: '3', PROXY_BOOT_GRACE_MS: '0', PROXY_REJECTION_LIMIT: '2' }, async (state) => {
    assert.ok(await until(() => state.exited !== null, 15000), state.log.slice(-500));
    assert.equal(state.exited.code, 1);
    assert.match(state.log, /3 unhandled rejections in the last 60 seconds/);
  });
});
