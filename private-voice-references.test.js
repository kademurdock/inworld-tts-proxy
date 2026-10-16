'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { decode } = require('@msgpack/msgpack');
const { signedGet, createReferenceStore, selectedPicker, fishBody } = require('./private-voice-references');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const audio = Buffer.from('private audio bytes');
const sha256 = hash(audio);
const metadata = Buffer.from(JSON.stringify({ transcript: 'The spoken reference stays private.', speakerCount: 1, sha256 }));
const row = {
  id: 'ref_0123456789abcdef', label: 'Clear warm voice · cedarbrook', description: 'A clear warm voice.',
  categories: ['Feminine voices, Warm & Soothing'], tag: 'cedarbrook', sha256,
  metadataSha256: hash(metadata), referenceKey: `voice-references/20261014/${sha256}.mp3`,
  metadataKey: `voice-references/20261014/${sha256}.json`, testedModel: 'drama-3',
};
const env = { AWS_ACCESS_KEY_ID: 'test-access', AWS_SECRET_ACCESS_KEY: 'test-secret', AWS_BUCKET_NAME: 'test-bucket' };
const respond = bytes => ({ ok: true, headers: new Headers({ 'Content-Length': bytes.length }),
  body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });

test('stored numbered, named, raw and renamed bindings stay retained outside the new picker', () => {
  const legacy = { voices: ['Voice 1', 'Old described voice'], hidden: ['Voice 1 (Beta)'], aliases: ['Kiana'],
    map: { 'Voice 1': 'default__legacy', Kiana: 'fish:legacy', 'Old described voice': 'default__legacy' },
    renames: { 'Voice 1': 'Old described voice' }, describe: { 'Old described voice': 'old description' }, tags: {} };
  const before = JSON.stringify(legacy);
  const publicCatalog = selectedPicker([row], legacy);
  assert.deepEqual(publicCatalog.voices, [row.label]);
  ['Voice 1', 'Voice 1 (Beta)', 'Kiana', 'default__legacy', 'fish:legacy', 'Old described voice']
    .forEach(name => assert.ok(publicCatalog.hidden.includes(name)));
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(publicCatalog.describe['Old described voice'], 'old description');
  assert.doesNotMatch(JSON.stringify(publicCatalog), /referenceKey|metadataKey|reference_transcript|spoken reference|test-secret/);
});

test('private references are hashed, fetched once across concurrent requests and MessagePack binary', async () => {
  const calls = [];
  const store = createReferenceStore([row], { env, fetcher: async (url, options) => {
    calls.push({ url, options }); return respond(url.includes('.mp3?') ? audio : metadata);
  } });
  const [a, b] = await Promise.all([store.load(row.id), store.load(row.id)]);
  assert.strictEqual(a, b);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.url.startsWith('https://s3.us-east-005.backblazeb2.com/test-bucket/voice-references/')));
  const payload = await fishBody({ text: '[relieved] Hello.', format: 'pcm' }, row.id, store);
  const decoded = decode(payload.body);
  assert.equal(payload.contentType, 'application/msgpack');
  assert.equal(decoded.reference_id, undefined);
  assert.equal(decoded.text, '[relieved] Hello.');
  assert.deepEqual(Buffer.from(decoded.references[0].audio), audio);
  assert.equal(decoded.references[0].text, 'The spoken reference stays private.');
  assert.equal(calls.length, 2);
});

test('persistent legacy Fish IDs keep their JSON request and never access reference storage', async () => {
  const payload = await fishBody({ text: 'Hello.', format: 'pcm' }, 'legacy-id', { load() { throw Error('unexpected'); } });
  assert.equal(payload.contentType, 'application/json');
  assert.deepEqual(JSON.parse(payload.body), { text: 'Hello.', format: 'pcm', reference_id: 'legacy-id' });
});

test('unknown IDs, oversized objects, corrupted bytes and bad metadata fail before Fish', async () => {
  const good = createReferenceStore([row], { env, fetcher: async () => respond(audio) });
  await assert.rejects(good.load('ref_0000000000000000'), /unavailable/);
  await assert.rejects(good.load('ref_..\/secret'), /unavailable/);
  const corrupt = createReferenceStore([row], { env, fetcher: async url => respond(url.includes('.mp3?') ? Buffer.from('wrong') : metadata) });
  await assert.rejects(corrupt.load(row.id), /integrity/);
  const large = createReferenceStore([row], { env, fetcher: async () => ({ ok: true, headers: new Headers({ 'Content-Length': '99999999' }) }) });
  await assert.rejects(large.load(row.id), /could not be loaded/);
  assert.throws(() => createReferenceStore([{ ...row, referenceKey: 'https://evil.test/reference' }]), /Invalid/);
  assert.throws(() => createReferenceStore([row, row]), /Invalid/);
});

