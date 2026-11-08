'use strict';
// Nov 8 2026. The secret-gated routes (railway, github, librechat, approvals) put an error's own text in their answers, on purpose: the callers
// are Forge (an LLM that diagnoses from it) and the bridge's nightly battery (it matches /403|forbidden/ in the /librechat/ask error). The text
// is what those routes are for; but it came straight from `err.message`, and a message can carry a path inside the container, a Bearer token or a
// `?key=` in a URL. error-text.js cleans that out of an error ANSWER (status 400 and up; a success answer is never touched) and keeps every other
// word. This file is the unit half: what is cleaned, what is not, where each rule stops, and that cleaning is quick on any input.
// (error-text-wire.test.js is the server.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scrubText, scrubAnswer, scrubErrorAnswers, scrubbingErrors } = require('./error-text');

const H = '<hidden>';
const P = '<path>';
const table = (rows) => { for (const [input, want] of rows) assert.equal(scrubText(input), want, input); };
const same = (rows) => { for (const input of rows) assert.equal(scrubText(input), input, input); };

test('paths inside the container become <path>; the words around them stay', () => {
  table([
    ["ENOENT: no such file or directory, open '/app/data/voices.json'", `ENOENT: no such file or directory, open '${P}'`],
    ['at Object.<anonymous> (/app/librechat.js:123:45)', `at Object.<anonymous> (${P})`],
    ['cannot write /tmp/abc123/out.wav before the end', `cannot write ${P} before the end`],
    ['/var/lib/x and /usr/local/bin/y', `${P} and ${P}`],
    ['the worker died in /tmp', `the worker died in ${P}`],
    ['EACCES at "/root/.config/x"', `EACCES at "${P}"`],
    ['/opt/app/a.js, /etc/passwd; /proc/1/environ', `${P}, ${P}; ${P}`],
    ['see C:\\Users\\KADE\\work\\x.txt now', `see ${P} now`],
    ['and C:/Users/KADE/work/x.txt now', `and ${P} now`],
    ['cwd:/app/x failed', `cwd:${P} failed`],
    ['file:///app/data/x.json missing', `${P} missing`],
  ]);
});

test('every root of a container path is one: app tmp usr opt var proc etc root home srv mnt lib lib64 bin sbin dev sys run', () => {
  table([
    ['/app/a', P], ['/tmp/a', P], ['/usr/a', P], ['/opt/a', P], ['/var/a', P], ['/proc/a', P], ['/etc/a', P], ['/root/a', P], ['/home/node/.npm/x', P],
    ['/srv/data/x', P], ['/mnt/vol/x', P], ['/lib/x86_64-linux-gnu/libc.so.6', P], ['/lib64/ld-linux-x86-64.so.2', P], ['/bin/sh', P], ['/sbin/init', P],
    ['/dev/null', P], ['/sys/fs/cgroup/x', P], ['/run/secrets/x', P],
  ]);
});

test('where a path ends: a quote, a bracket, a bar, a comma, a space', () => {
  table([
    ['open /app/x|next', `open ${P}|next`],
    ['[/app/x]', `[${P}]`],
    ['{/app/x}', `{${P}}`],
    ['</app/x>', `<${P}>`],
    ['(/app/x)', `(${P})`],
    ['"/app/x"', `"${P}"`],
    ["'/app/x'", `'${P}'`],
    ['/app/x, /app/y; /app/z', `${P}, ${P}; ${P}`],
    ['at /app/a.js:1:2 then /tmp/b', `at ${P} then ${P}`],
  ]);
});

test('a root alone is a path too, whatever ends it', () => {
  table([
    ['in "/app" and \'/tmp\' and `/var`', `in "${P}" and '${P}' and \`${P}\``],
    ['(/app) [/tmp] {/var} </etc> /root, /home; /srv: /mnt| /lib', `(${P}) [${P}] {${P}} <${P}> ${P}, ${P}; ${P} ${P}| ${P}`], // (a colon right after a path belongs to it: "/app/a.js:12:3")
    ['/app\n/tmp\t/var /etc', `${P}\n${P}\t${P} ${P}`],
  ]);
});

