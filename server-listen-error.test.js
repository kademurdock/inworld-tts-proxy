'use strict';
// Nov 8 2026. server.js called app.listen(...) and kept no hold of the server it returned, so the server's 'error' event had no
// listener. An 'error' event with no listener is an uncaught exception: the process ends with a stack trace. Two ways to meet it:
//   - at boot, the port is taken (or not ours to use): ending the process is right (Railway then restarts it), but with one plain line
//     that says why instead of a stack from node:events;
//   - while serving, the server reports a failed accept (EMFILE, when the process is out of file descriptors): that is a moment of
//     trouble, not an end: connections that were already open keep being served and the next accept works once a descriptor is free.
//     With no listener the whole family's voice went down with it (route-guard review of Nov 7 2026, suspicion).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, preloads) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-listen-error-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0' };
  delete env.SPEECH_GATE;
  const args = ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), ...preloads.flatMap((p) => ['--require', path.join(__dirname, 'test-fixtures', p)]), 'server.js'];
  const child = spawn(process.execPath, args, { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('the port is taken at boot: the process ends with exit code 1 and one plain line, not a stack trace', async () => {
  const port = 31928;
  const squatter = await new Promise((resolve) => { const s = net.createServer(); s.listen(port, () => resolve(s)); });
  const s = start(port, []);
  try {
    assert.ok(await waitFor(() => s.state.exited !== null, 30000), 'the process ended: ' + s.state.log.slice(-300));
    assert.equal(s.state.exited.code, 1);
    assert.match(s.state.log, new RegExp(`\\[proxy\\] cannot listen on port ${port}: EADDRINUSE`));
    assert.doesNotMatch(s.state.log, /node:events|setupListenHandle|Emitted 'error' event/, 'and no stack from node:events');
  } finally {
    await s.stop();
    await new Promise((r) => squatter.close(r));
  }
});

test('the server reports a failed accept (EMFILE) while serving: the process says so once and keeps serving', async () => {
  const port = 31928;
  const s = start(port, ['server-error.cjs']);
  try {
    assert.ok(await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500; } catch { return false; } }, 30000), s.state.log);
    const r = await fetch(`http://127.0.0.1:${port}/__emit-server-error`);
    assert.deepEqual(await r.json(), { scheduled: true });
    await new Promise((res) => setTimeout(res, 600));
    assert.equal(s.state.exited, null, 'the process is still up: ' + s.state.log.slice(-400));
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200, 'and serving');
    const lines = s.state.log.split('\n').filter((l) => l.includes('[proxy] server error'));
    assert.equal(lines.length, 1, 'one line: ' + JSON.stringify(lines));
    assert.match(lines[0], /\[proxy\] server error \(still listening\): EMFILE accept EMFILE/);
    // a second one a moment later is counted, not repeated
    await fetch(`http://127.0.0.1:${port}/__emit-server-error`);
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(s.state.log.split('\n').filter((l) => l.includes('[proxy] server error')).length, 1, 'the second one inside ten seconds is not logged again');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
