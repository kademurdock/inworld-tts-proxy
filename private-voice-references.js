'use strict';

const crypto = require('node:crypto');
const { encode } = require('@msgpack/msgpack');
const HOST = 's3.us-east-005.backblazeb2.com';
const REGION = 'us-east-005';
const PREFIX = 'voice-references/20261014/';
const REFERENCE_ID = /^ref_[a-f0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const escape = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function signedGet(key, env, now = new Date()) {
  if (!key.startsWith(PREFIX) || !/^[a-f0-9]{64}\.(mp3|json)$/.test(key.slice(PREFIX.length))) {
    throw new Error('Invalid private voice object.');
  }
  const access = env.AWS_ACCESS_KEY_ID;
  const secret = env.AWS_SECRET_ACCESS_KEY;
  const bucket = env.AWS_BUCKET_NAME;
  if (!access || !secret || !bucket || /[\/]/.test(bucket)) throw new Error('Private voice storage is not configured.');
  const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const day = amz.slice(0, 8);
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const path = '/' + [bucket, ...key.split('/')].map(escape).join('/');
  const fields = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${access}/${scope}`,
    'X-Amz-Date': amz, 'X-Amz-Expires': '300', 'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(fields).sort().map(k => `${escape(k)}=${escape(fields[k])}`).join('&');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const hmac = (keyValue, value) => crypto.createHmac('sha256', keyValue).update(value).digest();
  const canonical = ['GET', path, query, `host:${HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signing = hmac(hmac(hmac(hmac('AWS4' + secret, day), REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signing).update(['AWS4-HMAC-SHA256', amz, scope, hash(canonical)].join('\n')).digest('hex');
  return `https://${HOST}${path}?${query}&X-Amz-Signature=${signature}`;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('The selected voice catalog is empty.');
  const ids = new Set();
  const labels = new Set();
  const names = new Map();
  rows.forEach(row => {
    if (!row || !REFERENCE_ID.test(row.id) || !SHA256.test(row.sha256) || !SHA256.test(row.metadataSha256) ||
        typeof row.label !== 'string' || !row.label.trim() || row.label.length > 140 ||
        typeof row.description !== 'string' || !row.description.trim() ||
        !Array.isArray(row.categories) || !row.categories.length || row.categories.some(c => typeof c !== 'string' || !c.trim()) ||
        ids.has(row.id) || labels.has(row.label) || row.referenceKey !== PREFIX + row.sha256 + '.mp3' ||
        row.metadataKey !== PREFIX + row.sha256 + '.json' || row.testedModel !== 'drama-3') {
      throw new Error('Invalid selected voice catalog.');
    }
    ids.add(row.id); labels.add(row.label);
    if (row.aliases !== undefined && (!Array.isArray(row.aliases) || row.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 140))) {
      throw new Error('Invalid selected voice aliases.');
    }
    for (const name of [row.label, row.tag, ...(row.aliases || [])].filter(Boolean)) {
      const key = name.toLowerCase();
      if (names.has(key) && names.get(key) !== row.id) throw new Error('Ambiguous selected voice alias.');
      names.set(key, row.id);
    }
  });
  return rows;
}

// Fish needs the reference audio inside every request for these voices (there
// is no saved Fish model to point at), so what is cached here is only the B2
// fetch. Sized by bytes, not count (Oct 16 2026): 24 entries meant browsing
// two dozen auditions pushed out the voices people were chatting with, and
// every miss is two signed B2 GETs before Fish is even called.
const DEFAULT_REFERENCE_CACHE_BYTES = 64 * 1024 * 1024;

// Storage reads (Oct 16 2026): every picker voice depends on B2, so a passing
// blip (a 5xx, a 429, a timeout, a dropped connection) is retried a bounded
// number of times with growing waits. A configuration or credential problem
// (not configured, 401/403, 404, oversized object) is not: it cannot heal by
// waiting, and the caller gets the same sanitised error at once. The final
// error carries only a short `reason` word, never a URL or transcript.
const STORAGE_ATTEMPTS = 3;
const STORAGE_TIMEOUT_MS = 15000;
const STORAGE_BACKOFF_MS = 200;
// /health exercises one small storage read (one row's metadata object, a few
// hundred bytes), remembered for 5 minutes when it worked and 30 s when not.
// Two tries of 3 s plus one backoff (at most 0.3 s) stay under the bridge's
// 8 s /health timeout, so a slow B2 reads as "degraded", never as a proxy
// that is not answering (Railway's own deploy check allows 30 s).
const PROBE_OK_MS = 5 * 60 * 1000;
const PROBE_FAILED_MS = 30 * 1000;
const PROBE_TRIES = 2;
const PROBE_TIMEOUT_MS = 3000;
// Only these are broken settings, the faults /health turns into a 503 so a
// deploy carrying them never replaces a working one. Everything else (a
// missing or changed object, a B2 cap, an outage) leaves the other voices
// speaking and must not block an urgent deploy, so it reports "degraded".
const SETTINGS_FAULTS = new Set(['not configured', 'denied']);
// B2 answers 403 for an exceeded download or transaction cap as well as for
// refused credentials; its error text names the cap.
const CAP_EXCEEDED = /\bcaps?\b[^<]{0,60}\bexceeded|\bexceeded\b[^<]{0,60}\bcaps?\b/i;

function storageError(reason, retry) {
  const error = new Error(reason);
  error.reason = reason;
  error.retry = retry;
  return error;
}

// Reads at most `limit` bytes of a response body; a longer body is cut off there.
async function readSome(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const part of response.body || []) {
    chunks.push(Buffer.from(part));
    size += part.length;
    if (size >= limit) { await response.body.cancel?.().catch(() => {}); break; }
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

function createReferenceStore(rows, { env = process.env, fetcher = fetch, cacheBytes = DEFAULT_REFERENCE_CACHE_BYTES,
  attempts = STORAGE_ATTEMPTS, timeoutMs = STORAGE_TIMEOUT_MS, backoffMs = STORAGE_BACKOFF_MS,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  timeoutSignal = ms => AbortSignal.timeout(ms),
  probeOkMs = PROBE_OK_MS, probeFailedMs = PROBE_FAILED_MS, probeTries = PROBE_TRIES, probeTimeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const byId = new Map(validateRows(rows).map(row => [row.id, row]));
  const probeRow = rows[0];
  const cache = new Map(); // id -> { reference, bytes }, least recently used first
  let cachedBytes = 0;
  const inFlight = new Map();
  let probeState = null;
  let probing = null;
  function remember(id, reference) {
    const bytes = reference.audio.length + Buffer.byteLength(reference.text);
    if (!(bytes <= cacheBytes)) return;
    if (cache.has(id)) cachedBytes -= cache.get(id).bytes;
    cache.delete(id);
    cache.set(id, { reference, bytes });
    cachedBytes += bytes;
    while (cachedBytes > cacheBytes) {
      const [oldest, entry] = cache.entries().next().value;
      cache.delete(oldest);
      cachedBytes -= entry.bytes;
    }
  }
  async function readOnce(key, limit, perAttemptMs) {
    let url;
    try { url = signedGet(key, env); } catch (error) {
      throw storageError(/not configured/.test(error.message) ? 'not configured' : 'invalid object', false);
    }
    let response;
    try {
      response = await fetcher(url, { signal: timeoutSignal(perAttemptMs), redirect: 'error' });
    } catch (error) {
      throw storageError(error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network', true);
    }
    if (!response.ok) {
      const status = Number(response.status);
      if (status === 403) {
        // A cap is not a credential fault: read the start of B2's short error text.
        let text = '';
        try { text = (await readSome(response, 4096)).toString('utf8'); } catch (_) {}
        throw storageError(CAP_EXCEEDED.test(text) ? 'cap exceeded' : 'denied', false);
      }
      await response.body?.cancel?.().catch(() => {});
      if (status === 401) throw storageError('denied', false);
      if (status === 404) throw storageError('missing', false);
      if (status === 429) throw storageError('rate limited', true);
      if (status === 408 || status >= 500) throw storageError('server', true);
      throw storageError('refused', false);
    }
    if (Number(response.headers.get('content-length')) > limit) throw storageError('size', false);
    const chunks = [];
    let size = 0;
    try {
      for await (const part of response.body) {
        size += part.length;
        if (size > limit) { await response.body.cancel?.().catch(() => {}); throw storageError('size', false); }
        chunks.push(Buffer.from(part));
      }
    } catch (error) {
      if (error && error.reason) throw error;
      throw storageError(error && error.name === 'TimeoutError' ? 'timeout' : 'network', true);
    }
    return Buffer.concat(chunks);
  }
  async function read(key, limit, { tries = attempts, perAttemptMs = timeoutMs } = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await readOnce(key, limit, perAttemptMs);
      } catch (error) {
        const retry = Boolean(error && error.retry);
        if (!retry || attempt >= tries) {
          // Never pass a signed storage URL or original sample transcript into public/logged errors.
          const failure = new Error('The selected voice reference could not be loaded.');
          failure.reason = (error && error.reason) || 'error';
          failure.permanent = !retry;
          throw failure;
        }
        await sleep(backoffMs * 3 ** (attempt - 1) + Math.floor(Math.random() * backoffMs / 2));
      }
    }
  }
  async function load(id) {
    if (!REFERENCE_ID.test(id) || !byId.has(id)) throw new Error('That selected voice is unavailable.');
    if (cache.has(id)) { const hit = cache.get(id); cache.delete(id); cache.set(id, hit); return hit.reference; }
    if (inFlight.has(id)) return inFlight.get(id);
    const row = byId.get(id);
    const promise = (async () => {
      const started = now();
      const [audio, metadataBytes] = await Promise.all([read(row.referenceKey, 1024 * 1024), read(row.metadataKey, 65536)]);
      // A real load that worked answers the readiness question as well as a probe would.
      probeState = { ok: true, at: now(), ms: now() - started };
      const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
      if (hash(audio) !== row.sha256 || hash(metadataBytes) !== row.metadataSha256) throw new Error('The selected voice reference failed its integrity check.');
      let metadata;
      try { metadata = JSON.parse(metadataBytes); } catch (_) { throw new Error('Invalid selected voice metadata.'); }
      if (metadata.sha256 !== row.sha256 || typeof metadata.transcript !== 'string' ||
          !metadata.transcript.trim() || metadata.transcript.length > 8000 || metadata.speakerCount !== 1) {
        throw new Error('Invalid selected voice metadata.');
      }
      const reference = { audio, text: metadata.transcript };
      remember(id, reference);
      return reference;
    })();
    inFlight.set(id, promise);
    try { return await promise; } finally { inFlight.delete(id); }
  }
  const stats = () => ({ entries: cache.size, bytes: cachedBytes, limitBytes: cacheBytes });
  // Readiness: one small signed GET through the same path every voice uses
  // (credentials, bucket, signing, network), remembered for a few minutes.
  // Never throws. `permanent` marks a fault that waiting cannot heal;
  // `settingsFault` marks the narrower set that means broken settings.
  async function probe() {
    const at = now();
    if (probeState && at - probeState.at < (probeState.ok ? probeOkMs : probeFailedMs)) return probeState;
    if (probing) return probing;
    probing = (async () => {
      const started = now();
      const failed = (reason, permanent) => ({ ok: false, at: now(), ms: now() - started, reason, permanent,
        settingsFault: SETTINGS_FAULTS.has(reason) });
      try {
        const bytes = await read(probeRow.metadataKey, 65536, { tries: probeTries, perAttemptMs: probeTimeoutMs });
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== probeRow.metadataSha256) {
          probeState = failed('integrity', true);
        } else {
          probeState = { ok: true, at: now(), ms: now() - started };
        }
      } catch (error) {
        probeState = failed(error.reason || 'error', Boolean(error.permanent));
      }
      return probeState;
    })();
    try { return await probing; } finally { probing = null; }
  }
  return { load, stats, probe };
}

async function fishBody(payload, id, store) {
  if (!id.startsWith('ref_')) return { contentType: 'application/json', body: JSON.stringify({ ...payload, reference_id: id }) };
  if (!store) throw new Error('The selected voice catalog is unavailable.');
  const reference = await store.load(id);
  return { contentType: 'application/msgpack', body: Buffer.from(encode({ ...payload, references: [reference] })) };
}

function selectedPicker(rows, legacy) {
  validateRows(rows);
  const voices = rows.map(row => row.label);
  const oldNames = rows.flatMap(row => row.aliases || []);
  const hidden = [...new Set([...legacy.voices, ...legacy.hidden, ...legacy.aliases,
    ...Object.keys(legacy.map), ...Object.values(legacy.map), ...Object.keys(legacy.renames), ...Object.values(legacy.renames), ...oldNames])]
    .filter(label => typeof label === 'string' && !voices.includes(label));
  const sections = new Map();
  rows.forEach(row => row.categories.forEach(name => {
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(row.label);
  }));
  return {
    // Retired row names stay resolvable through hidden + renames, but are not served as
    // aliases: the fork's call-lane name match is a substring search over aliases, and a
    // retired name such as "Holly Hawkins" must never be matched to a character named Holly.
    voices, custom: voices, hidden, aliases: [...new Set([...legacy.aliases, ...rows.map(row => 'fish:' + row.id)])],
    retainedFish: [...new Set(Object.entries(legacy.map).filter(([, target]) => typeof target === 'string' && target.startsWith('fish:')).flatMap(([label, target]) => [label, target]))],
    categories: [...sections].map(([name, labels]) => ({ name, voices: labels })),
    renames: { ...legacy.renames, ...Object.fromEntries(rows.flatMap(row => (row.aliases || []).map(name => [name, row.label]))) },
    describe: { ...legacy.describe, ...Object.fromEntries(rows.map(row => [row.label, row.description])) },
    tags: { ...legacy.tags, ...Object.fromEntries(rows.map(row => [row.label, row.tag])) }, fish: voices,
  };
}

function installSelectedBindings(rows, voiceMap, auditionVoices) {
  validateRows(rows);
  const staged = new Map(Object.entries(voiceMap));
  const folded = new Map(Object.entries(voiceMap).map(([name, id]) => [name.toLowerCase(), id]));
  for (const row of rows) {
    const binding = 'fish:' + row.id;
    for (const name of [row.label, binding, ...(row.aliases || [])]) {
      if ((staged.has(name) && staged.get(name) !== binding) ||
          (folded.has(name.toLowerCase()) && folded.get(name.toLowerCase()) !== binding)) throw new Error('Selected voice label collision.');
      staged.set(name, binding); folded.set(name.toLowerCase(), binding);
    }
  }
  // Nothing changes until every new name and historical alias has passed.
  for (const row of rows) {
    const binding = 'fish:' + row.id;
    for (const name of [row.label, binding, ...(row.aliases || [])]) {
      voiceMap[name] = binding;
      auditionVoices.set(name, row);
    }
  }
}

module.exports = { signedGet, validateRows, createReferenceStore, fishBody, selectedPicker, installSelectedBindings, DEFAULT_REFERENCE_CACHE_BYTES };
