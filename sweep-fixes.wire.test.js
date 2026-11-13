'use strict';
// Nov 13 2026 (post-release sweep). Three things, through the real server with the network blocked by fixtures:
//   1.3  the phone's streamed first sentence has its own clocks: no audio by TTS_STREAM_PHONE_FIRST_MS -> the buffered ladder gets
//        the piece (a real retry, nothing was heard); audio that stops arriving for TTS_STREAM_PHONE_IDLE_MS -> the piece ends short
//        at once instead of holding the caller in silence for 20 s, and it ends as a BROKEN answer so the bridge records it as cut.
//   8.8  a recording Deepgram heard no words in answers { text: "", reason: "no_speech", message } (STT_EMPTY_REASON=0: the bare text).
//   8.6  the log holds the spoken reply's length and a hash, not its words (KADE_LOG_TEXT=1 puts them back).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port, extra = {}, fixtures = ['provider.cjs', 'provider-stream-paced.cjs']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-sweep-'));
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
    'TTS_STREAM', 'TTS_STREAM_TELEPHONY', 'TTS_PHONE_DECIMATOR', 'TTS_STREAM_PHONE_FIRST_MS', 'TTS_STREAM_PHONE_IDLE_MS', 'TTS_STREAM_PHONE_CUT_SIGNAL',
    'KADE_LOG_TEXT', 'STT_EMPTY_REASON', 'STT_NO_SPEECH_MESSAGE'].filter((k) => !(k in extra))) delete env[k];
  const args = [];
  for (const f of fixtures) args.push('--require', path.join(__dirname, 'test-fixtures', f));
  const child = spawn(process.execPath, [...args, 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
/* One spoken piece. Resolves however the answer ends: `cut` is true when the connection broke before the answer's end. */
function speak(port, input, { headers = {}, query = '?telephony=1' } = {}) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify({ input, voice: 'alloy' }), 'utf8');
    const t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port, path: `/v1/audio/speech${query}`, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-kade-caller': 'bridge-phone', ...headers } }, (res) => {
      const chunks = [];
      let settled = false;
      const done = (cut) => { if (settled) return; settled = true; resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks), ms: Date.now() - t0, cut }); };
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(!res.complete));
      res.on('aborted', () => done(true));
      res.on('error', () => done(true));
      res.on('close', () => done(!res.complete));
    });
    req.on('error', () => resolve({ status: 0, raw: Buffer.alloc(0), ms: Date.now() - t0, cut: true }));
    req.end(data);
  });
}
const STREAM = { 'x-kade-tts-stream': '1' };
async function logged(state, re) {
  for (let i = 0; i < 100 && !re.test(state.log); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(state.log, re);
}

test('1.3: a phone stream with no audio by the first-audio limit is dropped and the buffered ladder answers', async (t) => {
  const s = start(32061, { TTS_STREAM_PHONE_FIRST_MS: '700' });
  t.after(() => s.stop());
  assert.ok(await ready(32061, s.state), s.state.log.slice(-2000));
  const r = await speak(32061, 'This one is stallfirst on purpose.', { headers: STREAM });
  assert.equal(r.status, 200, s.state.log.slice(-800));
  assert.equal(r.cut, false);
  assert.equal(r.headers['x-kade-tts-streamed'], undefined, 'buffered, not streamed');
  assert.equal(r.headers['content-type'], 'audio/basic');
  assert.ok(r.raw.length > 1000, `the buffered audio came back (${r.raw.length} bytes)`);
  assert.ok(r.ms < 12000, `answered in ${r.ms} ms, not after the 20 s clock`);
  assert.match(s.state.log, /stream: (handshake failed|died before first audio) \(no audio in 700 ms\) -- falling back to buffered/);
});

test('1.3: a phone stream that goes quiet mid-sentence ends short after the idle limit, as a broken answer', async (t) => {
  const s = start(32062, { TTS_STREAM_PHONE_IDLE_MS: '800' });
  t.after(() => s.stop());
  assert.ok(await ready(32062, s.state), s.state.log.slice(-2000));
  const r = await speak(32062, 'This one is stallmid on purpose.', { headers: STREAM });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-kade-tts-streamed'], '1');
  assert.ok(r.raw.length > 0 && r.raw.length < 9600, `a short opener (${r.raw.length} bytes)`);
  assert.ok(r.ms < 6000, `ended in ${r.ms} ms, not after the 20 s clock`);
  assert.equal(r.cut, true, 'the answer ends broken, so the bridge can tell a cut from an ending');
  await logged(s.state, /stream: died mid-clip after \d+ bytes \(no audio for 800 ms\) -- ending short/);
  // The same death from the provider's side (a dropped stream) is signalled the same way.
  const d = await speak(32062, 'This one is dropmid on purpose.', { headers: STREAM });
  assert.equal(d.cut, true);
  assert.ok(d.raw.length > 0 && d.raw.length < 9600);
  // And a whole opener still ends cleanly.
  const whole = await speak(32062, 'Well hello there, it is good to hear you.', { headers: STREAM });
  assert.equal(whole.cut, false);
  assert.ok(Math.abs(whole.raw.length - 9600) <= 16, `1.2 s of 8 kHz mu-law (${whole.raw.length} bytes)`);
});

test('1.3: the switches. Both clocks at 0 wait as before; TTS_STREAM_PHONE_CUT_SIGNAL=0 ends a short opener cleanly; the web lane is untouched', async (t) => {
  const s = start(32063, { TTS_STREAM_PHONE_IDLE_MS: '0', TTS_STREAM_PHONE_FIRST_MS: '0', TTS_STREAM_PHONE_CUT_SIGNAL: '0' });
  t.after(() => s.stop());
  assert.ok(await ready(32063, s.state), s.state.log.slice(-2000));
  const waiting = await Promise.race([speak(32063, 'This one is stallmid on purpose.', { headers: STREAM }), new Promise((r) => setTimeout(() => r('still open'), 3500))]);
  assert.equal(waiting, 'still open', 'no idle clock: the 20 s limit alone, as before');
  const d = await speak(32063, 'This one is dropmid on purpose.', { headers: STREAM });
  assert.equal(d.cut, false, 'a clean end, as before');
  assert.ok(d.raw.length > 0 && d.raw.length < 9600);

  const web = start(32064, { TTS_STREAM_PHONE_IDLE_MS: '800' });
  t.after(() => web.stop());
  assert.ok(await ready(32064, web.state), web.state.log.slice(-2000));
  const w = await speak(32064, 'This one is dropmid on purpose.', { headers: STREAM, query: '' });
  assert.equal(w.cut, false, 'a web clip that dies mid-way still ends cleanly (a short WAV plays fine)');
  assert.equal(w.headers['x-kade-tts-streamed'], '1');
});

test('8.6: the log carries the reply\'s length and a hash, not its words; KADE_LOG_TEXT=1 puts the words back', async (t) => {
  const SAID = 'My sister Marguerite crashed her motorcycle near Branson last spring.';
  const s = start(32065);
  t.after(() => s.stop());
  assert.ok(await ready(32065, s.state), s.state.log.slice(-2000));
  assert.equal((await speak(32065, SAID, { query: '' })).status, 200);
  await logged(s.state, /\[TTS\] input len=\d+, after strip len=\d+, first 200: \(\d+ chars, sha [0-9a-f]{8}\)/);
  for (const w of ['Marguerite', 'motorcycle', 'Branson']) assert.equal(s.state.log.includes(w), false, `the log quotes the reply ("${w}")`);

  const loud = start(32066, { KADE_LOG_TEXT: '1' });
  t.after(() => loud.stop());
  assert.ok(await ready(32066, loud.state), loud.state.log.slice(-2000));
  assert.equal((await speak(32066, SAID, { query: '' })).status, 200);
  await logged(loud.state, /first 200: "[^"]*Marguerite/);
});

