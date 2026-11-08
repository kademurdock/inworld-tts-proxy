'use strict';
// Nov 8 2026. The secret-gated routes (railway, github, librechat, approvals) put an error's own text in their answers, on purpose: the callers
// are Forge (an LLM that diagnoses from it) and the bridge's nightly battery (it matches /403|forbidden/ in the /librechat/ask error). The text
// is what those routes are for; but it came straight from `err.message`, and a message can carry a path inside the container, a Bearer token or a
// `?key=` in a URL. error-text.js cleans that out of an error ANSWER (status 400 and up; a success answer is never touched) and keeps every other
// word. This file is the unit half: what is cleaned, what is not, and that cleaning is quick on any input. (error-text-wire.test.js is the server.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { scrubText, scrubAnswer, scrubErrorAnswers } = require('./error-text');

const H = '<hidden>';
const P = '<path>';

test('paths inside the container become <path>; the words around them stay', () => {
  const table = [
    ["ENOENT: no such file or directory, open '/app/data/voices.json'", `ENOENT: no such file or directory, open '${P}'`],
    ['at Object.<anonymous> (/app/librechat.js:123:45)', `at Object.<anonymous> (${P})`],
    ['cannot write /tmp/abc123/out.wav before the end', `cannot write ${P} before the end`],
    ['/var/lib/x and /usr/local/bin/y', `${P} and ${P}`],
    ['the worker died in /tmp', `the worker died in ${P}`],
    ['EACCES at "/root/.config/x"', `EACCES at "${P}"`],
    ['see C:\\Users\\KADE\\work\\x.txt now', `see ${P} now`],
    ['/opt/app/a.js, /etc/passwd; /proc/1/environ', `${P}, ${P}; ${P}`],
  ];
  for (const [input, want] of table) assert.equal(scrubText(input), want, input);
});

test('what only looks like a path is left alone', () => {
  const same = [
    'GET https://api.github.com/repos/o/r/contents/app/server.js failed with 404',
    'Not Found (/repos/o/r/contents/tmp/x)',
    '/approvals/execute needs the approval secret',
    '/appsettings and /tmpfile and /variable and /homepage and /etcetera',
    'GET /librechat/agents -> 502, POST /github/commit -> 400, /v1/audio/speech',
    'project 3f2b8c1e-9d4a-4b7e-8c21-0a1b2c3d4e5f not found',
    'service 0123456789abcdef01234567 is not running',
    'missing key: userId',
    'Token verification failed',
    'Bearer authentication failed',
    'task-12345678901234567890 was queued',
    'the key was rotated; the token budget is 4,000',
    '{"error":"bad input","field":"input"}',
    'docs/readme.md and src/app/main.js (relative, no leading slash)',
    'Voice 462 now speaks as Zondi',
  ];
  for (const input of same) assert.equal(scrubText(input), input, input);
});

test('secrets: Bearer tokens, well-known token shapes, JWTs, key= in a URL, key fields in JSON, key headers', () => {
  const ghp = 'ghp_' + 'a1B2'.repeat(9);
  const sk = 'sk-' + 'A1b2'.repeat(8);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
  const table = [
    ['Authorization: Bearer abcDEF123456789xyz', `Authorization: Bearer ${H}`],
    [`request failed with Bearer ${ghp}`, `request failed with Bearer ${H}`],
    [`bad credentials ${ghp} for o/r`, `bad credentials ${H} for o/r`],
    [`github_pat_${'x9Y8'.repeat(8)} was refused`, `${H} was refused`],
    [`provider said key ${sk} is wrong`, `provider said key ${H} is wrong`],
    [`AIza${'Qw3rT'.repeat(8)} is not allowed`, `${H} is not allowed`],
    [`xoxb-1234567890-abcdefghij`, H],
    [`token ${jwt} has expired`, `token ${H} has expired`],
    ['GET https://svc.test/x?id=1&x-key=SECRETVALUE99 failed', `GET https://svc.test/x?id=1&x-key=${H} failed`],
    ['GET /v1/get?token=abc123&ok=1 -> 401', `GET /v1/get?token=${H}&ok=1 -> 401`],
    ['https://a.test/p?key=AbCdEf and https://b.test/q?apikey=ZZZZ1111', `https://a.test/p?key=${H} and https://b.test/q?apikey=${H}`],
    ['{"api_key":"abc123def456","other":"x"}', `{"api_key":"${H}","other":"x"}`],
    ['{"Password": "hunter22" , "ok": true}', `{"Password": "${H}" , "ok": true}`],
    ['x-key: abcdef123456 was sent', `x-key: ${H} was sent`],
    ['x-api-key=abcdef123456', `x-api-key=${H}`],
    ['connect to mongodb+srv://kade:hunter22@cluster0.example.net/db failed', `connect to mongodb+srv://${H}@cluster0.example.net/db failed`],
    ['proxy http://user:pa55word@10.0.0.1:8080 refused', `proxy http://${H}@10.0.0.1:8080 refused`],
    ['https://api.github.com/repos/o/r reached; mail me at kade@example.com or see https://host.test:8080/path', 'https://api.github.com/repos/o/r reached; mail me at kade@example.com or see https://host.test:8080/path'],
  ];
  for (const [input, want] of table) assert.equal(scrubText(input), want, input);
});

test('a path and a secret in one message', () => {
  const input = `connect failed: open "/app/node_modules/x/y.js" via https://svc.test/path?key=SUPERSECRET123 and Authorization: Bearer ghp_${'0a1b'.repeat(9)}`;
  const out = scrubText(input);
  assert.equal(out, `connect failed: open "${P}" via https://svc.test/path?key=${H} and Authorization: Bearer ${H}`);
});