test('what only looks like a path is left alone', () => {
  same([
    'GET https://api.github.com/repos/o/r/contents/app/server.js failed with 404',
    'Not Found (/repos/o/r/contents/tmp/x)',
    '/approvals/execute needs the approval secret',
    '/appsettings and /tmpfile and /variable and /homepage and /etcetera and /runner and /devices and /binary',
    'GET /librechat/agents -> 502, POST /github/commit -> 400, /v1/audio/speech',
    'docs/readme.md and src/app/main.js (relative, no leading slash)',
    './app/x and ../tmp/y',
    '//app/x and https://app/x and http://tmp/y',
    '~/app/x',
    'pre-/app/x and a_/tmp/y',
    'disc:\\x and ab:/y stay',
    'Voice 462 now speaks as Zondi',
  ]);
});

test('what only looks like a secret is left alone', () => {
  same([
    'project 3f2b8c1e-9d4a-4b7e-8c21-0a1b2c3d4e5f not found',
    'service 0123456789abcdef01234567 is not running',
    'missing key: userId',
    'key=abc123 alone is prose, not a URL parameter',
    'Token verification failed',
    'Bearer authentication failed',
    'bearer token required',
    'task-12345678901234567890 was queued',
    'the key was rotated; the token budget is 4,000',
    '{"error":"bad input","field":"input"}',
    '{"password":"ab","token":"xy"}',
    'x-key: abcde',
    'x-key: abcdef and Authorization: failed and api-key: expected',
    'Authorization: failed',
    'https://api.github.com/repos/o/r reached; mail me at kade@example.com or see https://host.test:8080/path',
    'Bearer abc1234',
    `github_pat_${'x'.repeat(19)} and sk-${'y'.repeat(15)} and ghp_${'z'.repeat(19)}`,
    `AIza${'q'.repeat(19)} and xoxb-${'1'.repeat(9)} and rw_${'k'.repeat(19)}`,
  ]);
});

