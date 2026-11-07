'use strict';
// Nov 7 2026, step 3 of the route-guard series. POST /v1/audio/transcriptions read an upload with busboy, and an upload that
// stopped before its closing boundary ended the whole process, by two routes:
//   1. busboy destroys the open FILE stream with "Unexpected end of file" and nothing listened for 'error' on it (an unheard
//      'error' event is an uncaught exception, so no rejection handler could help);
//   2. busboy's own 'error' was answered 400, and then its 'close' event answered 200 on the same response: the second answer
//      threw ERR_HTTP_HEADERS_SENT inside an async callback, an unhandled rejection.
// Anyone holding the speech secret could send such a body under SPEECH_GATE=enforce, and anyone at all in log mode. Now every
// upload that cannot be read is answered 400 once, nothing reaches Deepgram, and the process keeps serving.
// Through the real HTTP handler, a Deepgram fixture instead of the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-transcription-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/deepgram.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, rows, stop };
}

async function ready(port, state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function withServer(port, run) {
  const s = start(port);
  try {
    assert.ok(await ready(port, s.state), s.state.log);
    return await run({ port, state: s.state, rows: s.rows });
  } finally {
    await s.stop();
  }
}

// one POST with a complete HTTP body (Content-Length matches); the MULTIPART inside may be cut short
function upload(port, body, { type = 'multipart/form-data; boundary=zzz' } = {}) {
  return new Promise((resolve) => {
    const data = Buffer.from(body, 'latin1');
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true }); }, 4000);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent: false, headers: { 'Content-Type': type, 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message }); });
    req.end(data);
  });
}

// raw bytes on a socket, so the request itself can be cut off; resolves with the status line (or what happened)
function rawSocket(port, text, { hangUpAfterMs = 0 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let out = '';
    const done = (what) => { clearTimeout(t); s.destroy(); resolve(what); };
    const t = setTimeout(() => done(out.split('\r\n')[0] || '(no reply)'), hangUpAfterMs || 1500);
    s.on('data', (d) => { out += d; if (/\r\n\r\n/.test(out) && !hangUpAfterMs) done(out.split('\r\n')[0]); });
    s.on('error', () => {});
    s.on('close', () => done(out.split('\r\n')[0] || '(closed, no reply)'));
    s.write(text);
  });
}

const HEAD = '--zzz\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n';
const EBML = String.fromCharCode(0x1a, 0x45, 0xdf, 0xa3);   // what Deepgram's content sniffer takes for webm
const AUDIO = EBML + 'A'.repeat(60);
const LANG = '--zzz\r\nContent-Disposition: form-data; name="language"\r\n\r\nen';
const END = '\r\n--zzz--\r\n';
const BODY_400 = '{"error":"Upload parse error."}';

// every one of these stops before the form is complete
const CUT_OFF = [
  ['a form with no file, cut off after a field value', LANG],
  ['cut off in the middle of the file', HEAD + AUDIO.slice(0, 30)],
  ['a whole file, then a field cut off', HEAD + AUDIO + '\r\n' + LANG],
  ['a whole file and the next boundary, but no closing --', HEAD + AUDIO + '\r\n--zzz'],
  ['a whole file and a boundary with a line break, but nothing after it', HEAD + AUDIO + '\r\n--zzz\r\n'],
  ['only the opening boundary', '--zzz\r\n'],
  ['cut off in the middle of a part header', '--zzz\r\nContent-Disposition: form-da'],
  ['nothing at all', ''],
  ['a file part that never starts its data', HEAD],
];

