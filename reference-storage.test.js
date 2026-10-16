'use strict';
// Finding 9 (Oct 16 2026): every picker voice loads its sample from private B2
// storage. A passing storage fault is retried a bounded number of times with
// growing waits, a fault that cannot heal is not retried, the load happens
// before a Fish slot is taken, and /health exercises one small storage read.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createReferenceStore } = require('./private-voice-references');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const audio = Buffer.from('private audio bytes');
const metadata = Buffer.from(JSON.stringify({ transcript: 'The spoken reference stays private.', speakerCount: 1, sha256: hash(audio) }));
const row = {
  id: 'ref_0123456789abcdef', label: 'Storage test voice', description: 'A clear warm voice.',
  categories: ['Women, Warm & Soothing'], tag: 'Storagetest', sha256: hash(audio), metadataSha256: hash(metadata),
  referenceKey: `voice-references/20261014/${hash(audio)}.mp3`, metadataKey: `voice-references/20261014/${hash(audio)}.json`,
  testedModel: 'drama-3',
};
const env = { AWS_ACCESS_KEY_ID: 'test-access', AWS_SECRET_ACCESS_KEY: 'test-secret', AWS_BUCKET_NAME: 'test-bucket' };
const respond = bytes => ({ ok: true, status: 200, headers: new Headers({ 'Content-Length': bytes.length }),
  body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });
const status = code => ({ ok: false, status: code, headers: new Headers() });
const isAudio = url => url.includes('.mp3?');

function store(fetcher, options = {}) {
  const sleeps = [];
  const calls = [];
  const made = createReferenceStore([row], { env, sleep: async ms => { sleeps.push(ms); }, ...options,
    fetcher: async (url, init) => { calls.push(url); return fetcher(url, init, calls.length); } });
  return { made, sleeps, calls };
}

test('a passing storage fault is retried with growing waits, then the voice loads', async () => {
  let audioTries = 0;
  const { made, sleeps } = store(async url => {
    if (!isAudio(url)) return respond(metadata);
    audioTries++;
    return audioTries <= 2 ? status(503) : respond(audio);
  });
  const reference = await made.load(row.id);
  assert.deepEqual(reference.audio, audio);
  assert.equal(audioTries, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 200 && sleeps[1] >= 600 && sleeps[1] > sleeps[0], JSON.stringify(sleeps));
});

test('timeouts, dropped connections and rate limits are retried too', async () => {
  for (const failure of [
    async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); },
    async () => { throw new TypeError('fetch failed'); },
    async () => status(429),
  ]) {
    let audioTries = 0;
    const { made, sleeps } = store(async url => {
      if (!isAudio(url)) return respond(metadata);
      return ++audioTries === 1 ? failure() : respond(audio);
    });
    assert.equal((await made.load(row.id)).text, 'The spoken reference stays private.');
    assert.equal(audioTries, 2);
    assert.equal(sleeps.length, 1);
  }
});

test('retries are bounded, and a fault waiting cannot heal is not retried at all', async () => {
  const always = store(async url => (isAudio(url) ? status(503) : respond(metadata)));
  await assert.rejects(always.made.load(row.id), error =>
    error.reason === 'server' && error.permanent === false &&
    error.message === 'The selected voice reference could not be loaded.' && !/X-Amz|test-access|https:/.test(error.message));
  assert.equal(always.calls.filter(isAudio).length, 3, 'three tries, no more');
  for (const [code, reason] of [[403, 'denied'], [401, 'denied'], [404, 'missing']]) {
    const refused = store(async url => (isAudio(url) ? status(code) : respond(metadata)));
    await assert.rejects(refused.made.load(row.id), error => error.reason === reason && error.permanent === true);
    assert.equal(refused.calls.filter(isAudio).length, 1, `${code} is not retried`);
    assert.equal(refused.sleeps.length, 0);
  }
  const unconfigured = store(async () => respond(audio), { env: {} });
  await assert.rejects(unconfigured.made.load(row.id), error => error.reason === 'not configured' && error.permanent);
  assert.equal(unconfigured.calls.length, 0, 'no request is made without storage settings');
  // A failure is still not cached: the next request tries again and works.
  let fail = true;
  const healing = store(async url => (fail && isAudio(url) ? status(500) : respond(isAudio(url) ? audio : metadata)));
  await assert.rejects(healing.made.load(row.id));
  fail = false;
  assert.deepEqual((await healing.made.load(row.id)).audio, audio);
});

