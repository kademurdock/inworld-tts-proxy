'use strict';
// Nov 5 2026: tempo-neutral steering through the real HTTP handler, buffered and streamed. What the server
// sends Inworld as audioConfig.speakingRate is the listener's rate times the direction's measured cost.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BODY = 'I went to the farmers market this morning before it got too hot outside. They had the best peaches I have seen all summer long.';

async function withServer(port, extraEnv, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-steer-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, ...extraEnv };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'INWORLD_STEER_RATE', 'TTS_TALK_CALM', 'KADE_TTS_LIVELY_BASELINE', 'INWORLD_TALK_RATE', 'INWORLD_STEER_DROP_ABOVE']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  try {
    let ready = false;
    for (let i = 0; i < 160 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    // the speaking rate Inworld was asked for
    const rate = async (input, body = {}) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, voice: 'alloy', ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
      const calls = rows().slice(before);
      assert.equal(calls.length, 1);
      return calls[0].body.audioConfig.speakingRate;
    };
    // the rate and the instruction Inworld was sent
    const sent = async (input, body = {}) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, voice: 'alloy', ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
      const calls = rows().slice(before);
      assert.equal(calls.length, 1);
      return { rate: calls[0].body.audioConfig.speakingRate, instruction: calls[0].body.instruction || null };
    };
    return await run({ rate, sent, health: async () => (await fetch(`http://127.0.0.1:${port}/health`)).json(), log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

test('off, the rate is the listener\'s, steered or not', async () => {
  await withServer(31954, {}, async ({ rate, health }) => {
    assert.equal(await rate(`%%%hesitant%%% ${BODY}`), 1);
    assert.equal(await rate(`%%%hesitant%%% ${BODY}`, { speed: 1.2, stream: true }), 1.2);
    assert.equal((await health()).inworldSteer.on, false);
  });
});

test('the costliest moods are spoken without the direction, at the voice\'s own pace; cheap ones keep theirs with the lift', async () => {
  await withServer(31957, { INWORLD_STEER_RATE: '1', INWORLD_STEER_DROP_ABOVE: '1.4' }, async ({ sent, health, log }) => {
    const { WORDS } = require('./inworld-steer');
    for (const stream of [false, true]) {
      assert.deepEqual(await sent(`%%%hesitant%%% ${BODY}`, { stream }), { rate: 1, instruction: null }, 'dropped: the voice\'s own pace, no instruction');
      assert.deepEqual(await sent(`%%%uneasy%%% ${BODY}`, { stream, speed: 1.1 }), { rate: 1.1, instruction: null }, 'the listener\'s speed stays theirs');
      assert.deepEqual(await sent(`%%%amused%%% ${BODY}`, { stream }), { rate: WORDS.amused, instruction: 'amused' }, 'cheap: kept, with the lift');
      assert.deepEqual(await sent(`%%%thoughtful%%% ${BODY}`, { stream }), { rate: WORDS.thoughtful, instruction: 'thoughtful' });
    }
    // reading keeps its direction whatever it costs
    assert.deepEqual(await sent(`%%%hesitant%%% ${BODY}`, { delivery: 'STABLE' }), { rate: 1, instruction: 'hesitant' });
    assert.match(log(), /\[TTS\] steering: dropped the direction "hesitant"/);
    assert.match(log(), /dropped the direction "hesitant".*streamed/);
    assert.equal((await health()).inworldSteer.dropAbove, 1.4);
  });
});

test('INWORLD_TALK_RATE slows every chat piece evenly, steered or not, and reading never', async () => {
  await withServer(31956, { INWORLD_STEER_RATE: '1', INWORLD_TALK_RATE: '0.9' }, async ({ rate, health }) => {
    const { WORDS } = require('./inworld-steer');
    for (const stream of [false, true]) {
      assert.equal(await rate(BODY, { stream }), 0.9);
      assert.equal(await rate(`%%%amused%%% ${BODY}`, { stream }), Math.round(0.9 * WORDS.amused * 1000) / 1000);
      assert.equal(await rate(BODY, { stream, speed: 1.2 }), 1.08);
    }
    assert.equal(await rate(BODY, { delivery: 'STABLE' }), 1, 'reading is the listener\'s rate');
    assert.equal((await health()).inworldSteer.talkRate, 0.9);
  });
});

test('on, a steered chat piece is sent at the listener\'s rate times what its word costs, buffered and streamed', async () => {
  await withServer(31955, { INWORLD_STEER_RATE: '1' }, async ({ rate, health, log }) => {
    const { WORDS } = require('./inworld-steer');
    for (const stream of [false, true]) {
      assert.equal(await rate(`%%%hesitant%%% ${BODY}`, { stream }), 1.25, 'costly word: the cap');
      assert.equal(await rate(`%%%amused%%% ${BODY}`, { stream }), WORDS.amused, 'cheap word: a little');
      assert.equal(await rate(`%%%encouraging%%% ${BODY}`, { stream }), WORDS.encouraging);
      assert.equal(await rate(BODY, { stream }), 1, 'no direction: the listener\'s rate');
      assert.equal(await rate(`%%%amused%%% ${BODY}`, { stream, speed: 1.1 }), Math.round(1.1 * WORDS.amused * 1000) / 1000, 'the listener\'s speed is multiplied');
      assert.equal(await rate(`%%%hesitant%%% ${BODY}`, { stream, speed: 1.4 }), 1.5, 'Inworld\'s limit');
    }
    // reading is never steered: STABLE and a Library reading session
    assert.equal(await rate(`%%%hesitant%%% ${BODY}`, { delivery: 'STABLE' }), 1);
    assert.equal(await rate(`%%%hesitant%%% ${BODY}`, { delivery: 'BALANCED', stream: true }), 1.25);
    assert.match(log(), /\[TTS\] steering: speakingRate 1 -> 1\.25\r?\n/);
    assert.match(log(), /\[TTS\] steering: speakingRate 1 -> 1\.25, streamed/);
    const h = await health();
    assert.deepEqual([h.inworldSteer.on, h.inworldSteer.maxBoost, h.inworldSteer.fallback], [true, 1.25, 1.12]);
  });
});
