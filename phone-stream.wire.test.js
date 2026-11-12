'use strict';
// Nov 12 2026 (gateway audit GW-10). The phone's first piece streams: ?telephony=1 with x-kade-tts-stream: 1 goes through the
// streamed Inworld lane and comes back as mu-law while it is still being made. Without the header, or with TTS_STREAM_TELEPHONY=0,
// it is today's buffered answer. A stream that dies before any audio, or a format the phone sink cannot take, falls back to the
// buffered answer (never an empty 200, never WAV bytes framed as mu-law). Real server; the fixtures block the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BRIDGE_PHONE = { 'x-kade-caller': 'bridge-phone' };

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-phone-stream-'));
  const receipt = path.join(dir, 'requests.jsonl');
  const streams = path.join(dir, 'streams.jsonl');
  fs.writeFileSync(receipt, '');
  fs.writeFileSync(streams, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt, STREAM_RECEIPT: streams,
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
    ...extra,
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE',
    'TTS_STREAM', 'TTS_STREAM_TELEPHONY', 'TTS_PHONE_DECIMATOR'].filter((k) => !(k in extra))) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'),
    '--require', path.join(__dirname, 'test-fixtures/provider-stream-paced.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const streamCalls = () => fs.readFileSync(streams, 'utf8').split(/\r?\n/).filter(Boolean).length;
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { state, streamCalls, stop };
}
async function ready(port, state) {
  for (let i = 0; i < 600 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
function speak(port, input, { headers = {}, query = '?telephony=1' } = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ input, voice: 'alloy' }), 'utf8');
    const t0 = Date.now();
    let firstAt = 0;
    const req = http.request({ host: '127.0.0.1', port, path: `/v1/audio/speech${query}`, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...BRIDGE_PHONE, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (!firstAt) firstAt = Date.now() - t0; chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks), firstAt, ms: Date.now() - t0 }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(data);
  });
}
const STREAM = { 'x-kade-tts-stream': '1' };
async function logged(state, re) {
  for (let i = 0; i < 100 && !re.test(state.log); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(state.log, re);
}

test('the phone opener streams as mu-law while it is made; without the header it is buffered', async (t) => {
  const s = start(32051);
  t.after(() => s.stop());
  assert.ok(await ready(32051, s.state), s.state.log.slice(-2000));

  const r = await speak(32051, 'Well hello there, it is good to hear you.', { headers: STREAM });
  assert.equal(r.status, 200, s.state.log.slice(-800));
  assert.equal(r.headers['content-type'], 'audio/basic');
  assert.equal(r.headers['x-kade-tts-streamed'], '1');
  assert.equal(r.headers['content-length'], undefined, 'streamed, so no length up front');
  assert.notEqual(r.raw.toString('latin1', 0, 4), 'RIFF', 'mu-law, not WAV bytes');
  assert.ok(Math.abs(r.raw.length - 9600) <= 16, `1.2 s of 8 kHz mu-law (${r.raw.length} bytes)`);
  assert.ok(r.firstAt < r.ms - 400, `first bytes at ${r.firstAt} ms, the whole answer at ${r.ms} ms`);
  // Lead review: the opener ends in the buffered lane's 12 ms fade, not a step (the July 1 click fix).
  const dec = (u) => { u = ~u & 0xFF; const m = ((((u & 0x0F) << 3) + 132) << ((u >> 4) & 7)) - 132; return u & 0x80 ? -m : m; };
  const peak = (from, to) => { let p = 0; for (let i = from; i < to; i++) p = Math.max(p, Math.abs(dec(r.raw[i]))); return p; };
  const n = r.raw.length;
  assert.ok(peak(n - 400, n - 200) > 4000, "the tone is at full level before the tail");
  assert.ok(peak(n - 4, n) < 600, `the last samples are faded (${peak(n - 4, n)})`);
  await logged(s.state, /\[TTS\] stream out: .* telephony=yes/); // written after the answer has ended

  const b = await speak(32051, 'Well hello there, it is good to hear you.');
  assert.equal(b.status, 200);
  assert.equal(b.headers['x-kade-tts-streamed'], undefined, 'no stream header: buffered as before');
  assert.ok(b.headers['content-length']);
  assert.equal(s.streamCalls(), 1);
});

test('a stream that dies before audio, or a format the phone cannot take, falls back to the buffered answer', async (t) => {
  const s = start(32052);
  t.after(() => s.stop());
  assert.ok(await ready(32052, s.state), s.state.log.slice(-2000));
  for (const word of ['dropearly', 'stereo', 'oddrate']) {
    const r = await speak(32052, `This one is ${word} on purpose.`, { headers: STREAM });
    assert.equal(r.status, 200, `${word}: ${s.state.log.slice(-600)}`);
    assert.equal(r.headers['x-kade-tts-streamed'], undefined, `${word}: buffered, not streamed`);
    assert.equal(r.headers['content-type'], 'audio/basic', word);
    assert.ok(r.raw.length > 1000, `${word}: the buffered audio came back (${r.raw.length} bytes)`);
  }
  assert.match(s.state.log, /telephony cannot stream 24000Hz\/2ch\/16bit -- falling back to buffered/);
  assert.match(s.state.log, /telephony cannot stream 22050Hz\/1ch\/16bit -- falling back to buffered/);
  assert.match(s.state.log, /stream: died before first audio .* falling back to buffered/);

  const mid = await speak(32052, 'This one is dropmid on purpose.', { headers: STREAM });
  assert.equal(mid.status, 200);
  assert.equal(mid.headers['x-kade-tts-streamed'], '1');
  assert.ok(mid.raw.length > 0 && mid.raw.length < 9600, `a short opener (${mid.raw.length} bytes)`);
  await logged(s.state, /stream: died mid-clip after \d+ bytes/);
});

test('TTS_STREAM_TELEPHONY=0: the phone never streams, even when asked', async (t) => {
  const s = start(32053, { TTS_STREAM_TELEPHONY: '0' });
  t.after(() => s.stop());
  assert.ok(await ready(32053, s.state), s.state.log.slice(-2000));
  const r = await speak(32053, 'Well hello there, it is good to hear you.', { headers: STREAM });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-kade-tts-streamed'], undefined);
  assert.ok(r.headers['content-length']);
  assert.equal(s.streamCalls(), 0);
});
