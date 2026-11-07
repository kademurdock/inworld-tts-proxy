'use strict';
// Preload for transcription-wire.test.js: Deepgram answers from a fixture, every other URL is blocked.
//   PROVIDER_RECEIPT     a file; one JSON line per request that reached Deepgram (url, content type, bytes, authorization)
//   FIXTURE_TRANSCRIPT   (optional) what Deepgram "heard"; default 'hello from the fixture'
// (node's own http module is untouched, so the test can still call the server it spawned.)
const fs = require('node:fs');

global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.deepgram.com/v1/listen?')) throw Error('External network blocked by fixture');
  const headers = options.headers || {};
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({
    url: u,
    contentType: headers['Content-Type'],
    bytes: options.body ? options.body.length : 0,
    authorization: headers.Authorization,
  }) + '\n');
  return Response.json({
    results: { channels: [{ alternatives: [{ transcript: process.env.FIXTURE_TRANSCRIPT || 'hello from the fixture', confidence: 0.99 }] }] },
    metadata: { duration: 1.5 },
  });
};
