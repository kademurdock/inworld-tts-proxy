// Fake Inworld (and Fish) for the timing wire test. TIMING_FIXTURE picks the answer:
//   garden (default): the recorded Nov 11 answer (inworld-timing/rest_word_full.json), with a generated
//     tone that is loud where a viseme is spoken and silent where it is `sil`, as long as the visemes.
//   pauses: 300 ms speech, 1 s silence, 300 ms speech, with matching visemes and two words, so the
//     pause limiter and the seams have something to move.
// Like Inworld, lipsyncAlignment comes back only when the request had lipsyncConfig, and wordAlignment
// only with timestampType WORD. A chunk whose text contains "nolip" comes back without lipsyncAlignment.
// A chunk whose text contains "refusetiming" is refused (400) while it asks for timings, and spoken without them.
const fs = require('fs');
const path = require('path');
const SR = 24000;
function tone(ms, amp) {
  const n = Math.round((SR * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  if (amp) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * amp), i * 2);
  return b;
}
function header(dataLength) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + dataLength, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataLength, 40);
  return h;
}
let info, pcm;
if (process.env.TIMING_FIXTURE === 'pauses') {
  pcm = Buffer.concat([tone(300, 3000), tone(1000, 0), tone(300, 3000)]);
  info = {
    wordAlignment: {
      words: ['Hello', ' ', 'there', '.', ''],
      wordStartTimeSeconds: [0, 0.3, 1.3, 1.6, 1.6],
      wordEndTimeSeconds: [0.3, 1.3, 1.6, 1.6, 1.6],
      phoneticDetails: [
        { wordIndex: 0, phones: [{ phoneSymbol: 'h', startTimeSeconds: 0, durationSeconds: 0.1, visemeSymbol: 'aei' }, { phoneSymbol: 'o', startTimeSeconds: 0.1, durationSeconds: 0.2, visemeSymbol: 'o' }], isPartial: false },
        { wordIndex: 2, phones: [{ phoneSymbol: 'e', startTimeSeconds: 1.3, durationSeconds: 0.3, visemeSymbol: 'ee' }], isPartial: false },
      ],
    },
    lipsyncAlignment: { visemes: ['aa', 'sil', 'oh'], visemeStartTimeSeconds: [0, 0.3, 1.3], visemeEndTimeSeconds: [0.3, 1.3, 1.6] },
  };
} else {
  info = JSON.parse(fs.readFileSync(path.join(__dirname, 'inworld-timing/rest_word_full.json'), 'utf8')).timestampInfo;
  const la = info.lipsyncAlignment;
  const parts = [];
  for (let i = 0; i < la.visemes.length; i++) {
    const ms = (la.visemeEndTimeSeconds[i] - la.visemeStartTimeSeconds[i]) * 1000;
    parts.push(tone(ms, la.visemes[i] === 'sil' ? 0 : 3000));
  }
  pcm = Buffer.concat(parts);
}
const wav = Buffer.concat([header(pcm.length), pcm]);
global.fetch = async (url, options) => {
  const u = String(url);
  if (!['https://api.inworld.ai/tts/v1/voice', 'https://api.inworld.ai/tts/v1/voice:stream', 'https://api.fish.audio/v1/tts'].includes(u)) throw Error('External network blocked by fixture');
  const body = JSON.parse(options.body);
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ url: u, body }) + '\n');
  if (u.includes('fish.audio')) return new Response(pcm);
  if (u.endsWith(':stream')) return new Response(JSON.stringify({ result: { audioContent: wav.toString('base64') } }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  if (/refusetiming/.test(body.text) && (body.lipsyncConfig || body.timestampType)) return Response.json({ code: 3, message: 'fixture: timing fields refused' }, { status: 400 });
  const timestampInfo = {};
  if (body.timestampType === 'WORD') timestampInfo.wordAlignment = info.wordAlignment;
  if (body.lipsyncConfig && !/nolip/.test(body.text)) timestampInfo.lipsyncAlignment = info.lipsyncAlignment;
  return Response.json({
    audioContent: wav.toString('base64'),
    usage: { processedCharactersCount: body.text.length, modelId: 'inworld-tts-2' },
    ...(Object.keys(timestampInfo).length ? { timestampInfo } : {}),
  });
};