test('secrets: Bearer tokens, well-known token shapes, JWTs, passwords in URLs, key= in a URL, key fields in JSON, key headers', () => {
  const ghp = 'ghp_' + 'a1B2'.repeat(9);
  const sk = 'sk-' + 'A1b2'.repeat(8);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
  table([
    ['Authorization: Bearer abcDEF123456789xyz', `Authorization: Bearer ${H}`],
    [`request failed with Bearer ${ghp}`, `request failed with Bearer ${H}`],
    ['bearer abc12345 was refused', `Bearer ${H} was refused`],
    ['Bearer abc12345', `Bearer ${H}`],
    [`bad credentials ${ghp} for o/r`, `bad credentials ${H} for o/r`],
    [`gho_${'a1'.repeat(10)} and ghu_${'b2'.repeat(10)} and ghs_${'c3'.repeat(10)} and ghr_${'d4'.repeat(10)}`, `${H} and ${H} and ${H} and ${H}`],
    [`github_pat_${'x9Y8'.repeat(5)} was refused`, `${H} was refused`],
    [`provider said key ${sk} is wrong`, `provider said key ${H} is wrong`],
    [`sk-${'q'.repeat(16)}`, H],
    [`AIza${'Qw3rT'.repeat(8)} is not allowed`, `${H} is not allowed`],
    ['xoxb-1234567890-abcdefghij', H],
    ['xoxa-1234567890 xoxp-1234567890 xoxr-1234567890 xoxs-1234567890', `${H} ${H} ${H} ${H}`],
    [`rw_${'k'.repeat(20)} was rejected`, `${H} was rejected`],
    [`token ${jwt} has expired`, `token ${H} has expired`],
    ['connect to mongodb+srv://kade:hunter22@cluster0.example.net/db failed', `connect to mongodb+srv://${H}@cluster0.example.net/db failed`],
    ['proxy http://user:pa55word@10.0.0.1:8080 refused', `proxy http://${H}@10.0.0.1:8080 refused`],
    ['postgresql://app:s3cret@db.internal/x and redis://:pw1234@cache', `postgresql://${H}@db.internal/x and redis://${H}@cache`],
    ['MONGODB://u:pw1234@h', `MONGODB://${H}@h`],
    [`https://u:${'p'.repeat(150)}@host/x`, `https://${H}@host/x`],
    ['GET https://svc.test/x?id=1&x-key=SECRETVALUE99 failed', `GET https://svc.test/x?id=1&x-key=${H} failed`],
    ['GET /v1/get?token=abc123&ok=1 -> 401', `GET /v1/get?token=${H}&ok=1 -> 401`],
    ['https://a.test/p?key=AbCdEf and https://b.test/q?apikey=ZZZZ1111', `https://a.test/p?key=${H} and https://b.test/q?apikey=${H}`],
    ['/x?a=1&sig=abc123&signature=def456&password=pw1&secret=s1&x-api-key=k1', `/x?a=1&sig=${H}&signature=${H}&password=${H}&secret=${H}&x-api-key=${H}`],
    ['/x?KEY=abc&Token=def', `/x?KEY=${H}&Token=${H}`],
    ['{"api_key":"abc123def456","other":"x"}', `{"api_key":"${H}","other":"x"}`],
    ['{"Password": "hunter22" , "ok": true}', `{"Password": "${H}" , "ok": true}`],
    ['{"authorization":"abc","client_secret":"def","token":"ghi","pass":"jkl","passwd":"mno","private_key":"pqr","refresh_token":"stu","id_token":"vwx","x-kade-secret":"yz1"}',
      `{"authorization":"${H}","client_secret":"${H}","token":"${H}","pass":"${H}","passwd":"${H}","private_key":"${H}","refresh_token":"${H}","id_token":"${H}","x-kade-secret":"${H}"}`],
    ['{"password":"abc"}', `{"password":"${H}"}`],
    [`AIza${'q'.repeat(20)} and xoxb-${'1'.repeat(10)} and rw_${'k'.repeat(20)}`, `${H} and ${H} and ${H}`],
    ['x-key: ab_cdef and x-key: ab/cdef and x-key: ab+cdef and x-key: ab=cdef', `x-key: ${H} and x-key: ${H} and x-key: ${H} and x-key: ${H}`],
    ['x-key: abcdef123456 was sent', `x-key: ${H} was sent`],
    ['x-api-key=abcdef123456', `x-api-key=${H}`],
    ['x-key: abcde1', `x-key: ${H}`],
    ['authorization: abcde1 and proxy-authorization: abcde1 and x-auth-token: abcde1', `authorization: ${H} and proxy-authorization: ${H} and x-auth-token: ${H}`],
    ['x-kade-secret: s3cr3tvalue, x-proxy-secret=abcdef12 x-kade-approval-secret: abcdef12', `x-kade-secret: ${H}, x-proxy-secret=${H} x-kade-approval-secret: ${H}`],
  ]);
});

test('every name of the three key lists is one: JSON fields, URL parameters, header names, with and without their separators', () => {
  const expand = (name) => (name.includes('[_-]?') ? [name.replace('[_-]?', ''), name.replace('[_-]?', '_'), name.replace('[_-]?', '-')] : [name]);
  const JSON_FIELDS = ['api[_-]?key', 'access[_-]?token', 'auth[_-]?token', 'refresh[_-]?token', 'id[_-]?token', 'client[_-]?secret', 'private[_-]?key', 'secret', 'password', 'passwd', 'pass', 'token',
    'authorization', 'x-api-key', 'x-key', 'x-auth-token', 'x-kade-secret', 'x-proxy-secret', 'x-kade-approval-secret'];
  for (const raw of JSON_FIELDS) {
    for (const name of expand(raw)) assert.equal(scrubText(`{"${name}":"abcdef123456"}`), `{"${name}":"${H}"}`, `JSON field ${name}`);
  }
  const URL_KEYS = ['x-api-key', 'x-key', 'api[_-]?key', 'access[_-]?token', 'auth[_-]?token', 'client[_-]?secret', 'secret', 'password', 'key', 'token', 'sig', 'signature'];
  for (const raw of URL_KEYS) {
    for (const name of expand(raw)) {
      assert.equal(scrubText(`/x?a=1&${name}=abcdef123456&b=2`), `/x?a=1&${name}=${H}&b=2`, `URL parameter ${name}`);
      assert.equal(scrubText(`/x?${name}=abcdef123456`), `/x?${name}=${H}`, `first URL parameter ${name}`);
    }
  }
  const HEADERS = ['x-api-key', 'x-key', 'api-key', 'authorization', 'proxy-authorization', 'x-auth-token', 'x-kade-secret', 'x-proxy-secret', 'x-kade-approval-secret'];
  for (const name of HEADERS) {
    assert.equal(scrubText(`${name}: abcdef123456`), `${name}: ${H}`, `header ${name}`);
    assert.equal(scrubText(`${name}=abcdef123456 ok`), `${name}=${H} ok`, `header-like ${name}=`);
    const upper = name.toUpperCase();
    assert.equal(scrubText(`${upper}: ABCDEF123456`), `${upper}: ${H}`, `header ${upper}`);
  }
});

