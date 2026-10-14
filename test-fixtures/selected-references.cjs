const fs = require('node:fs');
const crypto = require('node:crypto');
const Module = require('node:module');
const { decode } = require('@msgpack/msgpack');
const audio = Buffer.from('offline selected reference');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha = hash(audio);
const metadata = Buffer.from(JSON.stringify({ sha256: sha, speakerCount: 1, transcript: 'A private reference phrase.' }));
const row = { id: 'ref_0123456789abcdef', label: 'Clear warm voice · cedarbrook', tag: 'cedarbrook',
  description: 'A warm clear voice.', categories: ['Women, Warm & Soothing'], sha256: sha,
  metadataSha256: hash(metadata), referenceKey: `voice-references/20261014/${sha}.mp3`,
  metadataKey: `voice-references/20261014/${sha}.json`, testedModel: 'drama-3' };
if (process.env.SELECTED_TEST_GROUP === 'kids') row.categories = ['Characters, Bright & Lively', 'Kids and teens, Bright & Lively'];
if (process.env.SELECTED_TEST_GROUP === 'characters') row.categories = ['Characters, Clear & Neutral'];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './selected-voices.json') return { voices: [row] };
  return originalLoad.call(this, request, parent, isMain);
};
const pcm = Buffer.alloc(48000);
for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
global.fetch = async (url, options) => {
  const u = String(url);
  if (u.startsWith('https://s3.us-east-005.backblazeb2.com/test-bucket/voice-references/')) return new Response(u.includes('.mp3?') ? audio : metadata);
  if (u === 'https://api.fish.audio/v1/tts') {
    const packed = options.headers['Content-Type'] === 'application/msgpack';
    const body = packed ? decode(options.body) : JSON.parse(options.body);
    fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ packed, model: options.headers.model,
      reference_id: body.reference_id, references: body.references?.map(r => ({ audio: Buffer.from(r.audio).toString(), text: r.text })), text: body.text }) + '\n');
    return new Response(pcm);
  }
  throw Error('Unexpected network destination');
};