function upload(port, transcriptBody) {
  return new Promise((resolve) => {
    const data = Buffer.from(transcriptBody, 'latin1');
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent: false,
      headers: { 'Content-Type': 'multipart/form-data; boundary=zzz', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', (e) => resolve({ reset: e.code || e.message }));
    req.end(data);
  });
}
const FORM = '--zzz\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n' + 'A'.repeat(2000) + '\r\n--zzz--\r\n';

test('8.8: a recording with no words in it answers an empty text, a reason and a plain sentence; real words are untouched', async (t) => {
  const quiet = start(32067, { FIXTURE_TRANSCRIPT: '   ' }, ['deepgram.cjs']);
  t.after(() => quiet.stop());
  assert.ok(await ready(32067, quiet.state), quiet.state.log.slice(-2000));
  const r = await upload(32067, FORM);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { text: '', reason: 'no_speech', message: "I didn't catch that. Please try again." });
  assert.match(quiet.state.log, /\[stt\] empty transcript: 2000 bytes/);
  // No file at all is not "no speech": that answer is what it was.
  assert.equal((await upload(32067, '--zzz--\r\n')).body, '{"text":""}');

  const heard = start(32068, {}, ['deepgram.cjs']);
  t.after(() => heard.stop());
  assert.ok(await ready(32068, heard.state), heard.state.log.slice(-2000));
  assert.equal((await upload(32068, FORM)).body, '{"text":"hello from the fixture"}');

  const old = start(32069, { FIXTURE_TRANSCRIPT: '   ', STT_EMPTY_REASON: '0' }, ['deepgram.cjs']);
  t.after(() => old.stop());
  assert.ok(await ready(32069, old.state), old.state.log.slice(-2000));
  assert.equal((await upload(32069, FORM)).body, '{"text":""}', 'STT_EMPTY_REASON=0: the bare answer, as before');
});
