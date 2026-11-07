'use strict';
// Nov 6 2026 (a red team, while the steering-tag leak was being fixed): a speech request whose `input` is not a
// string used to crash the whole proxy. stripThinkingBlock ran outside any try/catch in an async Express 4 handler,
// `text.replace is not a function` became an unhandled rejection, and Node exited, taking every listener's stream
// with it (Railway restarts it, a few seconds later). The handler now answers 400 and stays up.
// Through the real HTTP handler, the provider fixture instead of the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function withServer(port, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-input-type-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  try {
    let ready = false;
    for (let i = 0; i < 160 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    const post = async (body) => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const type = r.headers.get('content-type') || '';
      return { status: r.status, body: /json/.test(type) ? await r.json() : (await r.arrayBuffer(), null) };
    };
    const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).length;
    return await run({ post, rows, exited: () => exited, log: () => log });
  } finally {
    if (!exited) child.kill();
    await new Promise((r) => (exited ? r() : child.once('exit', r)));
  }
}

// every JSON value that is not a string (the falsy ones are the old "missing" answer, tested below)
const NOT_STRINGS = [
  ['a number', 5],
  ['a negative number', -1.5],
  ['true', true],
  ['an object', { text: 'Hello there.' }],
  ['an empty object', {}],
  ['an array of strings', ['Hello there.', 'And more.']],
  ['an empty array', []],
  ['a nested array', [['Hello there.']]],
];

test('an input that is not a string gets a 400 that says so, and the proxy stays up', async () => {
  await withServer(31970, async ({ post, rows, exited, log }) => {
    for (const [name, input] of NOT_STRINGS) {
      const r = await post({ input, voice: 'alloy' });
      assert.equal(exited(), null, `${name} killed the server: ${log().slice(-600)}`);
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r)}`);
      assert.match(r.body.error, /input must be a string/, name);
    }
    assert.equal(rows(), 0, 'nothing was sent to a provider for any of them');
    // and the same server still speaks
    const ok = await post({ input: 'Hello there, friend.', voice: 'alloy' });
    assert.equal(ok.status, 200);
    assert.equal(rows(), 1);
  });
});

test('the same on a Fish voice, and with the optional fields present', async () => {
  await withServer(31971, async ({ post, exited, log }) => {
    for (const voice of ['alloy', 'fish:fixture']) {
      for (const [name, input] of NOT_STRINGS) {
        const r = await post({ input, voice, model: 'tts-1', speed: 1, delivery: 'CREATIVE', stream: true });
        assert.equal(exited(), null, `${voice} ${name} killed the server: ${log().slice(-600)}`);
        assert.equal(r.status, 400, `${voice} ${name}`);
      }
    }
  });
});

test('a missing, null, empty, zero or false input keeps its old answer; a blank string is still silence, not an error', async () => {
  await withServer(31972, async ({ post, exited }) => {
    for (const body of [{}, { input: null }, { input: '' }, { input: 0 }, { input: false }]) {
      const r = await post({ voice: 'alloy', ...body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error, 'Missing required field: input', JSON.stringify(body));
    }
    const blank = await post({ input: '   ', voice: 'alloy' });
    assert.equal(blank.status, 200, 'whitespace speaks nothing, quietly');
    assert.equal(exited(), null);
  });
});