test('readiness reads one small object, remembers a good answer for minutes and re-checks a bad one sooner', async () => {
  let clock = 1_000_000;
  let broken = false;
  const { made, calls } = store(async url => (broken ? status(503) : respond(isAudio(url) ? audio : metadata)), { now: () => clock });
  const first = await made.probe();
  assert.equal(first.ok, true);
  assert.deepEqual(calls.map(url => new URL(url).pathname.split('/').pop()), [row.metadataKey.split('/').pop()],
    'one metadata object (a few hundred bytes), never the audio');
  clock += 4 * 60 * 1000;
  await made.probe();
  assert.equal(calls.length, 1, 'cached for five minutes');
  clock += 2 * 60 * 1000;
  broken = true;
  const failed = await made.probe();
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'server');
  assert.equal(failed.permanent, false);
  assert.equal(calls.length, 3, 'the probe tries twice');
  clock += 20 * 1000;
  await made.probe();
  assert.equal(calls.length, 3, 'a failed answer is remembered briefly');
  clock += 15 * 1000;
  broken = false;
  assert.equal((await made.probe()).ok, true, 'and re-checked after 30 seconds');
  // Concurrent health checks share one read.
  clock += 10 * 60 * 1000;
  const before = calls.length;
  await Promise.all([made.probe(), made.probe(), made.probe()]);
  assert.equal(calls.length, before + 1);
  // A real voice load that worked also answers the question.
  const fresh = store(async url => respond(isAudio(url) ? audio : metadata), { now: () => clock });
  await fresh.made.load(row.id);
  const count = fresh.calls.length;
  assert.equal((await fresh.made.probe()).ok, true);
  assert.equal(fresh.calls.length, count);
  // Missing settings are permanent; the probe never throws.
  const unconfigured = store(async () => respond(metadata), { env: {} });
  const answer = await unconfigured.made.probe();
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'not configured');
  assert.equal(answer.permanent, true);
  assert.equal(answer.settingsFault, true);
});

test('only broken settings count as a settings fault; a missing or changed object, a B2 cap or a refusal do not', async () => {
  const body = text => ({ ok: false, status: 403, headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(text)); controller.close(); } }) });
  const cases = [
    [async () => status(403), 'denied', true],
    [async () => status(401), 'denied', true],
    [async () => body('<Error><Code>InvalidAccessKeyId</Code><Message>Malformed Access Key Id</Message></Error>'), 'denied', true],
    [async () => body('<Error><Code>AccessDenied</Code><Message>Cannot download file, download bandwidth or transaction (Class B) cap exceeded.</Message></Error>'), 'cap exceeded', false],
    [async () => status(404), 'missing', false],
    [async () => status(410), 'refused', false],
    [async () => respond(Buffer.from('{"changed":true}')), 'integrity', false],
  ];
  for (const [fetcher, reason, settingsFault] of cases) {
    const answer = await store(fetcher).made.probe();
    assert.equal(answer.ok, false, reason);
    assert.equal(answer.reason, reason);
    assert.equal(answer.settingsFault, settingsFault, reason);
  }
  // A capped voice load is not retried either: waiting a moment cannot lift a cap.
  const capped = store(async () => body('transaction cap exceeded'));
  await assert.rejects(capped.made.load(row.id), error => error.reason === 'cap exceeded' && error.permanent === true);
  assert.equal(capped.sleeps.length, 0);
});

