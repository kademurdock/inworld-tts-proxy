'use strict';
/* tool-echo-ask.wire.test.js (Nov 13 2026). The reply text this service hands on for speech and for text messages,
 * against a fake site on 127.0.0.1 (nothing leaves the machine):
 *  - /librechat/ask-stream (the calls): the tokens stop at the line "Tool: <a tool name>, ..." the model only wrote, the
 *    turn still ends with [DONE], and the site job is left to finish;
 *  - the same when the whole reply arrives with the final event (a tool turn), or its tail does;
 *  - a line that only begins like the echo is passed on whole, the part held back included, before [DONE];
 *  - /librechat/ask (text messages, briefs, voicemail): the text ends where the reply did;
 *  - KADE_TOOL_ECHO_SPEECH=0 gives both back as they were (which is also what these tests see without the change);
 *  - a tab or a line break right after the comma is the echo too, on both routes (review of Nov 13);
 *  - librechat.js loads tool-echo at the top with its other requires, not inside lcAsk (review of Nov 13).
 * tool-echo.test.js pins the rule itself. Each case loads a fresh copy of librechat.js, because it reads its env once at load. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const unhandled = [];
const onUnhandled = (e) => unhandled.push(e);
process.on('unhandledRejection', onUnhandled);
const hadSwitch = Object.prototype.hasOwnProperty.call(process.env, 'KADE_TOOL_ECHO_SPEECH') ? process.env.KADE_TOOL_ECHO_SPEECH : undefined;
const hadLogText = Object.prototype.hasOwnProperty.call(process.env, 'KADE_LOG_TEXT') ? process.env.KADE_LOG_TEXT : undefined;
delete process.env.KADE_TOOL_ECHO_SPEECH;   // the switch unset and receipts in the log, whatever this machine has set
delete process.env.KADE_LOG_TEXT;
test.after(() => {
  if (hadSwitch === undefined) delete process.env.KADE_TOOL_ECHO_SPEECH; else process.env.KADE_TOOL_ECHO_SPEECH = hadSwitch;
  if (hadLogText === undefined) delete process.env.KADE_LOG_TEXT; else process.env.KADE_LOG_TEXT = hadLogText;
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled.map(String), [], 'no unhandled rejection anywhere in this file');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAID = 'Sure. It is sunny today, and warm.';
const ECHO = 'Tool: kade_research, === Deep Research Context ===\n\n# Your Question, Stated\nKade asked: what is the weather like?';
const ECHO_WORDS = /Tool|kade_research|Deep Research|Your Question|Kade asked/;
// the reply as a model streams it: small pieces, the line that starts the echo spread over five of them
const DELTAS = ['Sure', '.', ' It is', ' sunny today', ', and warm.', '\n', 'Tool', ':', ' kade', '_research', ',', ' ===', ' Deep Research', ' Context ===', '\n\n# Your Question, Stated\n', 'Kade asked: what is', ' the weather like?'];
assert.equal(DELTAS.join(''), SAID + '\n' + ECHO);

/* The fake site. `replies` is a queue: each stream takes the next { deltas, final } (final: the text of the final event's
 * responseMessage; by default what the deltas spelled). Every request is recorded. */
async function fakeSite() {
  const s = { events: [], replies: [], starts: 0 };
  const app = express();
  app.use(express.json());
  const rec = (kind, extra = {}) => s.events.push({ kind, ...extra });
  app.post('/api/auth/login', (_req, res) => { rec('login'); res.json({ token: 'tok' }); });
  app.post('/api/agents/chat/abort', (req, res) => { rec('abort', { streamId: req.body && req.body.streamId }); res.json({ ok: true }); });
  app.post('/api/agents/chat', (req, res) => { rec('start'); res.json({ streamId: `stream-${++s.starts}`, conversationId: 'conversation-1' }); });
  app.get('/api/agents/chat/stream/:id', (req, res) => {
    rec('subscribe', { streamId: req.params.id });
    const reply = s.replies.shift() || { deltas: ['Well, ', 'hello there.'] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const text of reply.deltas) res.write(`data: ${JSON.stringify({ event: 'on_message_delta', data: { delta: { content: [{ type: 'text', text }] } } })}\n\n`);
    res.end(`data: ${JSON.stringify({ final: true, responseMessage: { text: reply.final === undefined ? reply.deltas.join('') : reply.final, messageId: 'reply-1' } })}\n\n`);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  s.base = `http://127.0.0.1:${server.address().port}`;
  s.of = (kind) => s.events.filter((e) => e.kind === kind);
  s.close = () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); };
  return s;
}

