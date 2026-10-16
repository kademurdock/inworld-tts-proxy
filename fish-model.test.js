// Exercise the actual shared Fish synthesis function without making paid calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function load(env = {}, response = { ok: true, arrayBuffer: async () => Uint8Array.from([0, 0, 1, 0, 2]).buffer }, store = null) {
  const calls = [];
  const context = {
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: store, fishPacedText: require('./pace').fishPacedText, capFishPauses: require('./pace').capFishPauses,
    process: { env }, Buffer, AbortController, setTimeout, clearTimeout,
    FISH_API_KEY: 'fake-test-key', FISH_TIMEOUT_MS: 1000,
    FISH_SAMPLE_RATE: 24000, FISH_TTS_LATENCY: 'normal', FISH_TTS_SPEED: 1,
    FISH_TEMPERATURE: 0.9, FISH_TOP_P: 0.85, FISH_NORMALIZE: false,
    FISH_TEMPERATURE_BY_DELIVERY: { STABLE: 0.5, BALANCED: 0.9, CREATIVE: 1 },
    fetch: async (url, request) => { calls.push({ url, request }); return response; },
  };
  vm.runInNewContext(
    cut('const FISH_TTS_MODEL =', 'const FISH_TTS_LATENCY =') + '\n' +
    cut('function buildWavHeader(', '// Aug 6 2026') + '\n' +
    cut('async function fishSynthesizeChunkOnce(', 'async function fishSynthesizeChunk(') +
    '\nthis.synthesize = fishSynthesizeChunkOnce;', context);
  return { synthesize: context.synthesize, calls };
}

test('every Fish reference uses Drama3 by default and keeps text, PCM, instructional pace and delivery', async () => {
  const { synthesize, calls } = load();
  const definitions = cut('const OPENAI_ALIAS_MAP =', 'const MODEL_MAP =');
  const catalog = { FISH_VOICE_PREFIX: 'fish:', process: { env: {} }, console: { log() {}, warn() {} }, require };
  vm.runInNewContext(definitions + '\n' + cut('const VOICE_LIST =', 'const SAMPLE_TEXT =') + '\nthis.voices = VOICE_MAP;', catalog);
  const ids = [...new Set(Object.values(catalog.voices).filter(id => typeof id === 'string' && id.startsWith('fish:')))];
  assert.ok(ids.length > 150);
  for (const id of ids) await synthesize('[warmly] A small test.', id.slice(5), 1.2, 'CREATIVE');
  assert.equal(calls.length, ids.length);
  calls.forEach(({ url, request }, index) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts');
    assert.equal(request.headers.model, 'drama-3');
    assert.deepEqual(JSON.parse(request.body), {
      text: require('./pace').fishPacedText('[warmly] A small test.', 1.2), reference_id: ids[index].slice(5),
      format: 'pcm', sample_rate: 24000, latency: 'normal',
      temperature: 1, top_p: 0.85, normalize: false, prosody: { speed: 1 },
    });
  });
});

test('explicit S2.1 Pro rollback remains available', async () => {
  const { synthesize, calls } = load({ FISH_TTS_MODEL: 's2.1-pro' });
  await synthesize('Hello.', 'existing-reference');
  assert.equal(calls[0].request.headers.model, 's2.1-pro');
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.reference_id, 'existing-reference');
  assert.equal(body.prosody.speed, 1);
  assert.equal(body.temperature, 0.9);
});

test('misspelled model is refused before a paid request or silent S2 fallback', async () => {
  const { synthesize, calls } = load({ FISH_TTS_MODEL: 'drama3' });
  await assert.rejects(synthesize('Hello.', 'existing-reference'), /Unsupported FISH_TTS_MODEL/);
  assert.equal(calls.length, 0);
});

test('raw PCM becomes an aligned 24 kHz mono WAV for phone and narration paths', async () => {
  const { synthesize } = load();
  const wav = await synthesize('Hello.', 'existing-reference');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.equal(wav.length, 48);
});

test('credit exhaustion keeps its non-retryable error', async () => {
  const { synthesize } = load({}, { ok: false, status: 402, text: async () => 'No credits' });
  await assert.rejects(synthesize('Hello.', 'existing-reference'), (error) =>
    error.status === 402 && !error.isRateLimit && !error.isServerErr && /credit exhausted/.test(error.message));
});

test('health reports the selected Fish model without an API key', () => {
  const health = cut('app.get("/health"', '// Remove web-search citation');
  assert.match(health, /fishModel: FISH_TTS_MODEL/);
  assert.doesNotMatch(health, /FISH_API_KEY/);
});

