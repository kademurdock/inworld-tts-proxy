'use strict';
// Nov 7 2026 (an independent review of the Nov 6 robustness commits, which closed the crash for a non-string `input`): the same
// crash was still open one field over. `voice` and `model` come straight out of the request body and are used in String(),
// template literals and object lookups before any try/catch of the async Express 4 handler, so a value whose conversion to
// text throws ({"toString":1} is enough, or an array nested 20,000 deep) became an unhandled rejection that ended the process
// for every listener. Now: such a voice or model gets a 400 and nothing else about a request that worked changes, and the
// speech route runs inside guardAsync, so any other throw in its body ends that one request with a 500.
// (A process-level unhandledRejection net was tried too and left out: it turned a crash into a request that is never answered on
// every route without a guard of its own. See the commit message.)
// Through the real HTTP handler, the provider fixture instead of the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-handler-guard-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
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
  return { child, state, rows, stop };
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
    const raw = async (text) => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      const type = r.headers.get('content-type') || '';
      return { status: r.status, body: /json/.test(type) ? await r.json() : (await r.arrayBuffer(), null) };
    };
    const post = (obj) => raw(JSON.stringify(obj));
    return await run({ raw, post, rows: s.rows, state: s.state });
  } finally {
    await s.stop();
  }
}

const deep = (n) => '['.repeat(n) + ']'.repeat(n);
const SENTINEL = 'Hi there. This is how I sound.';   // the native app's voice-preview line: it takes the String(voice) path too

// JSON texts, because some of them cannot be written by JSON.stringify
const BAD_VALUES = [
  ['an object with a toString that is not a function', '{"toString":1}'],
  ['an array holding one', '[{"toString":1}]'],
  ['a toString and a valueOf that are null', '{"toString":null,"valueOf":null}'],
  ['a toString that is an object', '{"toString":{}}'],
  ['an array nested 20,000 deep', deep(20000)],
];

test('a voice that cannot be turned into text gets a 400, nothing reaches a provider, and the proxy stays up', async () => {
  await withServer(31980, async ({ raw, post, rows, state }) => {
    for (const [name, value] of BAD_VALUES) {
      for (const input of ['Hello there.', SENTINEL]) {
        const r = await raw(`{"input":${JSON.stringify(input)},"voice":${value}}`);
        assert.equal(state.exited, null, `${name} killed the server: ${state.log.slice(-500)}`);
        assert.equal(r.status, 400, `${name}: ${JSON.stringify(r)}`);
        assert.match(r.body.error, /voice must be a string/, name);
      }
    }
    assert.equal(rows(), 0, 'nothing was sent to a provider for any of them');
    const ok = await post({ input: 'Hello there, friend.', voice: 'alloy' });
    assert.equal(ok.status, 200, 'and the same server still speaks');
    assert.equal(rows(), 1);
  });
});

test('the same for a model, with an Inworld voice and with a Fish voice', async () => {
  await withServer(31981, async ({ raw, rows, state }) => {
    for (const voice of ['"alloy"', '"fish:fixture"']) {
      for (const [name, value] of BAD_VALUES) {
        const r = await raw(`{"input":"Hello there.","voice":${voice},"model":${value}}`);
        assert.equal(state.exited, null, `${voice} model ${name} killed the server: ${state.log.slice(-500)}`);
        assert.equal(r.status, 400, `${voice} model ${name}: ${JSON.stringify(r)}`);
        assert.match(r.body.error, /model must be a string/, name);
      }
    }
    assert.equal(rows(), 0);
  });
});

test('an earlier answer wins: a missing or non-string input is still reported as before, whatever the voice is', async () => {
  await withServer(31982, async ({ raw, state }) => {
    const missing = await raw('{"voice":{"toString":1}}');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'Missing required field: input');
    const notString = await raw('{"input":5,"voice":{"toString":1}}');
    assert.equal(notString.status, 400);
    assert.match(notString.body.error, /input must be a string/);
    assert.equal(state.exited, null);
  });
});

// everything that converts to text keeps the answer it always had: pinned from what the proxy answered before this change
const KEEPS_WORKING = [
  ['a string', '{"voice":"alloy"}'],
  ['a number', '{"voice":5}'],
  ['null', '{"voice":null}'],
  ['true', '{"voice":true}'],
  ['an array of one string', '{"voice":["alloy"]}'],
  ['an empty array', '{"voice":[]}'],
  ['an OpenAI custom-voice object', '{"voice":{"id":"voice_1"}}'],
  ['an empty object', '{"voice":{}}'],
  ['the name of an inherited property', '{"voice":"constructor"}'],
  ['a model that is a number', '{"model":5}'],
  ['a model that is null', '{"model":null}'],
  ['a model that is an array', '{"model":["tts-1"]}'],
  ['a model that is an object with an id', '{"model":{"id":"tts-1"}}'],
  ['a model named like an inherited property', '{"model":"constructor"}'],
];