async function loadProxy(base) {
  const all = {
    LIBRECHAT_BASE: base, LIBRECHAT_USER: 'offline@example.invalid', LIBRECHAT_PASS: 'offline',
    LIBRECHAT_PROXY_SECRET: 'offline-secret', LIBRECHAT_MIN_GAP_MS: '20', LIBRECHAT_LIVE_FIRST: undefined, LIBRECHAT_LIVE_GAP_MS: undefined,
  };
  const old = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(all)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete require.cache[require.resolve('./librechat')];
  let router;
  try { router = require('./librechat'); } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { port: server.address().port, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

/* One call-lane turn: the SSE body as it came, and the tokens in it in order. */
function askStream(port) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ agentId: 'test-agent', messages: [{ role: 'user', content: 'How is the weather?' }] });
    const req = http.request({ host: '127.0.0.1', port, path: '/librechat/ask-stream', method: 'POST',
      headers: { Authorization: 'Bearer offline-secret', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
    let body = '';
    req.on('error', reject);
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const events = body.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6));
        const tokens = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e)).filter((e) => typeof e.token === 'string').map((e) => e.token);
        resolve({ body, events, tokens, spoken: tokens.join('') });
      });
    });
    req.end(data);
  });
}
async function ask(port) {
  const r = await fetch(`http://127.0.0.1:${port}/librechat/ask`, {
    method: 'POST', headers: { Authorization: 'Bearer offline-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'test-agent', messages: [{ role: 'user', content: 'How is the weather?' }] }),
  });
  return { status: r.status, json: await r.json() };
}
function captureLogs() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map(String).join(' ')); };
  return { text: () => lines.join('\n'), echo: () => lines.filter((line) => line.includes('[tool-echo]')), restore: () => Object.assign(console, orig) };
}
async function rig(run) {
  const site = await fakeSite();
  const px = await loadProxy(site.base);
  const logs = captureLogs();
  try { return await run({ site, port: px.port, logs }); } finally { logs.restore(); await px.close(); await site.close(); }
}

test('a call hears the reply up to the line the model only wrote, and nothing after it; the turn ends with [DONE] and the site job is left alone', async () => {
  await rig(async ({ site, port, logs }) => {
    site.replies.push({ deltas: DELTAS });
    const r = await askStream(port);
    assert.equal(r.spoken, SAID + '\n', 'every word she said, in order, and the line break that ended it');
    assert.deepEqual(r.tokens, ['Sure', '.', ' It is', ' sunny today', ', and warm.', '\n'], 'each token goes out as it arrived: nothing of an ordinary line is held back');
    assert.doesNotMatch(r.body, ECHO_WORDS, 'nothing of the echo is in the answer, not even its first word');
    assert.equal(r.events[r.events.length - 1], '[DONE]');
    await sleep(100);
    assert.equal(site.of('abort').length, 0, 'the site job is not stopped');
    assert.deepEqual(logs.echo(), [`[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=${ECHO.length} of ${SAID.length + 1 + ECHO.length}`]);
    assert.match(logs.text(), new RegExp(`\\[lcAskStream\\] final: ${SAID.length + 1 + ECHO.length} chars total`), 'the reply is still counted whole');
    assert.doesNotMatch(logs.text(), /sunny|Deep Research|Kade asked|weather like/, 'the words of the reply are not in the log');
  });
});

