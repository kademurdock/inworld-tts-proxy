'use strict';
// Nov 8 2026. Two answers the route-guard review of Nov 7 found echoing a provider's own error text to whoever asked:
//   - POST /v1/audio/speech, when synthesis failed, answered {"error":"Proxy internal error","details": err.message}: Inworld's or Fish's
//     words, and now and then a path, went to the caller;
//   - POST /v1/audio/transcriptions answered 502 with String(e) (a network error) or Deepgram's own err_msg.
// These two are the only echoes a caller who holds no admin secret can reach (the speech gate lets in the fork, the bridge and whoever
// holds KADE_SPEECH_SECRET, and in gate mode `log` anyone). Nobody reads the text: the LibreChat fork's speech and transcription
// services never look at an error body, the bridge only prints the first 200 characters of it in its own log, and the apps do not call
// these routes. So the cause goes to this service's log, where the one who debugs reads it, and the caller gets the plain answer.
// The one `details` that stays on the speech route is the service's own run-on diagnosis ("Fish ran on twice for this chunk ...": numbers,
// no provider text, meant to fail clearly; fish-runaway.test.js pins it).
// (The secret-gated routes keep their text: Forge, an LLM, and the bridge's nightly battery read it. See VOICE_PROVIDER_GUIDE.md.)
// Through the real HTTP handler, with provider fixtures that fail on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, fixture, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-answer-text-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0', ...extra };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures', fixture), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

function post(port, route, headers, body) {
  return new Promise((resolve) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true }); }, 15000);
    const req = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', agent: false, headers: { 'Content-Length': data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message }); });
    req.end(data);
  });
}

const upload = (port) => post(port, '/v1/audio/transcriptions', { 'Content-Type': 'multipart/form-data; boundary=zzz' }, Buffer.concat([
  Buffer.from('--zzz\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n', 'latin1'),
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 0x41),
  Buffer.from('\r\n--zzz--\r\n', 'latin1'),
]));

test('speech: when the provider refuses, the caller gets the plain answer and the provider\'s words go to the log', async () => {
  const port = 31927;
  const s = start(port, 'provider-rejects.cjs');
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await post(port, '/v1/audio/speech', { 'Content-Type': 'application/json' }, JSON.stringify({ input: 'Hello there, friend.', voice: 'alloy' }));
    assert.ok(!r.hang && !r.reset, JSON.stringify(r));
    assert.equal(r.status, 500);
    assert.equal(r.body, '{"error":"Proxy internal error"}');
    assert.match(s.state.log, /Proxy error: Error: Inworld API error 400: .*voices\.db is locked/, 'the cause is in the log');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});

test('transcription: Deepgram refuses the audio -> 502 with the plain answer; the message is in the log', async () => {
  const port = 31926;
  const s = start(port, 'deepgram-hang.cjs', { DEEPGRAM_FIXTURE_MODE: 'bad-audio' });
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await upload(port);
    assert.equal(r.status, 502, JSON.stringify(r));
    assert.equal(r.body, '{"error":"Transcription failed."}');
    assert.match(s.state.log, /\[stt\] Deepgram answered 400: Could not decode \/var\/dg\/spool\/upload-8841\.webm /);
    assert.doesNotMatch(s.state.log, /^\[proxy\] forged line/m, 'a line break in the message does not forge a log line of its own');
  } finally {
    await s.stop();
  }
});

test('transcription: the connection to Deepgram drops -> 502 with the plain answer; the cause is in the log', async () => {
  const port = 31926;
  const s = start(port, 'deepgram-hang.cjs', { DEEPGRAM_FIXTURE_MODE: 'reset' });
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await upload(port);
    assert.equal(r.status, 502, JSON.stringify(r));
    assert.equal(r.body, '{"error":"Transcription failed."}');
    assert.match(s.state.log, /\[stt\] the call to Deepgram failed: .*fetch failed/);
  } finally {
    await s.stop();
  }
});

test('transcription: a timeout is its own answer (504), still without a word of the cause', async () => {
  const port = 31926;
  const s = start(port, 'deepgram-hang.cjs', { DEEPGRAM_TIMEOUT_MS: '500' });
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await upload(port);
    assert.equal(r.status, 504, JSON.stringify(r));
    assert.equal(r.body, '{"error":"Transcription timed out."}');
    assert.match(s.state.log, /\[stt\] Deepgram did not answer within 500 ms/);
  } finally {
    await s.stop();
  }
});