test('failed storage is not cached, retried reads work, and private URLs never appear in errors', async () => {
  let fail = true;
  const store = createReferenceStore([row], { env, fetcher: async url => {
    if (fail) throw Error(url);
    return respond(url.includes('.mp3?') ? audio : metadata);
  } });
  await assert.rejects(store.load(row.id), error => !error.message.includes('X-Amz') && !error.message.includes('test-access'));
  fail = false;
  assert.equal((await store.load(row.id)).text, 'The spoken reference stays private.');
});

test('signatures use a fixed host, bounded lifetime and credential scope; arbitrary paths are refused', () => {
  const url = new URL(signedGet(row.referenceKey, env, new Date('2026-10-14T08:00:00Z')));
  assert.equal(url.hostname, 's3.us-east-005.backblazeb2.com');
  assert.equal(url.searchParams.get('X-Amz-Date'), '20261014T080000Z');
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'test-access/20261014/us-east-005/s3/aws4_request');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.throws(() => signedGet('voice-references/20261014/../secret', env), /Invalid/);
  assert.throws(() => signedGet(row.referenceKey, {}), /not configured/);
});

// Finding 26 (Oct 16 2026): the in-memory reference cache is sized by bytes, not by a
// count of 24, so browsing auditions does not push out the voices people are using.
function referenceRows(count, audioBytes) {
  return Array.from({ length: count }, (_, i) => {
    const sound = Buffer.alloc(audioBytes, i + 1);
    const soundSha = hash(sound);
    const meta = Buffer.from(JSON.stringify({ transcript: `Reference words ${i}.`, speakerCount: 1, sha256: soundSha }));
    return { row: { id: 'ref_' + (i + 1).toString(16).padStart(16, '0'), label: `Cache test voice ${i}`, description: 'A test voice.',
      categories: ['Women, Clear & Neutral'], tag: `Cachetest${i}`, sha256: soundSha, metadataSha256: hash(meta),
      referenceKey: `voice-references/20261014/${soundSha}.mp3`, metadataKey: `voice-references/20261014/${soundSha}.json`, testedModel: 'drama-3' },
      sound, meta };
  });
}
function countingStore(made, options = {}) {
  const fetched = [];
  const byKey = new Map(made.flatMap(({ row, sound, meta }) => [[row.referenceKey, sound], [row.metadataKey, meta]]));
  const store = createReferenceStore(made.map(m => m.row), { env, ...options, fetcher: async url => {
    const key = decodeURIComponent(new URL(url).pathname).replace('/test-bucket/', '');
    fetched.push(key);
    return respond(byKey.get(key));
  } });
  return { store, fetched };
}

test('the default cache holds dozens of voices by bytes, and every Fish request still carries its reference', async () => {
  const { DEFAULT_REFERENCE_CACHE_BYTES } = require('./private-voice-references');
  assert.equal(DEFAULT_REFERENCE_CACHE_BYTES, 64 * 1024 * 1024);
  const made = referenceRows(40, 200 * 1024); // 40 voices, about 8 MB in all
  const { store, fetched } = countingStore(made);
  for (const { row } of made) await store.load(row.id);
  assert.equal(fetched.length, 80, 'two storage reads per voice the first time');
  for (const { row } of made) await store.load(row.id);
  assert.equal(fetched.length, 80, 'a 25th voice no longer pushes the first one out');
  assert.equal(store.stats().entries, 40);
  assert.ok(store.stats().bytes >= 40 * 200 * 1024 && store.stats().bytes <= store.stats().limitBytes);
  // What Fish receives is unchanged: the whole reference inline, on every request.
  for (const { row, sound } of made.slice(0, 3)) {
    for (let i = 0; i < 2; i++) {
      const payload = decode((await fishBody({ text: 'Hello.' }, row.id, store)).body);
      assert.deepEqual(Buffer.from(payload.references[0].audio), sound);
      assert.equal(payload.reference_id, undefined);
    }
  }
  assert.equal(fetched.length, 80);
});

test('the byte limit evicts the least recently used voice and never keeps more bytes than allowed', async () => {
  const made = referenceRows(4, 100 * 1024);
  const { store, fetched } = countingStore(made, { cacheBytes: 250 * 1024 });
  const [a, b, c] = made.map(m => m.row.id);
  await store.load(a); await store.load(b);
  await store.load(a); // a is now the most recently used
  await store.load(c); // over the limit: b, the least recently used, goes
  assert.equal(store.stats().entries, 2);
  assert.ok(store.stats().bytes <= 250 * 1024);
  const before = fetched.length;
  await store.load(a); await store.load(c);
  assert.equal(fetched.length, before, 'recently used voices stay cached');
  await store.load(b);
  assert.equal(fetched.length, before + 2, 'the evicted voice is fetched again');
  const none = countingStore(made, { cacheBytes: 0 });
  await none.store.load(a); await none.store.load(a);
  assert.equal(none.fetched.length, 4, 'a zero limit caches nothing');
});