test('the edges of the rules: minimum lengths, case, and what stops a path', () => {
  const jwt = (a, b, c) => `eyJ${'a'.repeat(a)}.${'b'.repeat(b)}.${'c'.repeat(c)}`;
  table([
    [jwt(8, 8, 8), H],
    [`token ${jwt(8, 8, 8)} end`, `token ${H} end`],
    ['Authorization: Bearer abc+def/ghi12345678==', `Authorization: Bearer ${H}`],
    ['Bearer YWJjZGVmZ2g=', `Bearer ${H}`],
    ['postgresql://some_long_username_here:pw1234@host/db', `postgresql://${H}@host/db`],
    ['AUTHORIZATION: abcde1 and X-KEY: ABC123def', `AUTHORIZATION: ${H} and X-KEY: ${H}`],
    ['FILE:///app/data/x.json missing', `${P} missing`],
    ['File:///tmp/a.txt', P],
    ['see /app<here> and /app/x<br>', `see ${P}<here> and ${P}<br>`],
    ['at fn (/app/x.js(12:5))', `at fn (${P}(12:5))`],
    ['/app/x.js[0] and /app/y.js{a}', `${P}[0] and ${P}{a}`],
    ['open "C:\\Users\\kade\\x.txt" failed and D:/Users/kade/y.txt too', `open "${P}" failed and ${P} too`],
  ]);
  same([jwt(7, 8, 8), jwt(8, 7, 8), jwt(8, 8, 7)]);
});

test('a path and a secret in one message', () => {
  const input = `connect failed: open "/app/node_modules/x/y.js" via https://svc.test/path?key=SUPERSECRET123 and Authorization: Bearer ghp_${'0a1b'.repeat(9)}`;
  assert.equal(scrubText(input), `connect failed: open "${P}" via https://svc.test/path?key=${H} and Authorization: Bearer ${H}`);
});

test('long text is cut at 400 characters with "...", and cleaning a cleaned text changes nothing', () => {
  const long = 'x'.repeat(5000);
  const out = scrubText(long);
  assert.equal(out.length, 403);
  assert.ok(out.endsWith('...'));
  assert.equal(scrubText('y'.repeat(400)), 'y'.repeat(400), 'exactly 400 is not cut');
  assert.equal(scrubText('y'.repeat(401)), 'y'.repeat(400) + '...');
  const messy = "open '/app/a/b.js' with Bearer abcDEF123456789xyz and ?key=SECRET99 " + 'z'.repeat(600);
  assert.equal(scrubText(scrubText(messy)), scrubText(messy));
  for (const input of ["open '/app/x' and Bearer abc12345def", 'plain words only', 'a'.repeat(900)]) assert.equal(scrubText(scrubText(input)), scrubText(input), input);
});

test('anything that is not a string comes back as it was', () => {
  for (const v of [undefined, null, 0, 502, true, { a: 1 }, ['/app/x']]) assert.equal(scrubText(v), v);
});