test('the same when the reply, or its tail, arrives with the final event (a tool turn)', async () => {
  await rig(async ({ site, port, logs }) => {
    site.replies.push({ deltas: [], final: SAID + '\n' + ECHO });                    // nothing streamed: the final event carries it all
    site.replies.push({ deltas: ['Sure. It is sunny today,'], final: SAID + '\n' + ECHO });   // the tail arrives with the final event
    site.replies.push({ deltas: [], final: ECHO });                                  // a reply that is nothing but the echo
    const whole = await askStream(port);
    assert.equal(whole.spoken, SAID + '\n');
    assert.doesNotMatch(whole.body, ECHO_WORDS);
    const tail = await askStream(port);
    assert.equal(tail.spoken, SAID + '\n');
    assert.doesNotMatch(tail.body, ECHO_WORDS);
    const only = await askStream(port);
    assert.deepEqual(only.tokens, [], 'no token at all: the bridge says its own "say that once more" line');
    assert.equal(only.events[only.events.length - 1], '[DONE]');
    assert.equal(logs.echo().length, 3);
    assert.equal(site.of('abort').length, 0);
  });
});

test('a line that only begins like the echo is passed on whole: what was held back goes out before [DONE]', async () => {
  await rig(async ({ site, port, logs }) => {
    const deltas = ['Bring these:\n', 'To', 'ol', ': ham', 'mer, nails.', '\nT', 'omorrow then.', '\n%%%wa', 'rm%%% ', 'See you.', '\nTool: web_search'];
    site.replies.push({ deltas });
    const r = await askStream(port);
    assert.equal(r.spoken, deltas.join(''), 'every character of the reply, in order');
    assert.equal(r.tokens[r.tokens.length - 1], 'Tool: web_search', 'the start of a line still held when the reply ended is the last token');
    assert.equal(r.events[r.events.length - 1], '[DONE]');
    assert.deepEqual(logs.echo(), []);
    // ... and a tool name with its comma as the very last thing of the reply is the echo with its space trimmed away
    site.replies.push({ deltas: ['All done.', '\nTool: kade_research', ','] });
    const last = await askStream(port);
    assert.equal(last.spoken, 'All done.\n');
    assert.deepEqual(logs.echo(), ['[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=20 of 30']);
  });
});

test('a tab or a line break right after the comma is the echo too, on both routes, wherever the tokens are cut (review of Nov 13)', async () => {
  await rig(async ({ site, port, logs }) => {
    const rest = ECHO.slice(ECHO.indexOf('==='));                 // "=== Deep Research Context ===" and what the model put under it
    // the comma and the line break in tokens of their own: "Tool: kade_research," is held until the token after it tells
    site.replies.push({ deltas: ['Sure', '. It is sunny today, and warm.', '\nTool: kade_research', ',', '\n', rest] });
    const broken = await askStream(port);
    assert.equal(broken.spoken, SAID + '\n');
    assert.deepEqual(broken.tokens, ['Sure', '. It is sunny today, and warm.', '\n'], 'nothing of the echo, not even its first word');
    assert.equal(broken.events[broken.events.length - 1], '[DONE]');
    // a tab right after the comma, in the same token
    site.replies.push({ deltas: [SAID, '\nTool: kade_research,\t' + rest] });
    const tabbed = await askStream(port);
    assert.equal(tabbed.spoken, SAID + '\n');
    // CR LF, the whole reply arriving with the final event (a tool turn)
    site.replies.push({ deltas: [], final: SAID + '\r\nTool: kade_research,\r\n' + rest });
    const crlf = await askStream(port);
    assert.equal(crlf.spoken, SAID + '\r\n');
    for (const r of [broken, tabbed, crlf]) assert.doesNotMatch(r.body, ECHO_WORDS);
    // the text handed back for a text message
    site.replies.push({ deltas: [SAID, '\nTool: kade_research,', '\n' + rest] });
    const text = await ask(port);
    assert.deepEqual(text.json, { text: SAID, seat: 'admin' });
    const echo = ('Tool: kade_research,\n' + rest).length;
    assert.deepEqual(logs.echo(), [
      `[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=${echo} of ${SAID.length + 1 + echo}`,
      `[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=${echo} of ${SAID.length + 1 + echo}`,
      `[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=${echo + 1} of ${SAID.length + 2 + echo + 1}`,
      `[tool-echo] cut: lane=librechat-ask tool=kade_research chars=${echo} of ${SAID.length + 1 + echo}`,
    ]);
    assert.equal(site.of('abort').length, 0, 'the site job is not stopped');
  });
});

