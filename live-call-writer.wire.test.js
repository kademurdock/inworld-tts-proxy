'use strict';
// Nov 12 2026 (gateway audit GW-4). A live call (the phone, or an app or web call: any bridge- caller) never waits on the MiMo
// Inworld writer or the Fish director before its first word; chat speech still gets them. INWORLD_WRITER_LIVE=1 and
// FISH_DIRECTOR_LIVE=1 put them back on calls. The fixture blocks the network, so a writer or director that runs logs
// "kept plain"; one that never runs logs nothing. Real server, nothing is paid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 200 characters, no double quotes and no list markers: long enough for both (140-character minimum).
const LONG = 'I went down to the farmers market this morning before it got too hot, and the peach man had saved me a whole box of the good ones, so I spent the afternoon making jam with my sister in the kitchen.';
const CLEAR = ['INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE',
  'INWORLD_WRITER_LIVE', 'FISH_DIRECTOR_LIVE', 'INWORLD_WRITER_MIN_CHARS', 'FISH_DIRECTOR_MIN_CHARS'];

async function withServer(port, extraEnv, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-live-writer-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', OPENROUTER_KEY: 'offline',
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789', LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', VOICE_AUTO_MOVE: '0', INWORLD_WRITER: '1', FISH_DIRECTOR: '1',
  };
  for (const k of CLEAR) delete env[k];
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  try {
    let ready = false;
    for (let i = 0; i < 600 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    // The log lines one request wrote.
    const say = async (voice, headers = {}, query = '') => {
      const before = log.length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input: LONG, voice }) });
      assert.equal(r.status, 200, log.slice(-1500));
      const raw = Buffer.from(await r.arrayBuffer());
      assert.ok(raw.length > 44, 'audio came back');
      await new Promise((res) => setTimeout(res, 50));
      return { raw, log: log.slice(before) };
    };
    return await run({ say, health: async () => (await fetch(`http://127.0.0.1:${port}/health`)).json() });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const WEB = { 'x-kade-caller': 'bridge-voice' };
const PHONE = { 'x-kade-caller': 'bridge-phone' };
const CHAT = { 'x-kade-caller': 'fork-tts' };

test('live calls skip the writer and the director; chat speech still gets them', async () => {
  await withServer(32061, {}, async ({ say, health }) => {
    // Bridge cases first: three writer failures in a row would pause it.
    const web = await say('alloy', WEB);
    assert.equal(web.raw.toString('latin1', 0, 4), 'RIFF');
    assert.doesNotMatch(web.log, /\[TTS\] inworld writer:/);
    assert.doesNotMatch((await say('alloy', PHONE, '?telephony=1')).log, /\[TTS\] inworld writer:/);
    assert.doesNotMatch((await say('fish:fixture', WEB)).log, /\[TTS\] director:/);
    assert.doesNotMatch((await say('fish:fixture', PHONE, '?telephony=1')).log, /\[TTS\] director:/);
    assert.match((await say('alloy')).log, /\[TTS\] inworld writer: kept plain/);
    assert.match((await say('fish:fixture', CHAT)).log, /\[TTS\] director: kept plain/);
    const h = await health();
    assert.equal(h.inworldWriter.live, false);
    assert.equal(h.fishDirector.live, false);
  });
});

test('INWORLD_WRITER_LIVE=1 and FISH_DIRECTOR_LIVE=1 put them back on calls', async () => {
  await withServer(32062, { INWORLD_WRITER_LIVE: '1', FISH_DIRECTOR_LIVE: '1' }, async ({ say, health }) => {
    assert.match((await say('alloy', WEB)).log, /\[TTS\] inworld writer: kept plain/);
    assert.match((await say('fish:fixture', WEB)).log, /\[TTS\] director: kept plain/);
    const h = await health();
    assert.equal(h.inworldWriter.live, true);
    assert.equal(h.fishDirector.live, true);
  });
});