// V8 builds a long repeat() as a rope and flattens it on the first read; that read is not the cleaning, so it is done before the clock starts
const flat = (s) => { s.charCodeAt(s.length - 1); return s; };

const HOSTILE = {
  'slashes': (n) => '/app/'.repeat(n / 5),
  'token characters': (n) => 'a1'.repeat(n / 2),
  'bearer then token characters': (n) => 'Bearer ' + 'a'.repeat(n),
  'many bearers': (n) => 'Bearer abc123def456 '.repeat(n / 20),
  'query keys': (n) => '?key=a&'.repeat(n / 7),
  'json keys': (n) => '"api_key":"'.repeat(n / 11),
  'backslashes': (n) => 'C:\\'.repeat(n / 3),
  'path starts': (n) => '/tmp'.repeat(n / 4),
  'ampersands': (n) => '&'.repeat(n),
  'scheme runs': (n) => 'ab:'.repeat(n / 3) + '//' + 'x'.repeat(n / 3),
  'userinfo runs': (n) => 'http://' + 'u'.repeat(n / 2) + ':' + 'p'.repeat(n / 2),
  'header names': (n) => 'x-key:'.repeat(n / 6),
  'file urls': (n) => 'file://'.repeat(n / 7),
};

test('on hostile text it is quick: megabytes of the shapes a pattern could choke on', () => {
  for (const [label, make] of Object.entries(HOSTILE)) {
    const text = flat(make(20000000));
    const t0 = process.hrtime.bigint();
    const out = scrubText(text);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 50, `${label}: ${ms.toFixed(1)} ms`);
    assert.ok(out.length <= 403, `${label}: ${out.length} characters`);
  }
});

test('and the rules themselves are quick on the 2,000 characters they do read: a few hundred runs of every shape', () => {
  for (const [label, make] of Object.entries(HOSTILE)) {
    const text = flat(make(2000));
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 300; i++) scrubText(text);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1500, `${label}: 300 runs took ${ms.toFixed(1)} ms`); // linear is 0.01 to 0.3 ms a run; a quadratic rule would be 10 ms and more
  }
});

test('scrubAnswer: the text fields of an error answer, nothing else, and the original object is not touched', () => {
  const body = {
    error: "open '/app/x.js'", details: 'Bearer abcDEF123456789xyz', detail: 'at /tmp/y', message: '?key=SECRET99', text: 'a reply that mentions /app/x.js', bytes: 5,
    nested: { error: '/app/z' }, ok: false, note: '/app/n', said: '/app/s', hint: '/app/h', reason: '/app/r', status: '/app/st',
    data: '/app/d', url: '/app/u', path: '/app/p', output: '/app/o', stderr: '/app/e',
  };
  const copy = JSON.parse(JSON.stringify(body));
  const out = scrubAnswer(body);
  assert.deepEqual(body, copy, 'the original is as it was');
  assert.equal(out.error, `open '${P}'`);
  assert.equal(out.details, `Bearer ${H}`);
  assert.equal(out.detail, `at ${P}`);
  assert.equal(out.message, `?key=${H}`);
  for (const key of ['text', 'note', 'said', 'hint', 'reason', 'status', 'data', 'url', 'path', 'output', 'stderr']) assert.equal(out[key], body[key], `${key} is not an error text field`);
  assert.equal(out.bytes, 5);
  assert.deepEqual(out.nested, { error: '/app/z' }, 'only the top level of the answer');
  assert.equal(out.ok, false);
  const object = { message: 'at /app/q', code: 7 };
  assert.deepEqual(scrubAnswer({ error: 'bfl submit 500', detail: object }).detail, object, 'a provider\'s own JSON under `detail` is data, not our text: left as it is');
  for (const v of ['a string', 5, null, undefined, ['/app/x'], true]) assert.equal(scrubAnswer(v), v);
  const circular = { error: '/app/x' };
  circular.self = circular;
  assert.equal(scrubAnswer(circular).error, P);
  class Reply { constructor() { this.error = '/app/x'; } toJSON() { return { error: 'custom' }; } }
  const instance = new Reply();
  assert.equal(scrubAnswer(instance), instance, 'an object with a prototype of its own (its own toJSON, say) is not rebuilt as a plain copy');
  assert.equal(instance.error, '/app/x');
  const bare = Object.assign(Object.create(null), { error: '/app/x' });
  assert.equal(scrubAnswer(bare).error, P, 'an object with no prototype is a plain one');
});