test('an upload that stops before its closing boundary answers 400 once, reaches no provider, and the proxy stays up', async () => {
  await withServer(31990, async ({ port, state, rows }) => {
    for (const [name, body] of CUT_OFF) {
      const r = await upload(port, body);
      assert.equal(state.exited, null, `${name} ended the process: ${state.log.slice(-600)}`);
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r)}`);
      assert.equal(r.body, BODY_400, name);
    }
    assert.equal(rows().length, 0, 'nothing was sent to Deepgram for any of them');
    assert.doesNotMatch(state.log, /ERR_HTTP_HEADERS_SENT|Unhandled|uncaught/i, 'no second answer, no unheard error');
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  });
});

test('the same cut-off uploads, thirty times over, are all answered and the process never wavers', async () => {
  await withServer(31991, async ({ port, state, rows }) => {
    for (let i = 0; i < 30; i++) {
      const [name, body] = CUT_OFF[i % CUT_OFF.length];
      const r = await upload(port, body);
      assert.equal(r.status, 400, `round ${i} (${name}): ${JSON.stringify(r)}`);
    }
    assert.equal(state.exited, null);
    assert.equal(rows().length, 0);
  });
});

test('a client that hangs up in the middle of an upload, or sends a cut-off chunked body, does not end the process either', async () => {
  await withServer(31992, async ({ port, state }) => {
    const headers = `POST /v1/audio/transcriptions HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=zzz\r\n`;
    // announces 100,000 bytes, sends part of one file, then goes
    await rawSocket(port, headers + `Content-Length: 100000\r\n\r\n` + HEAD + AUDIO, { hangUpAfterMs: 400 });
    assert.equal(state.exited, null, 'hung up mid-file: ' + state.log.slice(-400));
    // goes away in the middle of a part header
    await rawSocket(port, headers + `Content-Length: 100000\r\n\r\n--zzz\r\nContent-Disposition: form-da`, { hangUpAfterMs: 400 });
    assert.equal(state.exited, null, 'hung up mid-header: ' + state.log.slice(-400));
    // a chunked body whose last chunk arrives while the file is still open
    const chunk = HEAD + 'AAAA';
    const status = await rawSocket(port, headers + `Transfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n0\r\n\r\n`);
    assert.equal(status, 'HTTP/1.1 400 Bad Request');
    assert.equal(state.exited, null, 'chunked and cut off: ' + state.log.slice(-400));
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  });
});

test('an upload that is whole still reaches Deepgram and comes back as text; a form with no file, or an empty file, is still { text: "" }', async () => {
  await withServer(31993, async ({ port, state, rows }) => {
    const ok = await upload(port, HEAD + AUDIO + END);
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '{"text":"hello from the fixture"}');
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].contentType, 'audio/webm');
    assert.equal(rows()[0].bytes, AUDIO.length);
    assert.match(rows()[0].url, /model=nova-3/);
    assert.doesNotMatch(rows()[0].url, /language=/);

    const withLanguage = await upload(port, LANG + '\r\n' + HEAD + AUDIO + END);
    assert.equal(withLanguage.body, '{"text":"hello from the fixture"}');
    assert.match(rows()[1].url, /language=en/);

    const noFile = await upload(port, LANG + END);
    assert.equal(noFile.status, 200);
    assert.equal(noFile.body, '{"text":""}');
    const emptyFile = await upload(port, HEAD.replace('\r\n\r\n', '\r\n\r\n') + END);
    assert.equal(emptyFile.status, 200);
    assert.equal(emptyFile.body, '{"text":""}');
    assert.equal(rows().length, 2, 'only the two whole uploads reached Deepgram');
    assert.equal(state.exited, null);
  });
});

test('after an upload is refused early, the rest of its body is read and dropped: the next request on the same connection is served', async () => {
  await withServer(31990, async ({ port }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      // a malformed part header, then 3 MB that nobody would otherwise read
      const big = Buffer.concat([Buffer.from('--zz\r\nContent-Disposition form-data\r\n\r\n'), Buffer.alloc(3 * 1024 * 1024, 0x41)]);
      const first = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { req.destroy(); reject(new Error('the refused upload never finished: the connection is stuck behind its unread body')); }, 4000);
        const req = http.request({ host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent, headers: { 'Content-Type': 'multipart/form-data; boundary=zz', 'Content-Length': big.length } }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('close', () => clearTimeout(timer));
        req.end(big);
      });
      assert.equal(first.status, 400);
      assert.equal(first.body, BODY_400);
      const t0 = Date.now();
      const second = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { req.destroy(); reject(new Error('the next request on the same connection was not answered')); }, 2500);
        const req = http.request({ host: '127.0.0.1', port, path: '/healthz', agent }, (res) => {
          res.resume();
          res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, reused: req.reusedSocket === true }); });
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(second.status, 200);
      assert.equal(second.reused, true, 'the same connection carried it');
      assert.ok(Date.now() - t0 < 2000);
    } finally {
      agent.destroy();
    }
  });
});

test('a request that is not multipart at all is a 400 "Bad multipart request."', async () => {
  await withServer(31994, async ({ port, state }) => {
    for (const type of ['multipart/form-data', 'application/json', 'text/plain']) {
      const r = await upload(port, '{}', { type });
      assert.equal(r.status, 400, type);
      assert.match(r.body, /Bad multipart request|Upload parse error/, type);
    }
    assert.equal(state.exited, null);
  });
});
