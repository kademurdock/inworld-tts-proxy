'use strict';
// Nov 13 2026: Kade heard a tool call read aloud at the end of a reply from Kiana ("Tool: kade_research, === Deep Research
// Context ===" and her own question under it; the model wrote the line, no tool ran). tool-echo.test.js pins the rule; this
// file drives it through the real server and the real speech route, with the provider fixture in place of Inworld and Fish
// (nothing leaves the machine, nothing is paid): what the provider is handed is what a listener would hear.
//   - the saved reply on every lane of the route: Inworld buffered and streamed, Fish, and the phone;
//   - a tool line inside the reasoning does not take the answer with it; ordinary "Tool:" text is spoken; a piece that is
//     nothing but the echo says nothing and asks the provider for nothing;
//   - the lanes that read a document (the Library, family history, described video) are left alone;
//   - KADE_TOOL_ECHO_SPEECH=0 gives the old behaviour back (which is also what these tests see without the change);
//   - a reply of 100,000 characters that is mostly echo;
//   - a tab or a line break right after the comma is the echo too, as on the website (review of Nov 13);
//   - tool-echo.js, and every other file the service loads, is in git (review of Nov 13: server.js and librechat.js load it
//     at the top, so a commit of them without it is a service that does not start).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

// The end of the saved reply, as it was stored: her last real sentence, then the line the model wrote and what it put under it.
const SAID = "there's tons of content with no description available and people left sitting in the dark.";
const ECHO = 'Tool: kade_research, === Deep Research Context ===\n\n# Your Question, Stated\nKade asked: If she creates an app where a phone listens to a TV playing a film ... Could she monetize it, or does it have to be free?';
// ... behind a direction and a few opening words of this test's own, so the request has the shape of a whole reply.
const REPLY = '%%%matter of fact%%% Well, yes. Right now ' + SAID + '\n' + ECHO;
const ECHO_WORDS = /Tool|kade.?research|Deep Research|Your Question|Kade asked|monetize|a TV playing/i;   // nothing of the echo, in any spelling
const LOG_WORDS = /sitting in the dark|Deep Research|Kade asked|monetize|Well, yes/;                         // chat words never reach the log

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-tool-echo-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt,
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM',
    'SPEECH_GATE', 'SPEECH_MAX_INPUT_CHARS', 'KADE_TOOL_ECHO_SPEECH', 'KADE_LOG_TEXT']) delete env[k];
  Object.assign(env, extra);
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { state, rows, stop };
}
const echoLines = (log) => log.split('\n').filter((line) => line.includes('[tool-echo]'));
async function withServer(port, extra, run) {
  const s = start(port, extra);
  try {
    let up = false;
    for (let i = 0; i < 400 && !up && s.state.exited === null; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500; } catch { /* booting */ }
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, s.state.log.slice(-2000));
    // One speech request: its status, how many bytes of audio came back, and every text the provider was handed for it.
    const speak = async (input, { body = {}, headers = {}, query = '' } = {}) => {
      const before = s.rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ input, voice: 'alloy', ...body }),
      });
      const bytes = (await r.arrayBuffer()).byteLength;
      const handed = s.rows().slice(before).map((x) => String(x.body.text));
      return { status: r.status, bytes, handed, heard: handed.join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ') };
    };
    // The child's log reaches this process a moment after the answer does: wait for that many [tool-echo] lines.
    const cuts = async (count) => {
      for (let i = 0; i < 150 && echoLines(s.state.log).length < count; i++) await new Promise((r) => setTimeout(r, 20));
      return echoLines(s.state.log);
    };
    return await run({ speak, cuts, log: () => s.state.log });
  } finally {
    await s.stop();
  }
}

