'use strict';
// Nov 8 2026. The voice label of a speech request is the caller's own text, and the speech route printed it raw in its log lines
// (`[TTS] voice request: label="..." -> resolved="..."` and the like, and `resolved` is the label itself when it is no known voice): a line
// break in it forged log lines of the service's own (`[proxy] POST /librechat/janitor failed with 500: ...`, `[speech-gate] mode=off`), found by
// the review of Nov 8 2026 (reviewer B, invariant 5). A label with a control or invisible character in it is no label (it failed at the
// provider before, as an unknown voice id): the route answers 400 before anything is logged or sent. A long label is cut in the log lines
// (describeCause), and a normal label is printed exactly as before. Through the real HTTP handler, the provider fixture instead of the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 31924;

function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-voice-label-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(PORT), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0' };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).length;
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { state, rows, stop };
}

async function ready(state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// the log reaches this process through a pipe, a moment after the answer does: wait for a line instead of reading the log at once
async function logHas(state, re, ms = 3000) {
  for (let i = 0; i < ms / 50 && !re.test(state.log); i++) await new Promise((r) => setTimeout(r, 50));
  return re.test(state.log);
}

function speak(body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/v1/audio/speech', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks).length, text: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('error', (e) => resolve({ reset: e.code || e.message }));
    req.end(data);
  });
}

test('a label with a line break (or any control or invisible character) is a 400 before anything is logged or sent; a long one is cut in the log; a normal one reads as before', async () => {
  const s = start();
  try {
    assert.ok(await ready(s.state), s.state.log);
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const hostile = `Voice 5${LF}[proxy] POST /librechat/janitor failed with 500: forged${CR}${LF}[speech-gate] mode=off`;
    const before = s.rows();
    for (const voice of [hostile, `alloy${LF}`, `al${String.fromCharCode(0)}loy`, `al${String.fromCharCode(0x1b)}[31mloy`, `al${String.fromCharCode(0x2028)}loy`, `al${String.fromCharCode(0x200b)}loy`, `al${String.fromCharCode(9)}loy`]) {
      for (const stream of [false, true]) {
        const r = await speak({ input: 'Hello there, friend.', voice, ...(stream ? { stream: true } : {}) });
        assert.equal(r.status, 400, JSON.stringify(voice) + ' ' + JSON.stringify(r).slice(0, 200));
        assert.equal(r.text, '{"error":"Invalid field: voice must be a plain label"}');
      }
    }
    assert.equal(s.rows(), before, 'no provider was asked');
    assert.doesNotMatch(s.state.log, /^\[proxy\] POST \/librechat\/janitor/m, 'no log line begins with the forged text');
    assert.doesNotMatch(s.state.log, /^\[speech-gate\] mode=off/m);
    assert.doesNotMatch(s.state.log, /forged/, 'and the text is not in the log at all');

    const long = 'v'.repeat(500);
    for (const body of [
      { input: 'Hello there, friend.', voice: 'alloy' },
      { input: 'Just a short streamed check, nothing more.', voice: 'alloy', stream: true },
      { input: 'Hello there, friend.', voice: long },
      { input: 'Just a short streamed check, nothing more.', voice: long, stream: true },
    ]) {
      const r = await speak(body);
      assert.equal(r.status, 200, JSON.stringify(r).slice(0, 200));
      assert.ok(r.bytes > 44);
    }
    assert.ok(await logHas(s.state, new RegExp(`\\[TTS\\] stream out: label="v{300}\\.\\.\\." resolved=`)), 'the streamed lane\'s line for the long label arrives');
    assert.match(s.state.log, /\[TTS\] voice request: label="alloy" -> resolved=/, 'a normal label reads as before');
    assert.match(s.state.log, /\[TTS\] voice response: label="alloy" resolved=/);
    assert.match(s.state.log, /\[TTS\] stream out: label="alloy" resolved=/);
    assert.match(s.state.log, new RegExp(`\\[TTS\\] voice request: label="v{300}\\.\\.\\." -> resolved=`), 'a long label is cut at 300 characters in the log');
    assert.match(s.state.log, new RegExp(`\\[TTS\\] stream out: label="v{300}\\.\\.\\." resolved=`), 'in the streamed lane too');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
