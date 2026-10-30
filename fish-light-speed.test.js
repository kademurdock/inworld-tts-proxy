'use strict';
// Oct 30 2026: Fish's lowest speed settings at Brisk and Quick (pace.js fishApiSpeed). Kade: "we'll
// have to make due wit the lowest speed settings on api."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fishApiSpeed, FISH_PACES } = require('./pace');

const ON = { FISH_PACE_SPEED: '1' };

test('off unless FISH_PACE_SPEED is 1', () => {
  for (const source of [{}, { FISH_PACE_SPEED: '0' }, { FISH_PACE_SPEED: 'true' }]) {
    assert.equal(fishApiSpeed(1.2, { talk: true, source }), 1);
    assert.equal(fishApiSpeed(1.5, { talk: true, source }), 1);
  }
});

test('only Brisk and Quick move, by the lowest amounts', () => {
  assert.equal(fishApiSpeed(1.2, { talk: true, source: ON }), 1.05);
  assert.equal(fishApiSpeed(1.5, { talk: true, source: ON }), 1.1);
  for (const rate of [undefined, 0.75, 0.9, 1]) assert.equal(fishApiSpeed(rate, { talk: true, source: ON }), 1, String(rate));
  assert.deepEqual(FISH_PACES.map((p) => p.apiSpeed || 1), [1, 1, 1, 1.05, 1.1]);
});

test('reading never moves', () => {
  assert.equal(fishApiSpeed(1.5, { talk: false, source: ON }), 1);
  assert.equal(fishApiSpeed(1.5, { source: ON }), 1);
});

test('through the real handler: chat at Brisk and Quick moves, Natural and reading stay', async () => {
  const PORT = '31894';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-speed-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, FISH_PACE_SPEED: '1' };
  for (const k of ['FISH_DIRECTOR', 'INWORLD_WRITER', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', x => { log += x; });
  child.stderr.on('data', x => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const INPUT = 'I finally finished the quilt for my sister last night and it came out better than I hoped.';
  async function speedOf(extra) {
    const before = rows().length;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: 'fish:fixture', input: INPUT, ...extra }),
    });
    assert.equal(r.status, 200, log.slice(-2000));
    await r.arrayBuffer();
    const calls = rows().slice(before);
    assert.equal(calls.length, 1, log.slice(-2000));
    return calls[0].body.prosody.speed;
  }
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${PORT}/`)).status < 500; } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, log);
    assert.equal(await speedOf({}), 1);
    assert.equal(await speedOf({ speed: 1 }), 1);
    assert.equal(await speedOf({ speed: 1.2 }), 1.05);
    assert.equal(await speedOf({ speed: 1.5 }), 1.1);
    assert.equal(await speedOf({ speed: 1.5, delivery: 'STABLE' }), 1);
  } finally {
    child.kill();
  }
});
