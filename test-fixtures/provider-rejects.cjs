'use strict';
// Preload for answer-text.test.js: Inworld and Fish refuse every synthesis with a 400 whose text names a file on the provider's disk,
// the way an upstream error can carry a path or an internal name. Every other URL is blocked.
//   PROVIDER_RECEIPT   a file; one JSON line per request that reached a provider
const fs = require('node:fs');

global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (!['https://api.inworld.ai/tts/v1/voice', 'https://api.inworld.ai/tts/v1/voice:stream', 'https://api.fish.audio/v1/tts'].includes(u)) throw Error('External network blocked by fixture');
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ url: u, bytes: options.body ? options.body.length : 0 }) + '\n');
  return new Response(JSON.stringify({ message: 'voice file /srv/inworld/private/voices.db is locked' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};
