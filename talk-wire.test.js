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
    FISH_DEFAULT_DIRECTION: BRIEF, FISH_TALK_FILLERS: '1' };
  delete env.INWORLD_TALK_FILLERS;
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

    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    assert.deepEqual([health.fishTalk.direction, health.fishTalk.fillers, health.inworldTalk.fillers], [true, true, false]);
  } finally {
    child.kill();
    await new Promise(r => child.once('exit', r));
  }
});
