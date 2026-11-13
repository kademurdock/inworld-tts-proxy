// Nov 12 2026 (GW-10): an Inworld voice:stream that sends its audio as three NDJSON lines 300 ms apart (the first carries the WAV
// header). Loaded AFTER provider.cjs (it wraps that fixture's fetch; the buffered lane still answers from there). The words of the
// request pick a misbehaviour: "stereo" or "oddrate" send a format the phone sink cannot take, "dropearly" sends the WAV header
// alone and then drops, "dropmid" drops after two audio lines, "stallfirst" opens and never sends a byte, "stallmid" sends two audio
// lines and then goes quiet with the stream left open (Nov 13 2026, sweep 1.3). Every stream call is written to PROVIDER_RECEIPT by provider.cjs
// only when it falls through, so this fixture appends its own line to STREAM_RECEIPT.
const fs = require('fs');
const inner = global.fetch;
function wavHeader(rate, channels) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(0xffffffff, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(0xffffffff, 40);
  return h;
}
function tone(rate, channels, sec) {
  const n = Math.round(rate * sec);
  const b = Buffer.alloc(n * 2 * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) b.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / rate)), (i * channels + c) * 2);
  return b;
}
const line = (buf) => JSON.stringify({ result: { audioContent: buf.toString('base64') } }) + '\n';
global.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.inworld.ai/tts/v1/voice:stream') return inner(url, options);
  const text = String(JSON.parse(options.body).text || '').toLowerCase();
  if (process.env.STREAM_RECEIPT) fs.appendFileSync(process.env.STREAM_RECEIPT, JSON.stringify({ text: text.slice(0, 40), at: Date.now() }) + '\n');
  const rate = text.includes('oddrate') ? 22050 : 24000;
  const channels = text.includes('stereo') ? 2 : 1;
  const parts = [tone(rate, channels, 0.4), tone(rate, channels, 0.4), tone(rate, channels, 0.4)];
  const lines = text.includes('dropearly') ? [wavHeader(rate, channels)] : [Buffer.concat([wavHeader(rate, channels), parts[0]]), parts[1], parts[2]];
  const dropAfter = text.includes('dropearly') ? 1 : text.includes('dropmid') ? 2 : Infinity;
  const stallAfter = text.includes('stallfirst') ? 0 : text.includes('stallmid') ? 2 : Infinity;
  const signal = options.signal;
  let done = false; // the reader may cancel (a format the phone sink cannot take): stop sending then
  const body = new ReadableStream({
    cancel() { done = true; },
    start(controller) {
      let sent = 0;
      const send = () => {
        if (done) return;
        if (sent >= stallAfter) return; // quiet, and still open: only the caller's abort ends it
        if (sent >= dropAfter) { done = true; controller.error(new TypeError('terminated')); return; }
        if (sent >= lines.length) { done = true; controller.close(); return; }
        try { controller.enqueue(new TextEncoder().encode(line(lines[sent++]))); } catch { done = true; return; }
        setTimeout(send, 300);
      };
      send();
      if (signal) signal.addEventListener('abort', () => { if (!done) { done = true; controller.error(new DOMException('This operation was aborted', 'AbortError')); } }, { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
};