test('long text is cut at 400 characters with "...", and cleaning twice is cleaning once', () => {
  const long = 'x'.repeat(5000);
  const out = scrubText(long);
  assert.equal(out.length, 403);
  assert.ok(out.endsWith('...'));
  assert.equal(scrubText('y'.repeat(400)), 'y'.repeat(400), 'exactly 400 is not cut');
  assert.equal(scrubText('y'.repeat(401)), 'y'.repeat(400) + '...');
  const messy = "open '/app/a/b.js' with Bearer abcDEF123456789xyz and ?key=SECRET99 " + 'z'.repeat(600);
  assert.equal(scrubText(scrubText(messy)), scrubText(messy));
});

test('anything that is not a string comes back as it was', () => {
  for (const v of [undefined, null, 0, 502, true, { a: 1 }, ['/app/x']]) assert.equal(scrubText(v), v);
});

test('on hostile text it is quick: megabytes of the shapes a pattern could choke on', () => {
  const shapes = {
    'slashes': '/app/'.repeat(4000000),
    'token characters': 'a1'.repeat(10000000),
    'bearer then token characters': 'Bearer ' + 'a'.repeat(10000000),
    'many bearers': 'Bearer abc123def456 '.repeat(1000000),
    'query keys': '?key=a&'.repeat(3000000),
    'json keys': '"api_key":"'.repeat(2000000),
    'backslashes': 'C:\\'.repeat(6000000),
    'path starts': '/tmp'.repeat(5000000),
    'ampersands': '&'.repeat(20000000),
  };
  for (const [label, text] of Object.entries(shapes)) {
    const t0 = process.hrtime.bigint();
    const out = scrubText(text);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 60, `${label}: ${ms.toFixed(1)} ms`);
    assert.ok(out.length <= 403, `${label}: ${out.length} characters`);
  }
});

test('scrubAnswer: the text fields of an error answer, nothing else, and the original object is not touched', () => {
  const body = { error: "open '/app/x.js'", details: 'Bearer abcDEF123456789xyz', detail: 'at /tmp/y', message: '?key=SECRET99', text: 'a reply that mentions /app/x.js', bytes: 5, nested: { error: '/app/z' }, ok: false };
  const copy = JSON.parse(JSON.stringify(body));
  const out = scrubAnswer(body);
  assert.deepEqual(body, copy, 'the original is as it was');
  assert.equal(out.error, `open '${P}'`);
  assert.equal(out.details, `Bearer ${H}`);
  assert.equal(out.detail, `at ${P}`);
  assert.equal(out.message, `?key=${H}`);
  assert.equal(out.text, 'a reply that mentions /app/x.js', 'a reply is not an error text');
  assert.equal(out.bytes, 5);
  assert.deepEqual(out.nested, { error: '/app/z' }, 'only the top level of the answer');
  const object = { message: 'at /app/q', code: 7 };
  assert.deepEqual(scrubAnswer({ error: 'bfl submit 500', detail: object }).detail, object, 'a provider\'s own JSON under `detail` is data, not our text: left as it is');
  assert.equal(out.ok, false);
  for (const v of ['a string', 5, null, undefined, ['/app/x'], true]) assert.equal(scrubAnswer(v), v);
  const circular = { error: '/app/x' };
  circular.self = circular;
  assert.equal(scrubAnswer(circular).error, P);
});

function fakeRes(statusCode) {
  const sent = [];
  const res = { statusCode, json(body) { sent.push(body); return this; }, status(c) { this.statusCode = c; return this; } };
  return { res, sent };
}

test('scrubErrorAnswers: an answer with status 400 or more is cleaned, a success answer never is, and a failure to clean cannot stop the answer', () => {
  const { res, sent } = fakeRes(200);
  scrubErrorAnswers(res);
  res.json({ error: '/app/a' });
  res.status(502).json({ error: "open '/app/b'", details: 'Bearer abcDEF123456789xyz' });
  res.status(400).json({ error: '/tmp/c' });
  res.status(399).json({ error: '/tmp/d' });
  res.status(200).json({ text: '/app/e', error: '/app/e' });
  assert.deepEqual(sent, [
    { error: '/app/a' },
    { error: `open '${P}'`, details: `Bearer ${H}` },
    { error: P },
    { error: '/tmp/d' },
    { text: '/app/e', error: '/app/e' },
  ]);
  const trouble = fakeRes(502);
  scrubErrorAnswers(trouble.res);
  const hostile = {};
  Object.defineProperty(hostile, 'error', { enumerable: true, get() { throw new Error('a getter that throws'); } });
  trouble.res.json(hostile);
  assert.equal(trouble.sent.length, 1, 'the answer still goes out');
  assert.equal(trouble.sent[0], hostile, 'as it was');
  const twice = fakeRes(502);
  scrubErrorAnswers(twice.res);
  scrubErrorAnswers(twice.res);
  twice.res.json({ error: '/app/f' });
  assert.deepEqual(twice.sent, [{ error: P }]);
});

test('the one Server-Sent-Events error frame of the librechat router is cleaned too, and so is each source of /balances (source pins: written by hand, not through res.json)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'librechat.js'), 'utf8');
  assert.ok(src.includes('JSON.stringify({ error: scrubText(err.message) })'), 'the frame goes through scrubText');
  assert.ok(!src.includes('JSON.stringify({ error: err.message })'), 'and there is no uncleaned frame left');
  assert.ok(src.includes('out[source] = { ...out[source], error: scrubText(out[source].error) }'), '/balances cleans the error text of each source');
});
