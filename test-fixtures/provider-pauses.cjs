// Fake Inworld for the pause-limiter wire test: every request answers with 300 ms of speech, one
// full second of silence, then 300 ms of speech (24 kHz mono 16-bit), buffered or streamed.
const fs = require('fs');
const SR = 24000;
function part(ms, amp) {
  const n = Math.round((SR * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  if (amp) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * amp), i * 2);
  return b;
}
const pcm = Buffer.concat([part(300, 3000), part(1000, 0), part(300, 3000)]);
function header(dataLength) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(Math.min(0xffffffff, 36 + dataLength), 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataLength, 40);
  return h;
}
const wav = Buffer.concat([header(pcm.length), pcm]);
global.fetch = async (url, options) => {
  const u = String(url);
  if (!['https://api.inworld.ai/tts/v1/voice', 'https://api.inworld.ai/tts/v1/voice:stream'].includes(u)) throw Error('External network blocked by fixture');
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ url: u, body: JSON.parse(options.body) }) + '\n');
  if (u.endsWith(':stream')) {
    // first line: a real WAV header and a little speech; the rest is raw PCM in odd-sized pieces
    const lines = [Buffer.concat([header(0xffffffff), pcm.subarray(0, 1000)])];
    for (let at = 1000; at < pcm.length; at += 4801) lines.push(pcm.subarray(at, Math.min(pcm.length, at + 4801)));
    return new Response(lines.map((b) => JSON.stringify({ result: { audioContent: b.toString('base64') } })).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  return Response.json({ audioContent: wav.toString('base64') });
};
