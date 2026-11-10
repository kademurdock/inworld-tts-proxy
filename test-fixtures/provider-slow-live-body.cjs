// Nov 10 2026: a Fish answer that is slow but ALIVE: headers at once, then a piece of audio every LIVE_PIECE_MS until the clip is whole,
// taking longer in all than FISH_TIMEOUT_MS and never going quiet for that long. Loaded AFTER provider.cjs (it wraps that fixture's
// fetch). Like undici's, the body ends with an AbortError if the caller's own signal fires. Each Fish call is written to STALL_RECEIPT.
const fs = require('fs');
const inner = global.fetch;
let fishCalls = 0;
global.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.fish.audio/v1/tts') return inner(url, options);
  fishCalls += 1;
  fs.appendFileSync(process.env.STALL_RECEIPT, `fish call ${fishCalls}\n`);
  const pieces = Number(process.env.LIVE_PIECES || 20);
  const everyMs = Number(process.env.LIVE_PIECE_MS || 100);
  const signal = options.signal;
  const piece = Buffer.alloc(4800); // 0.1 s of 24 kHz s16 mono, a tone and not silence (the pause cap leaves it alone)
  for (let i = 0; i < 2400; i++) piece.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
  const body = new ReadableStream({
    start(controller) {
      let sent = 0;
      let done = false;
      const tick = setInterval(() => {
        if (done) return;
        controller.enqueue(new Uint8Array(piece));
        sent += 1;
        if (sent >= pieces) { done = true; clearInterval(tick); controller.close(); }
      }, everyMs);
      const abort = () => {
        if (done) return;
        done = true;
        clearInterval(tick);
        controller.error(new DOMException('This operation was aborted', 'AbortError'));
      };
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'audio/pcm' } });
};
