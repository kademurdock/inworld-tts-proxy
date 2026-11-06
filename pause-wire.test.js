'use strict';
// Nov 5 2026 (Kade: Inworld voices "keep pausing"): the pause limiter through the real HTTP handler,
// buffered and streamed. The fake Inworld answers 300 ms of speech, a full second of silence, 300 ms
// of speech. Off, that second plays whole; on, it comes back as the 500 ms ceiling; reading never changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INPUT = 'I went to the farmers market this morning before it got too hot outside. They had the best peaches I have seen all summer long.';

async function withServer(port, extraEnv, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-pauses-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, ...extraEnv };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'INWORLD_PAUSE_CAP', 'TTS_TALK_CALM']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider-pauses.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  try {
    let ready = false;
    for (let i = 0; i < 160 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    const say = async (body) => {
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: INPUT, voice: 'alloy', ...body }) });
      assert.equal(r.status, 200, log.slice(-2000));
      const bytes = Buffer.from(await r.arrayBuffer());
      return { seconds: (bytes.length - 44) / 2 / 24000, streamed: r.headers.get('x-kade-tts-streamed') === '1' };
    };
    return await run({ say, health: async () => (await fetch(`http://127.0.0.1:${port}/health`)).json(), log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

test('off, the long silence plays whole in both lanes', async () => {
  await withServer(31951, {}, async ({ say, health }) => {
    const buffered = await say({});
    const streamed = await say({ stream: true });
    assert.equal(streamed.streamed, true);
    for (const r of [buffered, streamed]) assert.ok(Math.abs(r.seconds - 1.6) < 0.06, 'whole: ' + r.seconds);
    assert.equal((await health()).inworldPauses.on, false);
  });
});

test('on, chat speech gets the silence brought to the ceiling, buffered and streamed; reading is untouched', async () => {
  await withServer(31952, { INWORLD_PAUSE_CAP: '1' }, async ({ say, health, log }) => {
    const buffered = await say({});
    const streamed = await say({ stream: true });
    assert.equal(streamed.streamed, true);
    // 300 ms + 500 ms ceiling + 300 ms
    for (const r of [buffered, streamed]) assert.ok(Math.abs(r.seconds - 1.1) < 0.06, 'cut to the ceiling: ' + r.seconds);
    // reading: STABLE and a Library reading session keep every silence Inworld gave
    for (const r of [await say({ delivery: 'STABLE' }), await say({ delivery: 'STABLE', stream: true })]) {
      assert.ok(Math.abs(r.seconds - 1.6) < 0.06, 'reading is whole: ' + r.seconds);
    }
    const h = await health();
    assert.deepEqual([h.inworldPauses.on, h.inworldPauses.kneeMs, h.inworldPauses.maxMs], [true, 350, 500]);
    assert.match(log(), /\[TTS\] pauses: \d+ms of long stops brought in\r?\n/);
    assert.match(log(), /long stops brought in \(1 stops, longest 1000ms\), streamed/);
  });
});

test('the shape can be moved without a deploy', async () => {
  await withServer(31953, { INWORLD_PAUSE_CAP: '1', INWORLD_PAUSE_MAX_MS: '400' }, async ({ say }) => {
    for (const r of [await say({}), await say({ stream: true })]) assert.ok(Math.abs(r.seconds - 1.0) < 0.06, 'a 400 ms ceiling: ' + r.seconds);
  });
});
