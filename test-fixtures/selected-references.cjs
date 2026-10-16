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
  if (u.startsWith('https://s3.us-east-005.backblazeb2.com/test-bucket/voice-references/')) {
    // SELECTED_TEST_STORAGE simulates a storage fault: the object gone, or B2's 403 for an exceeded cap.
    if (process.env.SELECTED_TEST_STORAGE === 'missing') return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    if (process.env.SELECTED_TEST_STORAGE === 'cap') return new Response('<Error><Code>AccessDenied</Code><Message>Cannot download file, download bandwidth or transaction (Class B) cap exceeded.</Message></Error>', { status: 403 });
    if (process.env.SELECTED_TEST_STORAGE === 'denied') return new Response('<Error><Code>InvalidAccessKeyId</Code><Message>Malformed Access Key Id</Message></Error>', { status: 403 });
    return new Response(u.includes('.mp3?') ? audio : metadata);
  }
  if (u === 'https://api.fish.audio/v1/tts') {
    const packed = options.headers['Content-Type'] === 'application/msgpack';
    const body = packed ? decode(options.body) : JSON.parse(options.body);
    fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ packed, model: options.headers.model,
      reference_id: body.reference_id, references: body.references?.map(r => ({ audio: Buffer.from(r.audio).toString(), text: r.text })), text: body.text, prosody: body.prosody }) + '\n');
    return new Response(pcm);
  }
  if (u === 'https://api.inworld.ai/tts/v1/voice') {
    const body = JSON.parse(options.body);
    fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ provider: 'inworld', ...body }) + '\n');
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    return Response.json({ audioContent: wav.toString('base64') });
  }
  throw Error('Unexpected network destination');
};
