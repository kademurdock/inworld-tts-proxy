'use strict';
// Nov 7 2026, route-guard hardening. The source-text checks in async-routes.test.js and final-error-handler.test.js say where
// server.js MEANS to mount the Layer patch and the final error middleware; this asks the running server what it really has:
// the patch is installed, the final error middleware is the last thing in the app's stack and the only error handler anywhere
// (an error handler mounted after it, or one inside a router, would take errors before it and change what callers are told).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-route-stack-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0' };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), '--require', path.join(__dirname, 'test-fixtures/stack-probe.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('the running server has the Layer patch installed, and the final error middleware is the last thing in its stack and the only error handler', async () => {
  const port = 31999;
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const probe = await (await fetch(`http://127.0.0.1:${port}/__stack`)).json();
    assert.equal(probe.patched, true, 'Layer.prototype.handle_request carries the async-routes flag');
    const { stack } = probe;
    assert.ok(stack.length >= 15, 'a real app: ' + stack.length + ' layers');
    const last = stack.at(-1);
    assert.equal(last.name, 'finalErrorHandler', 'the last layer: ' + JSON.stringify(last));
    assert.equal(last.arity, 4);
    assert.deepEqual(stack.filter((l) => l.arity === 4).map((l) => l.name), ['finalErrorHandler'], 'the only error handler at the top level');
    assert.equal(stack.reduce((n, l) => n + l.innerErrorHandlers, 0), 0, 'and none inside a mounted router');
    const routes = stack.filter((l) => l.route);
    for (const want of ['post /v1/audio/speech', 'post /v1/audio/transcriptions', 'get /health']) assert.ok(routes.some((l) => l.route === want), want + ' is mounted');
    assert.ok(routes.every((l) => l.i < last.i), 'every route of server.js is before it');
    const routers = stack.filter((l) => l.name === 'router');
    assert.ok(routers.length >= 6 && routers.every((l) => l.i < last.i), 'the routers (help, design docs, railway, github, approvals, librechat ...) are mounted before it as well');
  } finally {
    await s.stop();
  }
});
