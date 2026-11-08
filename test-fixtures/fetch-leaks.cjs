'use strict';
// Preload for error-text-wire.test.js: every outgoing fetch fails with an error whose text carries what an error can carry: a path inside
// the container, a key in a URL and a Bearer token. FETCH_FIXTURE_MODE=ok makes GitHub's contents API answer a file whose TEXT holds the same
// things (a file is data, not an error: a success answer must come back untouched).
const FILE_TEXT = "see /app/x.js and https://svc.test/p?key=abc123 and Bearer abcdefgh12345678 in this file";
global.fetch = async (url) => {
  if (process.env.FETCH_FIXTURE_MODE === 'ok' && String(url).startsWith('https://api.github.com/repos/o/r/contents/')) {
    return Response.json({ content: Buffer.from(FILE_TEXT).toString('base64'), sha: 'abc', path: 'p' });
  }
  throw new Error('connect failed: open "/app/node_modules/x/y.js" via https://svc.test/path?key=SUPERSECRET123 and Authorization: Bearer ghp_0a1b0a1b0a1b0a1b0a1b0a1b0a1b0a1b0a1b');
};
