'use strict';
// Nov 11 2026: the face track through the real HTTP handler, against a fake Inworld that answers like
// the recorded one (test-fixtures/provider-timing.cjs). Asked for, the WAV carries a `kdtm` chunk that
// lines up with the PCM; not asked for, or switched off, the bytes are exactly the old ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readTrack } = require('./timing-track');

const GARDEN = 'Well, I finally got the garden planted this morning, and honestly the tomatoes look happier than I do.';
const BOOT_WAIT_TICKS = 300; // x100 ms: the server takes ~10 s to boot from a USB drive

async function withServer(port, extraEnv, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-timing-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, ...extraEnv };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'INWORLD_PAUSE_CAP', 'TTS_TALK_CALM', 'INWORLD_TIMINGS', 'INWORLD_TIMINGS_WORDS', 'TIMING_FIXTURE', 'TTS_MAX_CHUNK_LEN', 'SPEECH_GATE', 'KADE_SPEECH_SECRET']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider-timing.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  try {
    let ready = false;
    for (let i = 0; i < BOOT_WAIT_TICKS && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    const say = async (body, { headers = {}, query = '' } = {}) => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input: GARDEN, voice: 'alloy', ...body }) });
      assert.equal(r.status, 200, log.slice(-2000));
      const bytes = Buffer.from(await r.arrayBuffer());
      return { bytes, sha: crypto.createHash('sha256').update(bytes).digest('hex'), type: r.headers.get('content-type'), timing: r.headers.get('x-kade-tts-timing'), streamed: r.headers.get('x-kade-tts-streamed') === '1' };
    };
    const requests = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return await run({ say, requests, health: async () => (await fetch(`http://127.0.0.1:${port}/health`)).json(), log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

const ASK = { headers: { 'x-kade-tts-timing': '1' } };
const pcmMs = (wav) => {
  // walk to the data chunk the way the bridge's wavDurationMs does
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString('ascii', at, at + 4), size = wav.readUInt32LE(at + 4);
    if (id === 'data') return size / 48;
    at += 8 + size + (size % 2);
  }
  return NaN;
};

test('asked: lip-sync and WORD go to Inworld, and the WAV carries a track that matches its PCM', async () => {
  await withServer(32101, {}, async ({ say, requests, health, log }) => {
    const plain = await say({});
    assert.equal(plain.timing, null);
    assert.equal(plain.bytes.toString('ascii', 36, 40), 'data', 'no ask: the 44-byte header of old');
    const asked = await say({}, ASK);
    const [first, second] = requests();
    assert.equal('lipsyncConfig' in first.body, false);
    assert.equal('timestampType' in first.body, false);
    assert.deepEqual(second.body.lipsyncConfig, {});
    assert.equal(second.body.timestampType, 'WORD');
    assert.equal(asked.timing, '1');
    assert.equal(asked.bytes.toString('ascii', 36, 40), 'kdtm');
    const track = readTrack(asked.bytes);
    assert.equal(track.v, 1);
    assert.equal(track.set, 'oxr');
    assert.equal(track.dur, Math.round(pcmMs(asked.bytes)));
    assert.ok(Math.abs(track.vis.at(-1)[1] - track.dur) <= 10, `last shape ends ${track.vis.at(-1)[1]}, audio ${track.dur}`);
    assert.deepEqual(track.cov, [[0, track.dur]]);
    assert.deepEqual(track.w.slice(0, 3).map((w) => w[2]), ['Well', 'I', 'finally']);
    // the audio itself is the same audio, only the carrier differs
    assert.ok(asked.bytes.subarray(asked.bytes.length - (plain.bytes.length - 44)).equals(plain.bytes.subarray(44)));
    const h = await health();
    assert.equal(h.inworldTimings.on, true);
    assert.equal(h.inworldTimings.tracks, 1);
    assert.match(log(), /timing=on\)/);
    assert.match(log(), /timing=off\)/);
  });
});

