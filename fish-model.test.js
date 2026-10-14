// Exercise the actual shared Fish synthesis function without making paid calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function load(env = {}, response = { ok: true, arrayBuffer: async () => Uint8Array.from([0, 0, 1, 0, 2]).buffer }) {
  const calls = [];
  const context = {
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: null,
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

test('every Fish reference uses Drama3 by default and keeps text, PCM, speed and delivery', async () => {
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
      text: '[warmly] A small test.', reference_id: ids[index].slice(5),
      format: 'pcm', sample_rate: 24000, latency: 'normal',
      temperature: 1, top_p: 0.85, normalize: false, prosody: { speed: 1.2 },
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
