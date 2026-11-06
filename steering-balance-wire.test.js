'use strict';
// Nov 6 2026: Kiana's last message to Kade had "%%%\n%%%warm and curious%%%" and the voice said "warm and
// curious" aloud. Through the real HTTP handler, Inworld (buffered and streamed) and Fish, the words of a
// direction must reach the provider only as a direction, however a stray %%% line sits in front of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INCIDENT = "%%%to correct with respect%%%\nYeah, you're right, that's on me. The paper trail for that house is thin.\n\n%%%\n%%%warm and curious%%% So what's the shape of it? How far back have you gotten on your mama's side?";
const OTHERS = [
  ['stray after the tag', "%%%warm and curious%%% So what now?\n%%%\nAnd then more words after it."],
  ['two strays', "Before the tag.\n%%%\n%%%\n%%%warm and curious%%% So what now? And a little more."],
  ['glued closer and opener', "%%%to correct with respect%%%%%%warm and curious%%% So what now? And a little more."],
  ['closer forgotten on its own line', "Before the tag.\n%%%warm and curious\nSo what now? And a little more."],
];

async function withServer(port, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-balance-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
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
    // what the provider was handed for one message: every request's text and instruction
    const handed = async (input, body) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
      return rows().slice(before).map((x) => ({ text: x.body.text, instruction: x.body.instruction || null }));
    };
    return await run({ handed, log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

const speechOf = (reqs) => reqs.map((q) => q.text).join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ');

test('Inworld: the incident reaches the provider as two directions and clean speech, buffered and streamed', async () => {
  await withServer(31958, async ({ handed }) => {
    for (const stream of [false, true]) {
      const reqs = await handed(INCIDENT, { voice: 'alloy', stream });
      const instructions = reqs.map((q) => q.instruction);
      assert.deepEqual(instructions, ['to correct with respect', 'warm and curious'], 'stream=' + stream + ' ' + JSON.stringify(reqs));
      assert.doesNotMatch(speechOf(reqs), /warm and curious/, 'the direction is not spoken: ' + JSON.stringify(reqs));
      assert.doesNotMatch(reqs.map((q) => q.text).join(' '), /%/);
      assert.match(speechOf(reqs), /So what's the shape of it\? How far back have you gotten on your mama's side\?/);
    }
  });
});

test('Inworld: strays and a forgotten closer, in other shapes, never leave direction words in the speech', async () => {
  await withServer(31959, async ({ handed }) => {
    for (const [name, input] of OTHERS) {
      const reqs = await handed(input, { voice: 'alloy' });
      assert.doesNotMatch(speechOf(reqs), /warm and curious|to correct with respect/, name + ': ' + JSON.stringify(reqs));
      assert.doesNotMatch(reqs.map((q) => q.text).join(' '), /%/, name);
      assert.ok(reqs.some((q) => q.instruction === 'warm and curious' || /\[warm and curious\]/.test(q.text)), name + ' kept its direction: ' + JSON.stringify(reqs));
      assert.match(speechOf(reqs), /So what now\?/, name);
    }
  });
});

test('Fish: the same incident leaves the direction in brackets and none of its words in the speech', async () => {
  await withServer(31960, async ({ handed }) => {
    const reqs = await handed(INCIDENT, { voice: 'fish:fixture' });
    const joined = reqs.map((q) => q.text).join(' ');
    assert.match(joined, /\[warm and curious\]/);
    assert.doesNotMatch(joined.replace(/\[[^\]]*\]/g, ' '), /warm and curious/, joined);
    assert.doesNotMatch(joined, /%/);
  });
});
