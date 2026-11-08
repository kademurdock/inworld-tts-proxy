'use strict';
// Nov 8 2026. The fetch to Deepgram in POST /v1/audio/transcriptions had no timeout of its own: a Deepgram that took the audio and went
// quiet held the request, and up to 160 MB of buffered audio with it, until the HTTP client gave up (undici's own limits are 5 minutes;
// the route-guard review of Nov 7 2026 asked for one of the route's own). Now the call is cut after DEEPGRAM_TIMEOUT_MS (240 s unless
// set), the caller is told 504 once, and the memory goes back. Through the real HTTP handler, a Deepgram fixture that never answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-transcription-timeout-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0', ...extra };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/deepgram-hang.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, rows, stop };
}

async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function upload(port, bytes, waitMs = 6000) {
  const body = Buffer.concat([
    Buffer.from('--zzz\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n', 'latin1'),
    bytes,
    Buffer.from('\r\n--zzz--\r\n', 'latin1'),
  ]);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true, ms: Date.now() - t0 }); }, waitMs);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent: false, headers: { 'Content-Type': 'multipart/form-data; boundary=zzz', 'Content-Length': body.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), ms: Date.now() - t0 }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message, ms: Date.now() - t0 }); });
    req.end(body);
  });
}

const AUDIO = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 0x41)]);

test('a Deepgram that never answers: the caller gets 504 once the route\'s own timeout runs out, every time, and the process serves on', async () => {
  const port = 31969;
  const s = start(port, { DEEPGRAM_TIMEOUT_MS: '600' });
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    for (let i = 0; i < 3; i++) {
      const r = await upload(port, AUDIO);
      assert.ok(!r.hang && !r.reset, `request ${i}: ${JSON.stringify(r)}`);
      assert.equal(r.status, 504, `request ${i}: ${r.body}`);
      assert.equal(r.body, '{"error":"Transcription timed out."}');
      assert.ok(r.ms >= 500 && r.ms < 4000, `answered after ${r.ms} ms`);
    }
    const rows = s.rows();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((x) => x.hasSignal && x.bytes === AUDIO.length), 'each call to Deepgram carried an abort signal and the whole audio');
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal(s.state.exited, null);
    assert.doesNotMatch(s.state.log, /Unhandled|uncaught|ERR_HTTP_HEADERS_SENT/i);
  } finally {
    await s.stop();
  }
});

test('the timeout is 240 seconds unless DEEPGRAM_TIMEOUT_MS says otherwise (a whole number of milliseconds a timer can take)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(src.includes('const DEEPGRAM_TIMEOUT_MS = (() => { const n = Math.floor(Number(process.env.DEEPGRAM_TIMEOUT_MS)); return n >= 1 && n <= 2147483647 ? n : 240000; })();'), 'the default is 240000 ms; the variable must be 1 to 2147483647');
  assert.ok(src.includes('signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS)'), 'and the fetch carries it');
});

test('a value for DEEPGRAM_TIMEOUT_MS that a timer cannot take is ignored: the call is not cut at once, it waits as it would with no value', async () => {
  const port = 31969;
  // 5e9 and 1e999 and Infinity make AbortSignal.timeout throw, 2147483648 would become a 1 ms timer, 0 and -5 and 0.5 mean "no time", abc is not a number
  for (const value of ['5e9', '1e999', 'Infinity', '2147483648', '4294967296', '0', '-5', '0.5', 'abc', '']) {
    const s = start(port, { DEEPGRAM_TIMEOUT_MS: value });
    try {
      assert.ok(await ready(port, s.state), s.state.log);
      const r = await upload(port, AUDIO, 1500);
      assert.ok(r.hang, `DEEPGRAM_TIMEOUT_MS=${JSON.stringify(value)}: the call was cut at once or failed (${JSON.stringify(r)}) instead of waiting for a Deepgram that is only slow`);
      assert.equal(s.state.exited, null);
      assert.equal(s.rows().length, 1, 'the call to Deepgram was made');
    } finally {
      await s.stop();
    }
  }
});

test('a Deepgram that fails some other way (the connection drops) is still a 502, not a timeout', async () => {
  const port = 31969;
  const s = start(port, { DEEPGRAM_TIMEOUT_MS: '600', DEEPGRAM_FIXTURE_MODE: 'reset' });
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await upload(port, AUDIO);
    assert.ok(!r.hang && !r.reset, JSON.stringify(r));
    assert.equal(r.status, 502, r.body);
    assert.equal(r.body, '{"error":"Transcription failed."}');
    assert.ok(r.ms < 400, 'answered at once, not after the timeout: ' + r.ms + ' ms');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
