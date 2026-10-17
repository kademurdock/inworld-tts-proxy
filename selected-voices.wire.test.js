'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
test('the real picker restores Classic Inworld and preserves both saved old and new Fish synthesis', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-tts-'));
  const receipt = path.join(folder, 'requests.jsonl'); fs.writeFileSync(receipt, '');
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'], {
    cwd: __dirname, env: { ...process.env, PORT: '31868', SELECTED_VOICES_ENABLED: '1',
      FISH_API_KEY: 'offline', INWORLD_API_KEY: 'offline', FISH_TTS_MODEL: 'drama-3', FISH_TTS_SPEED: '1.5', AWS_ACCESS_KEY_ID: 'fake-access',
      AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket', PROVIDER_RECEIPT: receipt },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch('http://127.0.0.1:31868/health')).ok; } catch (_) {}
      if (ready) break; await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.ok(ready, log);
    const catalog = await (await fetch('http://127.0.0.1:31868/voices.json')).json();
    assert.deepEqual(catalog.fish, ['Clear warm voice · cedarbrook']);
    // Oct 17 2026: 421 Classic Inworld voices plus the ten new ones (Voices 654-663).
    assert.equal(catalog.voices.length, 432);
    assert.equal(catalog.classic.length, 431);
    assert.ok(catalog.classic.every(label => label.endsWith('(Classic)') && catalog.providers[label] === 'inworld'));
    assert.ok(catalog.hidden.includes('Voice 1'));
    assert.ok(catalog.hidden.includes('Kiana (Comedian)'));
    assert.ok(catalog.hidden.includes('fish:44046fb3ef9f42d4a5de7f760767718e') || catalog.hidden.some(v => v.startsWith('fish:')));
    assert.doesNotMatch(JSON.stringify(catalog), /referenceKey|metadataKey|private reference phrase|AWS_|fake-secret/);
    for (const voice of [catalog.voices[0], 'fish:ref_0123456789abcdef', 'fish:legacy-id', undefined]) {
      const response = await fetch('http://127.0.0.1:31868/v1/audio/speech', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice, speed: 1.2, input: '%%%relieved with a smile%%% We <emphasis>found</emphasis> it.' }) });
      assert.equal(response.status, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 44);
    }
    const calls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(c => c.model === 'drama-3' && /relieved/.test(c.text) && !c.text.includes('%%%')));
    assert.ok(calls.every(c => c.prosody.speed === 1 && c.text.startsWith('[speaking quickly') && c.text.includes('<emphasis>found</emphasis>')));
    assert.equal(calls[2].reference_id, 'legacy-id'); assert.equal(calls[2].packed, false);
    [calls[0], calls[1], calls[3]].forEach(call => {
      assert.equal(call.packed, true); assert.equal(call.reference_id, undefined);
      assert.equal(call.references[0].audio, 'offline selected reference');
      assert.equal(call.references[0].text, 'A private reference phrase.');
    });
    const classic = catalog.classic[0];
    const response = await fetch('http://127.0.0.1:31868/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: classic, speed: 1.2, input: '%%%relieved with a smile%%% We found it.' }) });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    const inworld = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(inworld.provider, 'inworld');
    assert.equal(inworld.audioConfig.speakingRate, 1.2);
    assert.match(inworld.text + (inworld.instruction || ''), /relieved/);
    assert.doesNotMatch(inworld.text, /speaking quickly/);
  } finally {
    child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
});
