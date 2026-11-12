'use strict';
// Nov 12 2026: chat speech talks instead of performing (inworld-talk.js), through the real HTTP handler, buffered and
// streamed: the exact request Inworld gets with the frame off and on, the speed, reading left alone, and that a refusal
// still speaks the words (asked once more exactly as before, the face track kept, the breaker counting).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DEFAULT_FRAME: F } = require('./inworld-talk');
const { WORDS, PHRASES } = require('./inworld-steer');

const BODY = 'I went to the farmers market this morning before it got too hot outside. They had the best peaches I have seen all summer long.';
const CLEAR = ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'INWORLD_STEER_RATE', 'TTS_TALK_CALM', 'KADE_TTS_LIVELY_BASELINE',
  'INWORLD_TALK_RATE', 'INWORLD_STEER_DROP_ABOVE', 'INWORLD_TALK_DELIVERY', 'INWORLD_TALK_FRAME', 'INWORLD_TALK_FRAME_MERGE', 'INWORLD_TALK_LIFT',
  'KADE_TTS_INSTRUCTION_FIELD', 'TTS_DELIVERY_MODE', 'TTS_ENHANCE', 'INWORLD_TIMINGS', 'TALK_REJECT', 'TTS_STEER_CARRY'];

async function withServer(port, extraEnv, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-talk-delivery-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  for (const k of CLEAR) delete env[k];
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider-talk.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    // every Inworld request one speech call made, as sent
    const calls = async (input, body = {}, headers = {}) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input, voice: 'alloy', ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      assert.ok((await r.arrayBuffer()).byteLength > 44, 'audio came back');
      return rows().slice(before);
    };
    return await run({ calls, health: async () => (await fetch(`http://127.0.0.1:${port}/health`)).json(), log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

const PROD = { INWORLD_STEER_RATE: '1', INWORLD_STEER_DROP_ABOVE: '1.4', TTS_TALK_CALM: '1', TTS_DELIVERY_MODE: 'CREATIVE' };
// A request with the switch off: the shapes these tests compare the frame against.
const CASES = [
  `%%%amused%%% ${BODY}`,
  BODY,
  `%%%dry%%% First paragraph about the market.\n\n%%%reset%%% And then I went home and had a nap.`,
  `Okay. %%%sharp and interested%%% ${BODY}`,
  `%%%straightforward and honest%%% ${BODY}`,
];

test('off: every request is exactly what it always was (body, keys, rate), buffered and streamed', async () => {
  let offBodies;
  await withServer(32400, PROD, async ({ calls, health }) => {
    offBodies = [];
    for (const stream of [false, true]) for (const input of CASES) offBodies.push((await calls(input, { stream })).map((c) => c.body));
    const [amused] = offBodies[0];
    assert.deepEqual(Object.keys(amused).sort(), ['audioConfig', 'deliveryMode', 'instruction', 'modelId', 'text', 'voiceId']);
    assert.equal(amused.instruction, 'amused');
    assert.equal(amused.audioConfig.speakingRate, WORDS.amused);
    assert.equal((await health()).inworldTalk.delivery.mode, 'off');
  });
  // the same server with the delivery switch present but not 'frame' sends byte-identical bodies
  await withServer(32401, { ...PROD, INWORLD_TALK_DELIVERY: 'reason', INWORLD_TALK_FRAME: 'anything' }, async ({ calls, log }) => {
    const again = [];
    for (const stream of [false, true]) for (const input of CASES) again.push((await calls(input, { stream })).map((c) => c.body));
    assert.deepEqual(again, offBodies);
    assert.doesNotMatch(log(), /\[TTS\] talk:/);
  });
});

test('frame: the direction leads the frame, alone without one, at the speed the words as written earned', async () => {
  let off = {};
  await withServer(32402, PROD, async ({ calls }) => {
    for (const input of CASES) off[input] = (await calls(input)).map((c) => c.body);
  });
  await withServer(32403, { ...PROD, INWORLD_TALK_DELIVERY: 'frame' }, async ({ calls, log, health }) => {
    for (const stream of [false, true]) {
      const [a] = await calls(`%%%amused%%% ${BODY}`, { stream });
      assert.equal(a.body.instruction, `amused, ${F}`);
      assert.equal(a.body.audioConfig.speakingRate, WORDS.amused, 'the frame itself costs no speed');
      const [b] = await calls(BODY, { stream });
      assert.equal(b.body.instruction, F);
      assert.equal(b.body.audioConfig.speakingRate, 1);
      const [c] = await calls(BODY, { stream, speed: 1.2 });
      assert.equal(c.body.audioConfig.speakingRate, 1.2, 'the listener\'s own speed stays theirs');
    }
    // every case keeps the speed it had with the frame off, inline tags and resets included
    for (const input of CASES) {
      const on = (await calls(input)).map((c) => c.body);
      assert.deepEqual(on.map((x) => x.audioConfig.speakingRate), off[input].map((x) => x.audioConfig.speakingRate), input);
      // only the instruction and an opening [reset] differ
      on.forEach((x, i) => {
        const was = off[input][i];
        assert.equal(x.text, was.text.replace(/^\s*\[reset\][ \t]*/i, ''), input);
        assert.deepEqual({ ...x, instruction: null, text: null }, { ...was, instruction: null, text: null }, input);
      });
    }
    assert.ok(PHRASES['sharp and interested'] && PHRASES['straightforward and honest'], 'the phrases the cases rely on are measured');
    // reading is never framed: STABLE
    const [r] = await calls(`%%%amused%%% ${BODY}`, { delivery: 'STABLE' });
    assert.equal(r.body.instruction, 'amused');
    assert.match(log(), /\[TTS\] talk: instruction "amused, talking with a close friend/);
    const h = (await health()).inworldTalk.delivery;
    assert.deepEqual([h.mode, h.frame, h.frameMerge], ['frame', F, 'merge']);
    assert.ok(h.shaped > 0);
  });
});

test('frame first or instead of the direction: no lift for a direction that no longer leads', async () => {
  for (const [port, merge, want] of [[32404, 'after', `${F}, amused`], [32405, 'replace', F]]) {
    await withServer(port, { ...PROD, INWORLD_TALK_DELIVERY: 'frame', INWORLD_TALK_FRAME_MERGE: merge, INWORLD_TALK_LIFT: '1.04' }, async ({ calls }) => {
      for (const stream of [false, true]) {
        const [a] = await calls(`%%%amused%%% ${BODY}`, { stream });
        assert.equal(a.body.instruction, want);
        assert.equal(a.body.audioConfig.speakingRate, 1.04, 'only the frame\'s own lift');
      }
    });
  }
});

test('Balanced: the lively brief is never stacked under the frame; with the field switched off there is no frame', async () => {
  await withServer(32406, { ...PROD, INWORLD_TALK_DELIVERY: 'frame' }, async ({ calls }) => {
    const [a] = await calls(BODY, { delivery: 'BALANCED' });
    assert.equal(a.body.instruction, F);
  });
  await withServer(32407, { ...PROD, INWORLD_TALK_DELIVERY: 'frame', KADE_TTS_INSTRUCTION_FIELD: '0' }, async ({ calls, health }) => {
    const [a] = await calls(`%%%amused%%% ${BODY}`);
    assert.equal(a.body.instruction, undefined);
    assert.match(a.body.text, /^\[amused\] /);
    assert.equal((await health()).inworldTalk.delivery.mode, 'off');
  });
});

test('a refused frame is asked again exactly as before, the face track kept; streamed falls back; the breaker counts', async () => {
  await withServer(32408, { ...PROD, INWORLD_TALK_DELIVERY: 'frame', TALK_REJECT: '1' }, async ({ calls, log, health }) => {
    let off;
    // what the plain retry must equal: the same request with the frame off
    await withServer(32409, PROD, async (o) => { off = (await o.calls(`%%%amused%%% ${BODY}`, {}, { 'x-kade-tts-timing': '1' })).map((c) => c.body); });
    const buffered = await calls(`%%%amused%%% ${BODY}`, {}, { 'x-kade-tts-timing': '1' });
    assert.equal(buffered.length, 2, 'refused once, then asked plain');
    assert.deepEqual(buffered[1].body, off[0], 'the plain retry is the old request, timing fields and all');
    assert.ok(buffered[1].body.lipsyncConfig, 'the face track was not given up for the frame\'s refusal');
    const streamed = await calls(`%%%amused%%% ${BODY}`, { stream: true });
    assert.ok(streamed[0].url.endsWith(':stream'));
    assert.equal(streamed.at(-1).body.instruction, 'amused', 'the stream falls back to the buffered lane, which asks plain');
    assert.match(log(), /refused with the talk frame \(Inworld API error 400: .*test refusal/);
    const h = (await health()).inworldTalk.delivery;
    assert.ok(h.refused >= 3, JSON.stringify(h));
    // enough refusals turn the frame off for a while: the next piece goes plain at once
    for (let i = 0; i < 3; i++) await calls(BODY);
    const after = await calls(`%%%amused%%% ${BODY}`);
    assert.equal(after.length, 1);
    assert.equal(after[0].body.instruction, 'amused');
    const h2 = (await health()).inworldTalk.delivery;
    assert.deepEqual([h2.mode, h2.asked], ['off', 'frame']);
    assert.ok(h2.offForMinutes > 0);
    assert.match(log(), /frame off for 30 min after repeated refusals/);
  });
});

test('an unrelated 400 with the frame on still fails as before, after one plain try, and says why', async () => {
  await withServer(32410, { ...PROD, INWORLD_TALK_DELIVERY: 'frame', TALK_REJECT: 'all' }, async ({ log }) => {
    const r = await fetch('http://127.0.0.1:32410/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: BODY, voice: 'alloy' }) });
    assert.notEqual(r.status, 200);
    await r.arrayBuffer();
    assert.match(log(), /refused with the talk frame \(Inworld API error 400: .*test refusal/);
    assert.doesNotMatch(log(), /talkFramed: false/);
  });
});
