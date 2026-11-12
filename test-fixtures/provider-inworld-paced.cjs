// Nov 12 2026 (GW-9): an Inworld (buffered lane) that takes INWORLD_FIXTURE_MS per chunk, or never answers with INWORLD_STALL=1.
// Loaded AFTER provider.cjs (it wraps that fixture's fetch). Each call writes a start and an end line to PACED_RECEIPT with how
// many calls were running then and whether the call was the live request's (its text starts with "Live"). Like undici, a call
// ends with an AbortError when the caller's own signal fires.
const fs = require('fs');
const inner = global.fetch;
let running = 0;
global.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.inworld.ai/tts/v1/voice') return inner(url, options);
  const text = String(JSON.parse(options.body).text || '');
  const live = /^\s*Live/.test(text);
  running += 1;
  fs.appendFileSync(process.env.PACED_RECEIPT, JSON.stringify({ ev: 'start', live, running, at: Date.now() }) + '\n');
  const done = (ev) => { running -= 1; fs.appendFileSync(process.env.PACED_RECEIPT, JSON.stringify({ ev, live, running, at: Date.now() }) + '\n'); };
  const signal = options.signal;
  try {
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(t); reject(new DOMException('This operation was aborted', 'AbortError')); };
      const t = process.env.INWORLD_STALL === '1' ? null : setTimeout(resolve, Number(process.env.INWORLD_FIXTURE_MS || 200));
      if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
    });
  } catch (e) {
    done('aborted');
    throw e;
  }
  done('end');
  return inner(url, options);
};
