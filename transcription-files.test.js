'use strict';
// Nov 8 2026. POST /v1/audio/transcriptions capped ONE file at 160 MB but not how many files a form may hold: every file part was
// appended to the same buffer, so a form with fifty parts of 160 MB each could ask for 8 GB of memory (the route-guard review of
// Nov 7 2026), and the audio sent to Deepgram was the parts glued end to end. The route reads one file, the first; busboy's
// `files: 1` skips the others without buffering them, so the memory the route can hold is the 160 MB of that one file.
// Through the real HTTP handler, a Deepgram fixture instead of the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-transcription-files-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0' };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/deepgram.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

function upload(port, body) {
  return new Promise((resolve) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true }); }, 15000);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent: false, headers: { 'Content-Type': 'multipart/form-data; boundary=zzz', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message }); });
    req.end(data);
  });
}

const filePart = (name, bytes) => Buffer.concat([
  Buffer.from(`--zzz\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.webm"\r\nContent-Type: audio/webm\r\n\r\n`, 'latin1'),
  bytes,
  Buffer.from('\r\n', 'latin1'),
]);
const field = (name, value) => Buffer.from(`--zzz\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'latin1');
const END = Buffer.from('--zzz--\r\n', 'latin1');
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // what Deepgram's content sniffer takes for webm
const audio = (n, fill) => Buffer.concat([EBML, Buffer.alloc(n - 4, fill)]);

test('a form with one file works as before: the file goes to Deepgram whole, the language field rides along', async () => {
  const port = 31950;
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const r = await upload(port, Buffer.concat([field('model', 'whisper-1'), filePart('audio', audio(3000, 0x41)), field('language', 'en'), END]));
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(JSON.parse(r.body), { text: 'hello from the fixture' });
    const rows = s.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bytes, 3000);
    assert.match(rows[0].url, /language=en/);
    assert.equal(rows[0].contentType, 'audio/webm');
  } finally {
    await s.stop();
  }
});

test('a form with several files: only the first reaches Deepgram, the others are skipped and not glued on', async () => {
  const port = 31950;
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const body = Buffer.concat([
      filePart('first', audio(2000, 0x41)), filePart('second', audio(2500, 0x42)), field('language', 'en'), filePart('third', audio(3000, 0x43)), END,
    ]);
    const r = await upload(port, body);
    assert.equal(r.status, 200, JSON.stringify(r));
    const rows = s.rows();
    assert.equal(rows.length, 1, 'one call to Deepgram');
    assert.equal(rows[0].bytes, 2000, 'with the first file only (it was 7,500 bytes, the three glued together)');
    assert.match(rows[0].url, /language=en/, 'a field after the first file is still read');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});

test('forty files of two megabytes each (80 MB in all) are answered, and only the first is sent on', async () => {
  const port = 31950;
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    const two = 2 * 1024 * 1024;
    const parts = [];
    for (let i = 0; i < 40; i++) parts.push(filePart('f' + i, audio(two, 0x41 + (i % 20))));
    const r = await upload(port, Buffer.concat([...parts, END]));
    assert.equal(r.status, 200, JSON.stringify(r).slice(0, 200));
    const rows = s.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bytes, two, 'two megabytes went to Deepgram, not eighty');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