test('the Nov 13 reply is spoken up to where she stopped talking: Inworld buffered and streamed, Fish, and the phone', async () => {
  await withServer(32110, {}, async ({ speak, cuts, log }) => {
    const lanes = [
      ['Inworld, buffered', { body: { voice: 'alloy' } }],
      ['Inworld, streamed', { body: { voice: 'alloy', stream: true } }],
      ['Fish', { body: { voice: 'fish:fixture' } }],
      ['the phone', { body: { voice: 'alloy' }, query: '?telephony=1' }],
    ];
    for (const [name, opts] of lanes) {
      const r = await speak(REPLY, { ...opts, headers: { 'x-kade-caller': 'fork-tts' } });
      assert.equal(r.status, 200, name + ': ' + log().slice(-1500));
      assert.ok(r.bytes > 0, name + ' answered with audio');
      assert.ok(r.handed.length >= 1, name + ' asked the provider');
      assert.match(r.heard, /Well, yes\..*people left sitting in the dark\./, name + ' keeps every word she said: ' + JSON.stringify(r.handed));
      assert.doesNotMatch(r.handed.join(' '), ECHO_WORDS, name + ' speaks the echo: ' + JSON.stringify(r.handed));
    }
    const line = `[tool-echo] cut: lane=fork-tts tool=kade_research chars=${ECHO.length} of ${REPLY.length}`;
    assert.deepEqual(await cuts(4), [line, line, line, line], 'one log line for each of the four requests');
    assert.doesNotMatch(log(), LOG_WORDS, 'the words of the reply are not in the log');
  });
});