test('a slow storage probe gives up well inside the bridge\'s 8 s /health wait', async () => {
  const waits = [];
  const { made, sleeps } = store(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
    { timeoutSignal: ms => { waits.push(ms); return AbortSignal.timeout(ms); } });
  const answer = await made.probe();
  assert.equal(answer.reason, 'timeout');
  assert.equal(answer.settingsFault, false, 'a slow B2 is degraded, never a failed deploy');
  assert.deepEqual(waits, [3000, 3000], 'two tries of 3 s');
  const worst = waits.reduce((a, b) => a + b, 0) + 200 + 100; // plus the largest first backoff
  assert.ok(sleeps.length === 1 && sleeps[0] <= 300, JSON.stringify(sleeps));
  assert.ok(worst < 8000, `probe can take ${worst} ms`);
});

test('the reference loads before a Fish slot is taken, and a storage failure never takes a slot', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('async function fishSynthesizeChunk(');
  const body = source.slice(start, source.indexOf('app.get("/health"', start));
  const events = [];
  const noted = [];
  const context = {
    console: { warn() {}, log() {} }, Buffer, Math,
    noteChunk: kind => noted.push(kind),
    sleep: async () => {},
    fishLimiter: async fn => { events.push('slot'); return fn(); },
    fishSynthesizeChunkOnce: async (...args) => { events.push('fish'); passed.push(args[4]); return Buffer.alloc(46); },
    selectedReferenceStore: { load: async id => { events.push('load ' + id); return loaded; } },
  };
  const loaded = { audio: Buffer.from('a'), text: 'b' };
  const passed = [];
  vm.runInNewContext(body + '\nthis.synthesize = fishSynthesizeChunk;', context);
  await context.synthesize('Hello.', 'ref_0123456789abcdef', 1);
  assert.deepEqual(events, ['load ref_0123456789abcdef', 'slot', 'fish']);
  assert.equal(passed[0], loaded, 'the loaded reference itself is handed to the Fish attempt');
  events.length = 0;
  await context.synthesize('Hello.', 'legacy-id', 1);
  assert.deepEqual(events, ['slot', 'fish'], 'saved Fish IDs never touch storage');
  assert.equal(passed[1], null);
  events.length = 0;
  context.selectedReferenceStore.load = async () => { throw Object.assign(new Error('The selected voice reference could not be loaded.'), { reason: 'server' }); };
  noted.length = 0;
  await assert.rejects(context.synthesize('Hello.', 'ref_0123456789abcdef', 1), /could not be loaded/);
  assert.deepEqual(events, [], 'no Fish slot and no Fish request');
  assert.deepEqual(noted, ['failed']);
});

test('with caching off, a chunk still reads storage once, outside the Fish slot, even when Fish retries', async () => {
  // The real fishSynthesizeChunk -> fishSynthesizeChunkOnce -> fishBody -> store path, with fake fetches.
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const cut = (from, to) => { const i = source.indexOf(from); return source.slice(i, source.indexOf(to, i)); };
  let inSlot = false;
  const reads = [];
  const referenceStore = createReferenceStore([row], { env, cacheBytes: 0, sleep: async () => {},
    fetcher: async url => { reads.push(inSlot ? 'inside' : 'outside'); return respond(isAudio(url) ? audio : metadata); } });
  let fishCalls = 0;
  const sent = [];
  const context = {
    console: { warn() {}, log() {} }, Buffer, Math, AbortController, setTimeout, clearTimeout, process: { env: {} },
    noteChunk() {}, sleep: async () => {},
    fishLimiter: async fn => { inSlot = true; try { return await fn(); } finally { inSlot = false; } },
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: referenceStore,
    fishPacedText: require('./pace').fishPacedText, capFishPauses: require('./pace').capFishPauses,
    FISH_API_KEY: 'fake-test-key', FISH_TIMEOUT_MS: 1000, FISH_SAMPLE_RATE: 24000, FISH_TTS_LATENCY: 'normal',
    FISH_TEMPERATURE: 0.9, FISH_TEMPERATURE_MAX: 1, FISH_TOP_P: 0.85, FISH_NORMALIZE: false, FISH_TEMPERATURE_BY_DELIVERY: {},
    fetch: async (url, request) => {
      fishCalls++;
      sent.push(require('@msgpack/msgpack').decode(request.body));
      if (fishCalls <= 2) return { ok: false, status: 503, text: async () => 'busy' };
      return { ok: true, arrayBuffer: async () => Uint8Array.from([0, 0, 1, 0]).buffer };
    },
  };
  vm.runInNewContext(cut('const FISH_TTS_MODEL =', 'const FISH_TTS_LATENCY =') + '\n' +
    cut('function buildWavHeader(', '// Aug 6 2026') + '\n' +
    cut('async function fishSynthesizeChunkOnce(', 'app.get("/health"') + '\nthis.synthesize = fishSynthesizeChunk;', context);
  const wav = await context.synthesize('Hello there.', row.id, 1);
  assert.ok(wav.length > 44);
  assert.equal(fishCalls, 3, 'Fish was retried twice');
  assert.deepEqual(reads, ['outside', 'outside'], 'one load (audio + metadata) per chunk, none inside the slot');
  for (const body of sent) assert.equal(Buffer.from(body.references[0].audio).toString(), audio.toString());
  assert.equal(referenceStore.stats().entries, 0, 'nothing was cached');
});

