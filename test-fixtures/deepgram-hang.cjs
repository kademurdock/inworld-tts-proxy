'use strict';
// Preload for transcription-timeout.test.js: a Deepgram that takes the audio and then never answers. It ends the wait only when the
// request carries an abort signal (as a real fetch would reject), and records whether it did (hasSignal) in PROVIDER_RECEIPT.
// DEEPGRAM_FIXTURE_MODE=reset makes it fail at once instead, the way a dropped connection does ("fetch failed").
// Every other URL is blocked.
const fs = require('node:fs');

global.fetch = (url, options = {}) => new Promise((resolve, reject) => {
  const u = String(url);
  if (!u.startsWith('https://api.deepgram.com/v1/listen?')) return reject(Error('External network blocked by fixture'));
  const s = options.signal;
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ url: u, bytes: options.body ? options.body.length : 0, hasSignal: Boolean(s) }) + '\n');
  if (process.env.DEEPGRAM_FIXTURE_MODE === 'reset') return reject(new TypeError('fetch failed'));
  if (s) {
    if (s.aborted) return reject(s.reason);
    s.addEventListener('abort', () => reject(s.reason), { once: true });
  }
  return undefined; // otherwise the audio went in and nothing ever comes back
});