test('every voice and model that converts to text is answered exactly as before: 200 and one provider request', async () => {
  await withServer(31983, async ({ raw, rows, state }) => {
    let want = 0;
    for (const [name, fields] of KEEPS_WORKING) {
      const r = await raw(`{"input":"Hello there, friend.",${fields.slice(1)}`);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r)}`);
      want += 1;
      assert.equal(rows(), want, `${name}: one provider request`);
    }
    assert.equal(state.exited, null);
  });
});

// ── guardAsync, sliced out of server.js ────────────────────────────────────────────
function loadGuard() {
  const i = src.indexOf('function convertsToText');
  const j = src.indexOf('app.post("/v1/audio/speech"', i);
  assert.ok(i > -1 && j > i, 'server.js no longer holds convertsToText .. the speech route');
  const logs = [];
  const ctx = { console: { error: (...a) => logs.push(a.join(' ')) } };
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, j) + '\nthis.fns = { convertsToText, guardAsync };', ctx);
  return { ...ctx.fns, logs };
}
function fakeRes({ headersSent = false, throwOnSend = false } = {}) {
  const res = { sent: [], ended: 0, headersSent };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { if (throwOnSend) throw new Error('socket gone'); res.sent.push(b); return res; };
  res.end = () => { res.ended += 1; };
  return res;
}
const settle = () => new Promise((r) => setImmediate(r));

test('guardAsync: a handler that rejects ends its own request with a 500 and nothing else', async () => {
  const { guardAsync, logs } = loadGuard();
  const res = fakeRes();
  guardAsync(async () => { throw new Error('boom inside the handler'); })({}, res, () => {});
  await settle();
  assert.equal(res.code, 500);
  assert.equal(JSON.stringify(res.sent), JSON.stringify([{ error: 'Proxy internal error' }]));   // (built inside the vm: compare as text)
  assert.match(logs.join('\n'), /speech handler threw \(boom inside the handler\)/);
});

test('guardAsync: once the headers are out it ends the response instead of writing a second one, and a dead socket is not a second crash', async () => {
  const { guardAsync } = loadGuard();
  const started = fakeRes({ headersSent: true });
  guardAsync(async () => { throw new Error('late'); })({}, started, () => {});
  await settle();
  assert.equal(started.ended, 1);
  assert.equal(started.sent.length, 0);
  const dead = fakeRes({ throwOnSend: true });
  guardAsync(async () => { throw new Error('and the socket is gone'); })({}, dead, () => {});
  await settle();   // would be an unhandled rejection if the answer's own throw escaped
});

test('guardAsync: whatever was thrown, even something that cannot be printed, still gets the 500 (a Symbol, an object without a prototype, null)', async () => {
  // found by the independent review: the log line interpolated the cause, a Symbol or a null-prototype object made it throw inside the
  // .catch callback, and that one request was never answered
  const { guardAsync, logs } = loadGuard();
  const cases = [
    ['a Symbol', () => { throw Symbol('x'); }],
    ['an object without a prototype', () => { throw Object.create(null); }],
    ['null', () => { throw null; }],
    ['a string', () => { throw 'plain text'; }],
    ['a number', () => { throw 42; }],
    ['an object whose message getter throws', () => { throw { get message() { throw new Error('no message for you'); } }; }],
  ];
  for (const [name, thrower] of cases) {
    const res = fakeRes();
    guardAsync(async () => { thrower(); })({}, res, () => {});
    await settle();
    assert.equal(res.code, 500, name);
    assert.equal(JSON.stringify(res.sent), JSON.stringify([{ error: 'Proxy internal error' }]), name);
  }
  assert.ok(logs.length >= 4, 'the printable ones were still logged');
});

test('guardAsync: a handler that finishes is left alone, and convertsToText says what the proxy can use', async () => {
  const { guardAsync, convertsToText } = loadGuard();
  const res = fakeRes();
  guardAsync(async (_req, r) => { r.json({ ok: true }); })({}, res, () => {});
  await settle();
  assert.equal(JSON.stringify(res.sent), JSON.stringify([{ ok: true }]));
  assert.equal(res.code, undefined);
  for (const v of ['alloy', 5, null, undefined, true, [], ['a'], {}, { id: 'x' }]) assert.equal(convertsToText(v), true, String(JSON.stringify(v)));
  for (const v of [{ toString: 1 }, [{ toString: 1 }], { toString: null, valueOf: null }, JSON.parse(deep(20000))]) assert.equal(convertsToText(v), false);
});

test('the speech route is registered through guardAsync, and closes with it', () => {
  assert.match(src, /app\.post\("\/v1\/audio\/speech", bodyLimits\.speechJson, guardAsync\(async \(req, res\) => \{/); // Nov 8 2026: its own 128 KB JSON parser first (body-limits.js)
  assert.match(src, /res\.status\(500\)\.json\(\{ error: "Proxy internal error", details: err\.message \}\);\r?\n  \}\r?\n\}\)\);/);
});