test('switched off, or not asked, or the phone, or Fish, or the stream lane: today\'s bytes, nothing new asked', async () => {
  let plainSha;
  await withServer(32102, { INWORLD_TIMINGS: '0' }, async ({ say, requests, health }) => {
    const plain = await say({});
    const askedButOff = await say({}, ASK);
    const askedInBody = await say({ timing: true });
    plainSha = plain.sha;
    assert.equal(askedButOff.sha, plain.sha);
    assert.equal(askedInBody.sha, plain.sha);
    assert.equal(askedButOff.timing, null);
    for (const r of requests()) {
      assert.equal('lipsyncConfig' in r.body, false);
      assert.equal('timestampType' in r.body, false);
    }
    assert.equal((await health()).inworldTimings.on, false);
  });
  await withServer(32103, {}, async ({ say, requests }) => {
    assert.equal((await say({})).sha, plainSha, 'the feature on but not asked: byte for byte the same');
    const phone = await say({}, { ...ASK, query: '?telephony=1' });
    assert.equal(phone.type, 'audio/basic');
    assert.equal(phone.timing, null);
    const fish = await say({ voice: 'fish:fixture' }, ASK);
    assert.equal(fish.timing, null);
    assert.equal(fish.bytes.toString('ascii', 36, 40), 'data');
    const streamed = await say({ stream: true }, ASK);
    assert.equal(streamed.streamed, true);
    assert.equal(streamed.timing, null);
    for (const r of requests()) {
      assert.equal('lipsyncConfig' in r.body, false, r.url);
      assert.equal('timestampType' in r.body, false, r.url);
    }
  });
});

test('words off: lip-sync only, a track with no words', async () => {
  await withServer(32104, { INWORLD_TIMINGS_WORDS: '0' }, async ({ say, requests }) => {
    const asked = await say({}, ASK);
    const [r] = requests();
    assert.deepEqual(r.body.lipsyncConfig, {});
    assert.equal('timestampType' in r.body, false);
    const track = readTrack(asked.bytes);
    assert.equal(track.w, undefined);
    assert.ok(track.vis.length > 20);
  });
});

test('two chunks with the pause limiter on: the track follows the cut silences and the seam', async () => {
  const input = 'Hello there, this is the first part of it.\n\nAnd here is the second part now.';
  await withServer(32105, { TIMING_FIXTURE: 'pauses', INWORLD_PAUSE_CAP: '1', TTS_MAX_CHUNK_LEN: '50' }, async ({ say, requests }) => {
    const asked = await say({ input }, ASK);
    assert.equal(requests().length, 2);
    const track = readTrack(asked.bytes);
    const ms = pcmMs(asked.bytes);
    // each chunk: 300 speech + the 1 s stop brought to 500 + 300 speech, then a 340 ms seam
    assert.ok(Math.abs(ms - 2540) <= 12, 'pcm ' + ms);
    assert.ok(Math.abs(track.vis.at(-1)[1] - ms) <= 10, `last span ${track.vis.at(-1)[1]} vs ${ms}`);
    assert.deepEqual(track.cov, [[0, track.dur]], 'the seam between two covered chunks is covered');
    const there = track.w.filter((w) => w[2] === 'there');
    assert.equal(there.length, 2);
    assert.ok(Math.abs(there[0][0] - 800) <= 10, 'first "there" after the cut stop: ' + there[0][0]);
    assert.ok(Math.abs(there[1][0] - (1100 + 340 + 800)) <= 12, 'second "there" after the seam: ' + there[1][0]);
  });
});

test('a chunk Inworld answered without lip-sync is a gap in cov and counts as missing', async () => {
  const input = 'Hello there, this is the first part of it.\n\nAnd nolip is the second part now.';
  await withServer(32106, { TIMING_FIXTURE: 'pauses', TTS_MAX_CHUNK_LEN: '50' }, async ({ say, health }) => {
    const asked = await say({ input }, ASK);
    const track = readTrack(asked.bytes);
    assert.equal(track.cov.length, 1);
    assert.ok(track.cov[0][1] < track.dur - 1000, 'only the first chunk is covered: ' + JSON.stringify(track.cov));
    const h = await health();
    assert.equal(h.inworldTimings.asked, 2);
    assert.equal(h.inworldTimings.missing, 1);
  });
});

test('Inworld refusing a chunk for the timing fields still gives the audio, without a track', async () => {
  const input = 'Well, refusetiming is just a word in this sentence for the fake Inworld.';
  await withServer(32107, {}, async ({ say, requests, log }) => {
    const plain = await say({ input });
    const asked = await say({ input }, ASK);
    const [, refused, again] = requests();
    assert.deepEqual(refused.body.lipsyncConfig, {});
    assert.equal('lipsyncConfig' in again.body, false);
    assert.equal('timestampType' in again.body, false);
    assert.equal(requests().length, 3, 'one ask without timings, no ladder of retries');
    assert.equal(asked.sha, plain.sha, 'the same audio as an unasked request');
    assert.notEqual(asked.timing, '1');
    assert.ok(log().includes('refused with timings (400)'), 'the log says why the track is missing');
  });
});
