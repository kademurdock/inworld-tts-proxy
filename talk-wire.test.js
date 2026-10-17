'use strict';
// Oct 16 2026: the casual Fish brief and spoken filler words, through the real HTTP handler.
// Chat speech gets them; reading (STABLE, Library reading sessions) never does; the listener's
// switch (fillers in the body or x-kade-tts-fillers) wins over the server default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = '31881';
const BRIEF = 'talking off the cuff, relaxed and casual, thinking out loud with a friend';
const INPUT = 'I went to the farmers market this morning before it got too hot outside. They had the best peaches I have seen all summer long.';
const FILLED = /(?:Um|Uh|I mean|Well|You know), they had the best peaches/;

test('chat speech gets the brief and fillers; reading never does; the switch wins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-talk-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt,
    FISH_DEFAULT_DIRECTION: BRIEF, FISH_TALK_FILLERS: '1', FISH_TEMPERATURE_MAX: '0.4' };
  delete env.INWORLD_TALK_FILLERS;
  delete env.INWORLD_TALK_SOUNDS;
  delete env.FISH_TALK_SOUNDS;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', x => { log += x; });
  child.stderr.on('data', x => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  async function say(body, headers = {}) {
    const before = rows().length;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input: INPUT, ...body }),
    });
    assert.equal(r.status, 200, log.slice(-2000));
    await r.arrayBuffer();
    const calls = rows().slice(before);
    assert.equal(calls.length, 1);
    return calls[0].body.text;
  }
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${PORT}/`)).status < 500; } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, log);

    // Fish chat: the brief leads, one filler is spoken, the words are otherwise the reply's.
    const chat = await say({ voice: 'fish:fixture' });
    assert.ok(chat.startsWith(`[${BRIEF}] I went to the farmers market`), chat);
    assert.match(chat, FILLED);
    assert.equal(await say({ voice: 'fish:fixture' }), chat, 'the same reply sounds the same on replay');

    // Reading: STABLE lanes and Library reading sessions get neither.
    for (const [body, headers] of [[{ voice: 'fish:fixture', delivery: 'STABLE' }, {}],
      [{ voice: 'fish:fixture', delivery: 'CREATIVE' }, { 'x-kade-tts-session': 'reading:user1:book1' }]]) {
      const text = await say(body, headers);
      assert.doesNotMatch(text, /off the cuff/);
      assert.doesNotMatch(text, FILLED);
    }

    // The listener's switch turns fillers off (the brief stays) and works as a header too.
    for (const [body, headers] of [[{ voice: 'fish:fixture', fillers: false }, {}], [{ voice: 'fish:fixture' }, { 'x-kade-tts-fillers': 'off' }]]) {
      const text = await say(body, headers);
      assert.ok(text.startsWith(`[${BRIEF}]`), text);
      assert.doesNotMatch(text, FILLED);
    }

    // Inworld: off by default, on when the listener asks, buffered and streamed; never the Fish brief.
    for (const stream of [false, true]) {
      assert.doesNotMatch(await say({ voice: 'alloy', stream }), FILLED);
      const asked = await say({ voice: 'alloy', stream, fillers: true });
      assert.match(asked, FILLED);
      assert.doesNotMatch(asked, /off the cuff/);
      assert.doesNotMatch(await say({ voice: 'alloy', stream, fillers: true, delivery: 'STABLE' }), FILLED);
    }

    // Kade, Oct 16: "turned the temp way down on the fish voices": the ceiling covers every delivery.
    for (const delivery of [undefined, 'BALANCED', 'CREATIVE', 'STABLE']) {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: INPUT, voice: 'fish:fixture', ...(delivery ? { delivery } : {}) }) });
      assert.equal(r.status, 200);
      await r.arrayBuffer();
      assert.equal(rows().slice(before)[0].body.temperature, 0.4, String(delivery));
    }

    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    assert.deepEqual([health.fishTalk.direction, health.fishTalk.fillers, health.inworldTalk.fillers], [true, true, false]);
    assert.deepEqual(health.fishTemperature, { default: 0.9, max: 0.4 });
  } finally {
    child.kill();
    await new Promise(r => child.once('exit', r));
  }
});

// Oct 16 2026, Kade: auditions "should sound human" like the voice messages they preview, but
// "when reading books, they shouldn't". Book scenes stay word for word; conversation scenes may
// gain a filler or a little sound.
test('conversation auditions get the voice-message treatment; book auditions stay plain', async () => {
  const { MIXED, KIND_BY_SCRIPT } = require('./audition-scenes');
  const AUD_PORT = '31882';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-talk-aud-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'], {
    cwd: __dirname, env: { ...process.env, PORT: AUD_PORT, SELECTED_VOICES_ENABLED: '1', SELECTED_TEST_GROUP: 'adults',
      FISH_API_KEY: 'offline', FISH_TTS_MODEL: 'drama-3', AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret',
      AWS_BUCKET_NAME: 'test-bucket', PROVIDER_RECEIPT: receipt, FISH_TALK_FILLERS: '1', FISH_TALK_SOUNDS: '1', FISH_DEFAULT_DIRECTION: BRIEF },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', v => { log += v; });
  child.stderr.on('data', v => { log += v; });
  const plain = s => s.replace(/%%%[^%]+%%%|\[[^\]]*\]|<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const book = new Set(), talk = new Set();
  // Oct 17 2026: the mixed pool (Fish scenes + the general lines); a general script may be several
  // paragraphs, and each paragraph is its own Fish request.
  for (const script of [...MIXED.adults.long, ...MIXED.adults.quick]) {
    for (const paragraph of script.split(/\n\n+/)) (KIND_BY_SCRIPT.get(script) === 'book' ? book : talk).add(plain(paragraph));
  }
  const ADDED = /\[(?:inhale|small laugh|sigh|clear throat|quietly clears throat)\]/;
  const FILLER = /\b(?:So, um,|So,|Um,|Uh,|I mean,|Well,|You know,) /;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${AUD_PORT}/health`)).ok; } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 40));
    }
    assert.ok(ready, log);
    const catalog = await (await fetch(`http://127.0.0.1:${AUD_PORT}/voices.json`)).json();
    for (let i = 0; i < 40; i++) {
      const input = i % 2 ? 'Hi there. This is how I sound.' : 'Hey — quick hello from this voice, right here with you.';
      const r = await fetch(`http://127.0.0.1:${AUD_PORT}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: catalog.voices[0], input }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
    }
    const calls = fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    let books = 0, touched = 0;
    for (const call of calls) {
      const spoken = plain(call.text);
      if (book.has(spoken)) {
        books++;
        assert.doesNotMatch(call.text, ADDED, `a book audition got a sound: ${call.text}`);
        assert.doesNotMatch(call.text, /off the cuff/);
        continue;
      }
      const unfilled = spoken.replace(FILLER, '');
      assert.ok([...talk].some(t => t.toLowerCase() === unfilled.toLowerCase()), `not a conversation scene plus a filler: ${call.text}`);
      if (FILLER.test(call.text) || ADDED.test(call.text)) touched++;
    }
    assert.ok(books > 0 && touched > 0, `books ${books}, touched conversation ${touched} of ${calls.length}`);
  } finally {
    child.kill();
    await new Promise(r => child.once('exit', r));
  }
});
