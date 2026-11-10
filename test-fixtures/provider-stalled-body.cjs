// Nov 10 2026: a Fish answer whose headers arrive at once and whose audio never finishes, the way a provider stalls mid-clip.
// Loaded AFTER provider.cjs (it wraps that fixture's fetch). The stalled body ends with an AbortError when the caller's own
// signal fires, exactly as undici's does; with no signal it never ends. STALL_FIRST_N says how many Fish calls stall (default: all).
const fs = require('fs');
const inner = global.fetch;
let fishCalls = 0;
global.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.fish.audio/v1/tts') return inner(url, options);
  fishCalls += 1;
  fs.appendFileSync(process.env.STALL_RECEIPT, `fish call ${fishCalls}\n`);
  const stallFirst = Number(process.env.STALL_FIRST_N || Infinity);
  if (fishCalls > stallFirst) return inner(url, options);
  const signal = options.signal;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2000)); // the clip begins...
      const abort = () => controller.error(new DOMException('This operation was aborted', 'AbortError'));
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
      // ...and never ends.
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'audio/pcm' } });
};