function fakeRes(statusCode) {
  const sent = [];
  const res = { statusCode, json(...args) { sent.push(args); return this; }, status(c) { this.statusCode = c; return this; } };
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
    [{ error: '/app/a' }],
    [{ error: `open '${P}'`, details: `Bearer ${H}` }],
    [{ error: P }],
    [{ error: '/tmp/d' }],
    [{ text: '/app/e', error: '/app/e' }],
  ]);
  const trouble = fakeRes(502);
  scrubErrorAnswers(trouble.res);
  const hostile = {};
  Object.defineProperty(hostile, 'error', { enumerable: true, get() { throw new Error('a getter that throws'); } });
  trouble.res.json(hostile);
  assert.equal(trouble.sent.length, 1, 'the answer still goes out');
  assert.equal(trouble.sent[0][0], hostile, 'as it was');
  const twice = fakeRes(502);
  scrubErrorAnswers(twice.res);
  const wrapped = twice.res.json;
  scrubErrorAnswers(twice.res);
  assert.equal(twice.res.json, wrapped, 'a second call does not wrap again');
  twice.res.json({ error: '/app/f' });
  assert.deepEqual(twice.sent, [[{ error: P }]]);
});

test('scrubErrorAnswers is transparent: res.json(status, body) and res.json(body, status) of Express 4 are passed on whole, and cleaned when the status says error', () => {
  const a = fakeRes(200);
  scrubErrorAnswers(a.res);
  a.res.json(502, { error: '/app/a' });
  a.res.json({ error: '/app/b' }, 500);
  a.res.json(200, { error: '/app/c' });
  a.res.json({ error: '/app/d' }, 201);
  a.res.json(5);
  a.res.json('plain');
  a.res.json();
  assert.deepEqual(a.sent, [[502, { error: P }], [{ error: P }, 500], [200, { error: '/app/c' }], [{ error: '/app/d' }, 201], [5], ['plain'], []]);
  const b = fakeRes(502);
  scrubErrorAnswers(b.res);
  b.res.json(null);
  b.res.json([{ error: '/app/x' }]);
  assert.deepEqual(b.sent, [[null], [[{ error: '/app/x' }]]], 'what is not a plain object goes out as it is');
});

test('the middleware form installs the same hook and carries the marker the route table looks for', () => {
  assert.equal(scrubbingErrors.scrubsErrors, true);
  const { res, sent } = fakeRes(200);
  let called = 0;
  scrubbingErrors({}, res, () => { called++; });
  assert.equal(called, 1);
  res.status(502).json({ error: '/app/m' });
  assert.deepEqual(sent, [[{ error: P }]]);
});

test('the places that clean by hand are pinned in the source (the wire test drives them too)', () => {
  const lib = fs.readFileSync(path.join(__dirname, 'librechat.js'), 'utf8');
  assert.ok(lib.includes('JSON.stringify({ error: scrubText(err.message) })'), 'the ask-stream frame goes through scrubText');
  assert.ok(!lib.includes('JSON.stringify({ error: err.message })'), 'and there is no uncleaned frame left');
  assert.ok(lib.includes('out[source] = { ...out[source], error: scrubText(out[source].error) }'), '/balances cleans the error text of each source');
  assert.ok(lib.includes("out.said = scrubText(buf.toString('utf8').slice(0, 200))"), 'seat-speech cleans the site\'s reply');
  assert.ok(lib.includes('text: scrubText(text != null ? String(text).slice(0, 200) : said.slice(0, 200))'), 'and the transcript text');
  const appr = fs.readFileSync(path.join(__dirname, 'approvals.js'), 'utf8');
  assert.ok(appr.includes('router.get("/approvals/:id", scrubbingErrors,'), 'GET /approvals/:id checks its own Bearer and cleans its errors');
});