test('librechat.js loads tool-echo once, at the top with its other requires, and not inside lcAsk or lcAskStream (review of Nov 13)', () => {
  // eval-continuation.test.js runs lcAsk in a sandbox and hands it, by name, what librechat.js defines at its top level; a
  // require inside lcAsk is one more thing that sandbox must be handed, and it had none.
  const source = fs.readFileSync(require.resolve('./librechat'), 'utf8');
  const loads = [...source.matchAll(/require\((["'])\.\/tool-echo(?:\.js)?\1\)/g)];
  assert.equal(loads.length, 1, 'one require of ./tool-echo in librechat.js');
  const at = loads[0].index;
  assert.equal(source.slice(source.lastIndexOf('\n', at) + 1, at), 'const { cutToolEcho, createToolEchoGate } = ', 'a const of its own line, at the top level');
  assert.ok(at < source.indexOf('\nfunction '), 'with the other requires, ahead of the first function');
  const lcAsk = source.indexOf('\nasync function lcAsk(');
  const lcAskStream = source.indexOf('\nasync function lcAskStream(');
  assert.ok(at < lcAsk && lcAsk < lcAskStream, 'both functions come after it');
  assert.match(source.slice(lcAsk, source.indexOf('\n}', lcAsk)), /\bcutToolEcho\(stripCitationAnchors\(reply\)/, 'lcAsk cuts with the name from the top');
  assert.match(source.slice(lcAskStream, source.indexOf('\n}', lcAskStream)), /\bcreateToolEchoGate\(\{/, 'lcAskStream gates with the name from the top');
});

test('the text handed back for a text message or a voicemail ends where the reply did', async () => {
  await rig(async ({ site, port, logs }) => {
    site.replies.push({ deltas: DELTAS });
    const r = await ask(port);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { text: SAID, seat: 'admin' });
    assert.deepEqual(logs.echo(), [`[tool-echo] cut: lane=librechat-ask tool=kade_research chars=${ECHO.length} of ${SAID.length + 1 + ECHO.length}`]);
    // a reply with no echo is handed back as it came
    site.replies.push({ deltas: ['Bring these:\n', 'Tool: hammer, nails.'] });
    assert.deepEqual((await ask(port)).json, { text: 'Bring these:\nTool: hammer, nails.', seat: 'admin' });
    // a reply that is nothing but the echo comes back empty, which every caller already treats as no reply
    site.replies.push({ deltas: [ECHO] });
    const only = await ask(port);
    assert.equal(only.status, 200);
    assert.deepEqual(only.json, { text: '', seat: 'admin' });
    assert.equal(logs.echo().length, 2);
    assert.doesNotMatch(logs.text(), /sunny|Deep Research|Kade asked|weather like|hammer/, 'the words of the reply are not in the log');
  });
});

test('KADE_TOOL_ECHO_SPEECH=0: both routes hand the reply on as it came, echo and all', async () => {
  await rig(async ({ site, port, logs }) => {
    process.env.KADE_TOOL_ECHO_SPEECH = '0';
    try {
      site.replies.push({ deltas: DELTAS });
      const stream = await askStream(port);
      assert.equal(stream.spoken, SAID + '\n' + ECHO);
      assert.deepEqual(stream.tokens, DELTAS, 'token for token');
      site.replies.push({ deltas: DELTAS });
      assert.deepEqual((await ask(port)).json, { text: SAID + '\n' + ECHO, seat: 'admin' });
      assert.deepEqual(logs.echo(), []);
    } finally {
      delete process.env.KADE_TOOL_ECHO_SPEECH;
    }
  });
});
