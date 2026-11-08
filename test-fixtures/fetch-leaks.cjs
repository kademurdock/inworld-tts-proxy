'use strict';
// Preload for error-text-wire.test.js: every outgoing fetch fails with an error whose text carries what an error can carry: a path inside
// the container, a key in a URL and a Bearer token. FETCH_FIXTURE_MODE changes what the network does:
//   ok          GitHub's contents API answers a file whose TEXT holds the same things (a file is data, not an error: a success answer
//               must come back untouched)
//   seat-error  the site logs the test seat in, then answers the speech request 500 with a plain text that holds a path, a key and a token
//   seat-stt    the site logs the test seat in, answers the speech request with audio, and the transcription request with a plain text that
//               holds a path and a key
const FILE_TEXT = "see /app/x.js and https://svc.test/p?key=abc123 and Bearer abcdefgh12345678 in this file";
const mode = () => process.env.FETCH_FIXTURE_MODE;
global.fetch = async (url) => {
  const u = String(url);
  if (mode() === 'ok' && u.startsWith('https://api.github.com/repos/o/r/contents/')) {
    return Response.json({ content: Buffer.from(FILE_TEXT).toString('base64'), sha: 'abc', path: 'p' });
  }
  if ((mode() === 'seat-error' || mode() === 'seat-stt') && u.startsWith('http://127.0.0.1:9/api/')) {
    if (u.endsWith('/api/auth/login')) return Response.json({ token: 'seat-token' });
    if (u.endsWith('/api/files/speech/tts/manual')) {
      if (mode() === 'seat-error') return new Response('the site failed at /app/api/x.js with ?key=SECRET99 and Bearer abcdefgh12345678', { status: 500, headers: { 'Content-Type': 'text/plain' } });
      return new Response(Buffer.alloc(64, 1), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }
    if (u.endsWith('/api/files/speech/stt')) return new Response('transcript read from /app/y.js ?key=SECRET77', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  throw new Error('connect failed: open "/app/node_modules/x/y.js" via https://svc.test/path?key=SUPERSECRET123 and Authorization: Bearer ghp_0a1b0a1b0a1b0a1b0a1b0a1b0a1b0a1b0a1b');
};