async function bootProxy(port, extraEnv) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-health-'));
  const receipt = path.join(folder, 'requests.jsonl'); fs.writeFileSync(receipt, '');
  const childEnv = { ...process.env, PORT: String(port), SELECTED_VOICES_ENABLED: '1', FISH_API_KEY: 'offline',
    INWORLD_API_KEY: 'offline', FISH_TTS_MODEL: 'drama-3', PROVIDER_RECEIPT: receipt, ...extraEnv };
  for (const [key, value] of Object.entries(childEnv)) if (value === undefined) delete childEnv[key];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'],
    { cwd: __dirname, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', v => log += v); child.stderr.on('data', v => log += v);
  let response = null;
  for (let i = 0; i < 100 && !response; i++) {
    try { response = await fetch(`http://127.0.0.1:${port}/health`); } catch (_) { await new Promise(r => setTimeout(r, 40)); }
  }
  return { child, response, log: () => log };
}
async function stop(child) { child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve)); }

test('/health on the real server reports private storage, and broken storage settings fail readiness', async () => {
  const good = await bootProxy(31872, { AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket' });
  try {
    assert.ok(good.response, good.log());
    assert.equal(good.response.status, 200);
    const health = await good.response.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.selectedStorage.status, 'ok');
    assert.match(health.selectedStorage.spoken, /answered/);
    assert.doesNotMatch(JSON.stringify(health), /fake-secret|fake-access|X-Amz|referenceKey/);
  } finally { await stop(good.child); }
  const missing = await bootProxy(31873, { AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined, AWS_BUCKET_NAME: undefined });
  try {
    assert.ok(missing.response, missing.log());
    assert.equal(missing.response.status, 503, 'a deploy without storage settings never goes live');
    const health = await missing.response.json();
    assert.equal(health.status, 'degraded');
    assert.equal(health.selectedStorage.status, 'error');
    assert.equal(health.selectedStorage.reason, 'not configured');
  } finally { await stop(missing.child); }
  const keys = { AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket' };
  const denied = await bootProxy(31877, { ...keys, SELECTED_TEST_STORAGE: 'denied' });
  try {
    assert.ok(denied.response, denied.log());
    assert.equal(denied.response.status, 503, 'refused credentials are broken settings');
    assert.equal((await denied.response.json()).selectedStorage.reason, 'denied');
  } finally { await stop(denied.child); }
});

test('/health on the real server stays 200 "degraded" for storage faults that are not broken settings', async () => {
  const keys = { AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket' };
  for (const [fault, port, reason] of [['missing', 31878, 'missing'], ['cap', 31879, 'cap exceeded']]) {
    const booted = await bootProxy(port, { ...keys, SELECTED_TEST_STORAGE: fault });
    try {
      assert.ok(booted.response, booted.log());
      assert.equal(booted.response.status, 200, `${fault}: one object or a B2 cap never blocks a deploy`);
      const health = await booted.response.json();
      assert.equal(health.status, 'degraded');
      assert.equal(health.selectedStorage.status, 'error');
      assert.equal(health.selectedStorage.reason, reason);
      assert.equal(health.selectedStorage.settingsFault, false);
    } finally { await stop(booted.child); }
  }
});
