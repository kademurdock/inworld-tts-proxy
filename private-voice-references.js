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
  });
  return rows;
}

function createReferenceStore(rows, { env = process.env, fetcher = fetch, cacheSize = 24 } = {}) {
  const byId = new Map(validateRows(rows).map(row => [row.id, row]));
  const cache = new Map();
  const inFlight = new Map();
  async function read(key, limit) {
    try {
      const response = await fetcher(signedGet(key, env), { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error('storage');
      if (Number(response.headers.get('content-length')) > limit) throw new Error('size');
      const chunks = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('size'); }
        chunks.push(Buffer.from(part));
      }
      return Buffer.concat(chunks);
    } catch (_) {
      // Never pass a signed storage URL or original sample transcript into public/logged errors.
      throw new Error('The selected voice reference could not be loaded.');
    }
  }
  async function load(id) {
    if (!REFERENCE_ID.test(id) || !byId.has(id)) throw new Error('That selected voice is unavailable.');
    if (cache.has(id)) { const hit = cache.get(id); cache.delete(id); cache.set(id, hit); return hit; }
    if (inFlight.has(id)) return inFlight.get(id);
    const row = byId.get(id);
    const promise = (async () => {
      const [audio, metadataBytes] = await Promise.all([read(row.referenceKey, 1024 * 1024), read(row.metadataKey, 65536)]);
      const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
      if (hash(audio) !== row.sha256 || hash(metadataBytes) !== row.metadataSha256) throw new Error('The selected voice reference failed its integrity check.');
      let metadata;
      try { metadata = JSON.parse(metadataBytes); } catch (_) { throw new Error('Invalid selected voice metadata.'); }
      if (metadata.sha256 !== row.sha256 || typeof metadata.transcript !== 'string' ||
          !metadata.transcript.trim() || metadata.transcript.length > 8000 || metadata.speakerCount !== 1) {
        throw new Error('Invalid selected voice metadata.');
      }
      const reference = { audio, text: metadata.transcript };
      cache.set(id, reference);
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      return reference;
    })();
    inFlight.set(id, promise);
    try { return await promise; } finally { inFlight.delete(id); }
  }
  return { load };
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
  const hidden = [...new Set([...legacy.voices, ...legacy.hidden, ...legacy.aliases,
    ...Object.keys(legacy.map), ...Object.values(legacy.map), ...Object.keys(legacy.renames), ...Object.values(legacy.renames)])]
    .filter(label => typeof label === 'string' && !voices.includes(label));
  const sections = new Map();
  rows.forEach(row => row.categories.forEach(name => {
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(row.label);
  }));
  return {
    voices, custom: voices, hidden, aliases: [...new Set([...legacy.aliases, ...rows.map(row => 'fish:' + row.id)])],
    retainedFish: [...new Set(Object.entries(legacy.map).filter(([, target]) => typeof target === 'string' && target.startsWith('fish:')).flatMap(([label, target]) => [label, target]))],
    categories: [...sections].map(([name, labels]) => ({ name, voices: labels })),
    renames: legacy.renames, describe: { ...legacy.describe, ...Object.fromEntries(rows.map(row => [row.label, row.description])) },
    tags: { ...legacy.tags, ...Object.fromEntries(rows.map(row => [row.label, row.tag])) }, fish: voices,
  };
}

module.exports = { signedGet, validateRows, createReferenceStore, fishBody, selectedPicker };
