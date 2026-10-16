'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { POOLS } = require('./audition-scenes');

test('actual preview requests use category-matched scripts for labels and saved bindings', async () => {
  for (const group of ['kids', 'characters', 'adults']) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'audition-routing-'));
    const receipt = path.join(folder, 'requests.jsonl'); fs.writeFileSync(receipt, '');
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'], {
      cwd: __dirname, env: { ...process.env, PORT: '31869', SELECTED_VOICES_ENABLED: '1', SELECTED_TEST_GROUP: group,
        FISH_API_KEY: 'offline', FISH_TTS_MODEL: 'drama-3', AWS_ACCESS_KEY_ID: 'fake-access',
        AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket', PROVIDER_RECEIPT: receipt,
        FISH_TALK_FILLERS: '0', FISH_TALK_SOUNDS: '0', FISH_DEFAULT_DIRECTION: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { ready = (await fetch('http://127.0.0.1:31869/health')).ok; } catch (_) {}
        if (ready) break; await new Promise(resolve => setTimeout(resolve, 40));
      }
      assert.ok(ready, log);
      const catalog = await (await fetch('http://127.0.0.1:31869/voices.json')).json();
      const sentinels = ['Hi there. This is how I sound.', 'Hey — quick hello from this voice, right here with you.', catalog.audition];
      const expected = [];
      for (const voice of [catalog.voices[0], 'fish:ref_0123456789abcdef']) {
        for (let i = 0; i < sentinels.length; i++) {
          const response = await fetch('http://127.0.0.1:31869/v1/audio/speech', {method: 'POST',
            headers: {'Content-Type':'application/json'}, body: JSON.stringify({voice, input:sentinels[i]})});
          assert.equal(response.status, 200); await response.arrayBuffer();
          expected.push(POOLS[group][i === 1 ? 'quick' : 'long'].map(s => s.replace(/^%%%[^%]+%%% /, '')));
        }
      }
      const calls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(calls.length, 6);
      calls.forEach((call, i) => {
        const spoken = call.text.replace(/\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim();
        assert.ok(expected[i].some(text => spoken === text.replace(/\s+/g, ' ').trim()), `${group}: wrong audition: ${call.text}`);
        assert.equal(call.model, 'drama-3'); assert.equal(call.packed, true);
        assert.ok(!call.text.includes('%%%'));
      });
    } finally {
      child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    }
  }
});