// Finding 28 (Oct 16 2026): the documented rollback (FISH_TTS_MODEL=s2.1-pro or
// drama-3-preview) must not break the picker voices, whose private references go
// inline and were checked on drama-3 only.
const referenceStore = { load: async () => ({ audio: Buffer.from('offline reference audio'), text: 'Offline reference words.' }) };
const okAudio = { ok: true, arrayBuffer: async () => Uint8Array.from([0, 0, 1, 0]).buffer };

test('the rollback moves saved Fish IDs, and picker voices stay on the model their references were checked on', async () => {
  const { decode } = require('@msgpack/msgpack');
  for (const model of ['s2.1-pro', 'drama-3-preview', 's2.1-pro-free', 's2-pro', 's1']) {
    const { synthesize, calls } = load({ FISH_TTS_MODEL: model }, okAudio, referenceStore);
    await synthesize('Hello.', 'ref_0123456789abcdef');
    await synthesize('Hello.', 'existing-reference');
    assert.equal(calls.length, 2, model);
    assert.equal(calls[0].request.headers.model, 'drama-3', `${model}: picker voice keeps drama-3`);
    assert.equal(calls[0].request.headers['Content-Type'], 'application/msgpack');
    const packed = decode(calls[0].request.body);
    assert.equal(packed.references[0].text, 'Offline reference words.');
    assert.equal(packed.reference_id, undefined);
    assert.equal(calls[1].request.headers.model, model, `${model}: saved Fish IDs follow the rollback`);
    assert.equal(JSON.parse(calls[1].request.body).reference_id, 'existing-reference');
  }
});

test('FISH_REFERENCE_MODEL moves the picker voices as well; a misspelling is refused before a paid request', async () => {
  const moved = load({ FISH_TTS_MODEL: 's2.1-pro', FISH_REFERENCE_MODEL: 's2.1-pro' }, okAudio, referenceStore);
  await moved.synthesize('Hello.', 'ref_0123456789abcdef');
  assert.equal(moved.calls[0].request.headers.model, 's2.1-pro');
  const typo = load({ FISH_REFERENCE_MODEL: 'drama3' }, okAudio, referenceStore);
  await assert.rejects(typo.synthesize('Hello.', 'ref_0123456789abcdef'), /Unsupported FISH_REFERENCE_MODEL/);
  assert.equal(typo.calls.length, 0);
  await typo.synthesize('Hello.', 'existing-reference');
  assert.equal(typo.calls[0].request.headers.model, 'drama-3', 'a reference-model typo never breaks saved Fish IDs');
  // The default is unchanged: everything on drama-3.
  const plain = load({}, okAudio, referenceStore);
  await plain.synthesize('Hello.', 'ref_0123456789abcdef');
  assert.equal(plain.calls[0].request.headers.model, 'drama-3');
});

test('on the real server under the rollback, a picker voice speaks on drama-3 with Drama3 emphasis and the boot log says so', async () => {
  const fs2 = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const folder = fs2.mkdtempSync(path.join(os.tmpdir(), 'fish-rollback-'));
  const receipt = path.join(folder, 'requests.jsonl'); fs2.writeFileSync(receipt, '');
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'], {
    cwd: __dirname, env: { ...process.env, PORT: '31874', SELECTED_VOICES_ENABLED: '1', FISH_API_KEY: 'offline', INWORLD_API_KEY: 'offline',
      FISH_TTS_MODEL: 's2.1-pro', FISH_REFERENCE_MODEL: '', AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret',
      AWS_BUCKET_NAME: 'test-bucket', PROVIDER_RECEIPT: receipt },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
  try {
    let health = null;
    for (let i = 0; i < 100 && !health; i++) {
      try { health = await (await fetch('http://127.0.0.1:31874/health')).json(); } catch (_) { await new Promise(r => setTimeout(r, 40)); }
    }
    assert.ok(health, log);
    assert.equal(health.fishModel, 's2.1-pro');
    assert.equal(health.fishReferenceModel, 'drama-3');
    const catalog = await (await fetch('http://127.0.0.1:31874/voices.json')).json();
    for (const voice of [catalog.fish[0], 'fish:legacy-id']) {
      const response = await fetch('http://127.0.0.1:31874/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, input: 'We FOUND it today.' }) });
      assert.equal(response.status, 200, log);
      await response.arrayBuffer();
    }
    const [picker, saved] = fs2.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(picker.model, 'drama-3'); assert.equal(picker.packed, true);
    assert.match(picker.text, /<emphasis>FOUND<\/emphasis>/);
    assert.equal(saved.model, 's2.1-pro'); assert.equal(saved.packed, false);
    assert.match(saved.text, /\[emphasis\] FOUND/);
    assert.match(log, /selected picker voices stay on drama-3/);
  } finally {
    child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
});
