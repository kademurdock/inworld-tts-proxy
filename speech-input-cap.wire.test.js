'use strict';
// Nov 10 2026. The Nov 8 hardening capped the JSON of a speech request at 256 KB but left the length of `input` itself open: the work
// the route does grows with the text (one 257 KB request held the loop 1.1 s with an instant provider, and long audio holds it for as
// long as it is), and every character is paid for at the provider. The biggest request the LibreChat fork can make is one `input` of
// 100,000 characters, so a longer one is refused 413 before any provider is asked. Real server, real HTTP handler; the provider fixture
// blocks the network, so nothing leaves the machine and nothing is paid.
// The first shape of this cap was 32,767 (the fork's manual lane, which cuts longer text into pieces of 4,000). The independent review
// of the same day found that the fork's AUTO-PLAY lane sends a finished message whole, up to 100,000 characters (its speechCap.js, which
// records a real request of 56,702): at 32,767 the website would have gone silent for every reply longer than that. The second test
// below is that case.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-input-cap-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt,
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
    ...extra,
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE']) delete env[k];
  if (!('SPEECH_MAX_INPUT_CHARS' in extra)) delete env.SPEECH_MAX_INPUT_CHARS;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null, receipt };
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
async function withServer(port, extra, run) {
  const s = start(port, extra);
  try {
    assert.ok(await ready(port, s.state), s.state.log.slice(-2000));
    return await run({ port, state: s.state });
  } finally {
    await s.stop();
  }
}
function speak(port, input) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ input, voice: 'alloy', model: 'tts-1' }), 'utf8');
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/speech', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks), body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(300000, () => req.destroy(new Error('no answer in 300 s')));
    req.end(data);
  });
}
const providerCalls = (state) => fs.readFileSync(state.receipt, 'utf8').split(/\r?\n/).filter(Boolean).length;
const sentence = 'The river ran low that summer. ';
const textOf = (n) => sentence.repeat(Math.ceil(n / sentence.length)).slice(0, n);

test('an input one character over 100,000 is refused 413 and no provider is asked; an ordinary request still gets its audio', async () => {
  await withServer(32001, {}, async ({ port, state }) => {
    const ok = await speak(port, 'Hello there.');
    assert.equal(ok.status, 200, ok.body.slice(0, 200));
    assert.equal(ok.raw.toString('latin1', 0, 4), 'RIFF', 'audio came back');
    const before = providerCalls(state);
    assert.ok(before >= 1, 'the provider fixture saw the ordinary request');
    const over = await speak(port, textOf(100001));
    assert.equal(over.status, 413);
    assert.equal(over.body, '{"error":"Input too long: at most 100000 characters in one request"}');
    assert.equal(providerCalls(state), before, 'nothing was sent to a provider for the refused text');
    assert.equal(state.exited, null);
  });
});

test('what the website\'s auto-play really sends is spoken: one finished reply of 32,768, of 56,702 and of 100,000 characters', async () => {
  await withServer(32007, {}, async ({ port, state }) => {
    for (const n of [32768, 56702, 100000]) {
      const before = providerCalls(state);
      const r = await speak(port, textOf(n));
      assert.equal(r.status, 200, `${n} characters: ${r.body.slice(0, 200)}`);
      assert.equal(r.raw.toString('latin1', 0, 4), 'RIFF', `${n} characters: audio came back`);
      assert.ok(providerCalls(state) > before, `${n} characters: the provider was asked`);
    }
    assert.equal(state.exited, null);
  });
});

test('SPEECH_MAX_INPUT_CHARS moves the limit; a value that is no whole number of 1,000 or more is ignored', async () => {
  await withServer(32002, { SPEECH_MAX_INPUT_CHARS: '2000' }, async ({ port, state }) => {
    assert.equal((await speak(port, textOf(2000))).status, 200, 'exactly at the limit is spoken');
    const before = providerCalls(state);
    const over = await speak(port, textOf(2001));
    assert.equal(over.status, 413);
    assert.match(over.body, /at most 2000 characters/);
    assert.equal(providerCalls(state), before);
  });
  await withServer(32003, { SPEECH_MAX_INPUT_CHARS: '12' }, async ({ port }) => {
    assert.equal((await speak(port, textOf(1500))).status, 200, 'a limit of 12 would silence every reply: ignored, the default stands');
  });
});
