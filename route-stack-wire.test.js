'use strict';
// Nov 7 2026, route-guard hardening. The source-text checks in async-routes.test.js and final-error-handler.test.js say what
// server.js MEANS to wire; this asks the running server what it really has: the Layer patch is installed, the final error
// handler is the app's own `done` (app.handle), and the app's stack holds NO error-handling layer anywhere and ends on a route.
// Why that last part matters: a layer after the last route, even a harmless one, is visited by every request that no route
// answers, and Express 4 then defers that request's `done` by a setImmediate, which let big JSON bodies pile up in memory until the
// process died (reviewer A of the review of Nov 7 2026). An error handler inside a mounted router would take errors before the
// final handler and change what callers are told.
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

test('the running server has the Layer patch and the final handler installed, no error layer anywhere, and a stack that ends on a route', async () => {
  const port = 31999;
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const probe = await (await fetch(`http://127.0.0.1:${port}/__stack`)).json();
    assert.equal(probe.patched, true, 'Layer.prototype.handle_request carries the async-routes flag');
    assert.equal(probe.finalHandler, true, 'app.handle carries the final-handler flag');
    assert.equal(probe.handleName, 'handleWithFinalErrorHandler');
    const { stack } = probe;
    assert.ok(stack.length >= 15, 'a real app: ' + stack.length + ' layers');
    assert.deepEqual(stack.filter((l) => l.arity === 4).map((l) => l.name), [], 'no error-handling layer at the top level: the handler is not a layer');
    assert.equal(stack.reduce((n, l) => n + l.innerErrorHandlers, 0), 0, 'and none inside a mounted router');
    const last = stack.at(-1);
    assert.ok(last.route, 'the stack ends on a route, not on a middleware that every unanswered request would pass through: ' + JSON.stringify(last));
    const routes = stack.filter((l) => l.route);
    for (const want of ['post /v1/audio/speech', 'post /v1/audio/transcriptions', 'get /health']) assert.ok(routes.some((l) => l.route === want), want + ' is mounted');
    const routers = stack.filter((l) => l.name === 'router');
    assert.ok(routers.length >= 6, 'the routers (help, design docs, railway, github, approvals, librechat ...) are mounted: ' + routers.length);
  } finally {
    await s.stop();
  }
});
