'use strict';
// Oct 29 2026: conversation-sized directions (talk-calm.js). Kade: "These are supposed to be chars
// having a live conversation with someone, not auditioning for a drama."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { calmOn, calmDirection, calmTags } = require('./talk-calm');

test('off unless TTS_TALK_CALM is 1', () => {
  assert.equal(calmOn({}), false);
  assert.equal(calmOn({ TTS_TALK_CALM: '0' }), false);
  assert.equal(calmOn({ TTS_TALK_CALM: '1' }), true);
});

test('big words go on both engines; the feeling stays', () => {
  for (const engine of ['fish', 'inworld']) {
    assert.equal(calmDirection('fond and a little emotional', { engine }), 'fond');
    assert.equal(calmDirection('excited and emotional, a little teary', { engine }), '');
    assert.equal(calmDirection('really excited', { engine }), '');
    assert.equal(calmDirection('hugely relieved', { engine }), 'relieved');
  }
});

test('hush words go on Inworld only', () => {
  assert.equal(calmDirection('soft and steady low', { engine: 'inworld' }), 'steady');
  assert.equal(calmDirection('warm quieter', { engine: 'inworld' }), 'warm');
  assert.equal(calmDirection('quiet gentle', { engine: 'inworld' }), '');
  assert.equal(calmDirection('warm, gentle, a little sad', { engine: 'inworld' }), 'warm, a little sad');
  assert.equal(calmDirection('soft and steady low', { engine: 'fish' }), 'soft and steady low');
});

test('everyday directions, hyphenated words, sounds and reset are left alone', () => {
  for (const d of ['dry and a little amused', 'getting real for a second', 'laughing as i answer', 'low-key amused',
    'soft-spoken and warm', 'sober and honest', 'plain and honest', 'warm and practical', 'reset', 'laughs', 'small laugh']) {
    assert.equal(calmDirection(d, { engine: 'inworld' }), d, d);
    assert.equal(calmDirection(d, { engine: 'fish' }), d, d);
  }
});

test('a calmed direction never becomes a sound or a one-shot tag that carried copies would repeat', () => {
  for (const d of ['laughing excitedly', 'excited laugh', 'dramatic pause']) assert.equal(calmDirection(d), '', d);
  for (const d of ['soft laugh', 'gentle sigh', 'quiet chuckle', 'whispered laugh', 'laughs softly', 'sighs softly']) {
    assert.equal(calmDirection(d, { engine: 'inworld' }), '', d);
  }
});

test('leftovers never invert or garble a direction', () => {
  assert.equal(calmDirection('calm, not excited'), 'calm');
  for (const d of ['not excited', 'trying not to sound excited', 'absolutely not', 'no longer shouting', 'too excited',
    'full of excitement', 'a hint of excitement', 'teary eyed', 'pumped up', 'with a raw edge']) assert.equal(calmDirection(d), '', d);
  for (const d of ['low energy', 'in a low voice', 'more softly now', 'a touch softer', 'speaking softly']) {
    assert.equal(calmDirection(d, { engine: 'inworld' }), '', d);
  }
  assert.equal(calmDirection('warm; excited; fond'), 'warm; fond');
  assert.equal(calmDirection('warm — excited'), 'warm');
});

test('a line break after a changed bracket stays', () => {
  assert.equal(calmTags('line one [fond and emotional]\nline two'), 'line one [fond]\nline two');
  assert.equal(calmTags('line one [excited]\nline two'), 'line one \nline two');
});

test('calmTags rewrites direction brackets, drops emptied ones, and never touches the words', () => {
  assert.equal(calmTags('[fond and a little emotional] Hey you. [laughs] That is so good. [excited] Wow.'),
    '[fond] Hey you. [laughs] That is so good. Wow.');
  assert.equal(calmTags('[soft and quiet] Hey. [small laugh] okay [warm quieter] fine.', { engine: 'inworld' }),
    'Hey. [small laugh] okay [warm] fine.');
  const plain = 'Nothing to change here, just talking.';
  assert.equal(calmTags(plain), plain);
});

test('through the real handler: talk is calmed when on, reading never is', async () => {
  const PORT = '31893';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-calm-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt,
    TTS_TALK_CALM: '1', FISH_DEFAULT_DIRECTION: 'a relaxed chat', TTS_INSTRUCTION_FIELD: '1' };
  for (const k of ['FISH_DIRECTOR', 'INWORLD_WRITER', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', x => { log += x; });
  child.stderr.on('data', x => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  async function say(body) {
    const before = rows().length;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(r.status, 200, log.slice(-2000));
    await r.arrayBuffer();
    const calls = rows().slice(before);
    assert.equal(calls.length, 1, log.slice(-2000));
    return calls[0].body;
  }
  const INPUT = '%%%fond and a little emotional%%% I finally finished the quilt for my sister last night and it came out better than I hoped.';
  const HUSHED = '%%%soft and steady low%%% I finally finished the quilt for my sister last night and it came out better than I hoped.';
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${PORT}/`)).status < 500; } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, log);

    const fish = (await say({ voice: 'fish:fixture', input: INPUT })).text;
    assert.match(fish, /\[fond\] I finally finished/, fish);
    assert.doesNotMatch(fish, /emotional/);
    const reading = (await say({ voice: 'fish:fixture', input: INPUT, delivery: 'STABLE' })).text;
    assert.match(reading, /emotional/, 'reading keeps the direction as written');

    const inworld = await say({ voice: 'alloy', input: HUSHED });
    const sent = JSON.stringify(inworld);
    assert.match(sent, /steady/, sent);
    assert.doesNotMatch(sent, /\bsoft\b|\blow\b/, sent);
  } finally {
    child.kill();
  }
});
