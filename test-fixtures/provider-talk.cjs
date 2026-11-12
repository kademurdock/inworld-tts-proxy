// Nov 12 2026: the Inworld stub for talk-delivery-wire.test.js. Records every request body. With TALK_REJECT=1 it refuses
// (400) any request whose instruction carries the talk frame, the way a change on Inworld's side would; with
// TALK_REJECT=all it refuses every request (an unrelated 400), so the test can tell the two apart.
const fs = require('fs');
const pcm = Buffer.alloc(24000); for (let i = 0; i < 12000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
const wav = Buffer.alloc(44 + pcm.length); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
global.fetch = async (url, options) => {
  const u = String(url);
  if (!['https://api.inworld.ai/tts/v1/voice', 'https://api.inworld.ai/tts/v1/voice:stream'].includes(u)) throw Error('External network blocked by fixture');
  const body = JSON.parse(options.body);
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ url: u, body }) + '\n');
  const framed = /close friend/.test(body.instruction || '');
  if (process.env.TALK_REJECT === 'all' || (process.env.TALK_REJECT === '1' && framed)) {
    return new Response(JSON.stringify({ code: 3, message: 'INVALID_ARGUMENT: test refusal' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.endsWith(':stream')) {
    return new Response(JSON.stringify({ result: { audioContent: wav.toString('base64') } }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  return Response.json({ audioContent: wav.toString('base64') });
};