test('a tool line inside the reasoning does not take the answer with it; ordinary text is spoken; a piece that is only the echo says nothing', async () => {
  await withServer(32111, {}, async ({ speak, cuts, log }) => {
    // 1. the reasoning goes first, and whatever it holds goes with it
    for (const thought of ['<think>\nTool: web_search, I should look this up first.\n</think>\n', ':::thinking\nTool: kade_research, maybe.\n:::\n']) {
      const r = await speak(thought + 'It is sunny today, and warm.');
      assert.equal(r.status, 200);
      assert.match(r.heard, /It is sunny today, and warm\./, JSON.stringify(r.handed));
      assert.doesNotMatch(r.heard, /look this up|maybe/);
    }

    // 2. a line that begins with "Tool:" and is no tool call is a sentence like any other
    for (const [input, kept] of [
      ['Bring these.\nTool: hammer, nails and a level.', /Bring these\..*Tool: hammer, nails and a level\./],
      ['I looked it up with the search Tool: nothing came back, sorry.', /with the search Tool: nothing came back, sorry\./],
      ['Tools: a saw, a square and a pencil.', /Tools: a saw, a square and a pencil\./],
    ]) {
      const r = await speak(input);
      assert.equal(r.status, 200);
      assert.match(r.heard, kept, JSON.stringify(r.handed));
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(echoLines(log()), [], 'nothing was cut so far');

    // 3. the apps and the bridge send a reply in pieces, each with the direction in force stamped in front of it
    const piece = ECHO.slice(0, ECHO.indexOf(' Could she'));
    for (const input of [piece, '%%%matter of fact%%% ' + piece, 'Tool: kade_research,']) {
      const r = await speak(input, { headers: { 'x-kade-caller': 'fork-tts' } });
      assert.equal(r.status, 200, log().slice(-1500));
      assert.equal(r.bytes, 0, 'no audio for a piece that is only the echo');
      assert.deepEqual(r.handed, [], 'and the provider is not asked');
    }
    const lines = await cuts(3);
    assert.equal(lines.length, 3, log().slice(-1500));
    for (const line of lines) assert.match(line, /^\[tool-echo\] cut: lane=fork-tts tool=kade_research chars=(\d+) of \1$/, 'the whole piece went');
    // ... and the piece BEHIND it is an ordinary sentence to this service (tool-echo.js: what it cannot see)
    const last = await speak('Could she monetize it, or does it have to be free?', { headers: { 'x-kade-caller': 'fork-tts' } });
    assert.match(last.heard, /Could she monetize it, or does it have to be free\?/);
  });
});

test('the lanes that read a document are left alone; every other caller of the route is treated as a reply', async () => {
  await withServer(32112, {}, async ({ speak, cuts, log }) => {
    const page = 'Chapter 4. What the workshop holds.\nTool: block_plane, for end grain and for easing an edge.\nTool: marking_gauge, set once and left alone.';
    for (const [name, headers] of [
      ['the Library reader', { 'x-kade-caller': 'fork-library', 'x-kade-tts-session': 'reading:user-1:book-1' }],
      ['the Library reader, by its name alone', { 'x-kade-caller': 'fork-library' }],
      ['a reading session, whoever calls', { 'x-kade-tts-session': 'reading:user-1:book-1' }],
      ['family history', { 'x-kade-caller': 'fork-family-history', 'x-kade-tts-session': 'family:user-1' }],
      ['described video', { 'x-kade-caller': 'fork-described-video' }],
    ]) {
      const r = await speak(page, { headers, body: { delivery: 'STABLE' } });
      assert.equal(r.status, 200, name + ': ' + log().slice(-1500));
      assert.match(r.heard, /What the workshop holds\..*for end grain and for easing an edge\..*set once and left alone\./, name + ': ' + JSON.stringify(r.handed));
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(echoLines(log()), [], 'nothing was cut on a reading lane');
    for (const [name, headers] of [
      ['the website and the apps', { 'x-kade-caller': 'fork-tts', 'x-kade-tts-session': 'user-1' }],
      ['a call', { 'x-kade-caller': 'bridge-phone' }],
      ['the radio', { 'x-kade-caller': 'fork-reverie-radio' }],
      ['a caller with no name', {}],
    ]) {
      const r = await speak(page, { headers });
      assert.equal(r.status, 200, name);
      assert.match(r.heard, /What the workshop holds\./, name);
      assert.doesNotMatch(r.heard, /end grain|left alone/, name + ': ' + JSON.stringify(r.handed));
    }
    const lines = await cuts(4);
    assert.deepEqual(lines.map((line) => line.replace(/^.*lane=(\S+) .*$/, '$1')), ['fork-tts', 'bridge-phone', 'fork-reverie-radio', 'speech']);
    assert.match(lines[0], /tool=unlisted \(11 chars, sha [0-9a-f]{8}\) chars=\d+ of \d+$/, 'a name that is not one of the platform\'s own is not printed');
  });
});

test('KADE_TOOL_ECHO_SPEECH=0: the text reaches the voice as it came, echo and all, and nothing is logged about it', async () => {
  await withServer(32113, { KADE_TOOL_ECHO_SPEECH: '0' }, async ({ speak, log }) => {
    const r = await speak(REPLY, { headers: { 'x-kade-caller': 'fork-tts' } });
    assert.equal(r.status, 200);
    assert.match(r.heard, /people left sitting in the dark\./);
    assert.match(r.heard, /Deep Research Context/, 'the echo is spoken again: ' + JSON.stringify(r.handed));
    assert.match(r.heard, /Could she monetize it, or does it have to be free\?/);
    await new Promise((res) => setTimeout(res, 300));
    assert.deepEqual(echoLines(log()), []);
  });
});

test('a reply of 100,000 characters that is mostly echo: only what she said reaches the provider', async () => {
  await withServer(32114, {}, async ({ speak, cuts, log }) => {
    const sentence = 'This is the answer, and it is a long one.';
    const said = (sentence + ' ').repeat(120).trimEnd();
    const results = 'Tool: web_search, === Web Results, Turn 0 ===\n' + 'Source: a page about it.\nSnippet: words and more words!\n\n'.repeat(1700);
    const input = (said + '\n' + results).slice(0, 100000);
    assert.equal(input.length, 100000);
    const t0 = Date.now();
    const r = await speak(input, { headers: { 'x-kade-caller': 'fork-tts' } });
    const ms = Date.now() - t0;
    assert.equal(r.status, 200, log().slice(-1500));
    assert.doesNotMatch(r.handed.join(' '), /Snippet|Source|Web Results|Tool/);
    assert.equal(r.heard.split(sentence).length - 1, 120, 'every sentence in front of the line is spoken once');
    assert.ok(ms < 20000, `the request took ${ms} ms`);
    assert.deepEqual(await cuts(1), [`[tool-echo] cut: lane=fork-tts tool=web_search chars=${100000 - said.length - 1} of 100000`]);
  });
});

test('a tab or a line break right after the comma is the echo too, as on the website (review of Nov 13)', async () => {
  await withServer(32115, {}, async ({ speak, cuts, log }) => {
    const sent = [];
    for (const [label, after] of [['a line break', '\n'], ['a tab', '\t'], ['CR LF', '\r\n']]) {
      const input = 'Well, yes. Right now ' + SAID + '\nTool: kade_research,' + after + ECHO.slice(ECHO.indexOf('==='));
      sent.push(input);
      const r = await speak(input, { headers: { 'x-kade-caller': 'fork-tts' } });
      assert.equal(r.status, 200, label + ': ' + log().slice(-1500));
      assert.match(r.heard, /Well, yes\..*people left sitting in the dark\./, label + ' keeps every word she said: ' + JSON.stringify(r.handed));
      assert.doesNotMatch(r.handed.join(' '), ECHO_WORDS, label + ' speaks the echo: ' + JSON.stringify(r.handed));
    }
    // a piece that is nothing but the echo, its line broken right after the comma, says nothing and asks the provider for nothing
    const piece = 'Tool: kade_research,\n=== Deep Research Context ===';
    const only = await speak(piece, { headers: { 'x-kade-caller': 'fork-tts' } });
    assert.equal(only.status, 200, log().slice(-1500));
    assert.equal(only.bytes, 0);
    assert.deepEqual(only.handed, []);
    const echoAt = (input) => input.indexOf('Tool: kade_research,');
    assert.deepEqual(await cuts(4), [...sent, piece].map((input) => `[tool-echo] cut: lane=fork-tts tool=kade_research chars=${input.length - echoAt(input)} of ${input.length}`));
    assert.doesNotMatch(log(), LOG_WORDS, 'the words of the reply are not in the log');
  });
});

/* Every file the service loads: server.js, then each local require in a file already found, inside a function or not (a
 * module loaded on first use takes its route down instead of the start). A .json is read, not run: nothing to follow. */
const LOCAL_REQUIRE = /require\(\s{0,8}(["'])(\.{1,2}\/[^"'\r\n]{1,200})\1\s{0,8}\)/g;
function serviceFiles(entry) {
  const seen = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.c?js$/.test(file)) continue;
    for (const m of fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(LOCAL_REQUIRE)) {
      let found;
      try { found = require.resolve(path.resolve(__dirname, path.dirname(file), m[2])); } catch { missing.push(`${file} loads ${m[2]}`); continue; }
      queue.push(path.relative(__dirname, found).split(path.sep).join('/'));
    }
  }
  return { files: [...seen], missing };
}

test('tool-echo.js and every other file the service loads are in git: server.js and librechat.js do not start without them (review of Nov 13)', (t) => {
  const { files, missing } = serviceFiles('server.js');
  assert.deepEqual(missing, [], 'every local require names a file that is here');
  for (const file of ['librechat.js', 'tool-echo.js', 'log-text.js']) assert.ok(files.includes(file), `the service loads ${file}`);
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true });
  } catch (e) {
    t.skip(`git cannot list this folder (${e.code || e.status || e.message}): nothing to compare with`);
    return;
  }
  const fold = (name) => (process.platform === 'win32' ? name.toLowerCase() : name);   // Windows finds a file whatever the case
  const tracked = new Set(listed.split('\0').filter(Boolean).map(fold));
  if (!tracked.has('server.js')) {
    t.skip('server.js itself is not in git here: this folder is not a checkout of the service');
    return;
  }
  assert.deepEqual(files.filter((file) => !tracked.has(fold(file))), [],
    'loaded by the service and not in git: git add each one, in the same commit as the code that loads it');
});
