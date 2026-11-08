'use strict';
// Nov 8 2026. httpsReq, the little https client inside POST /librechat/avatar-gen, only listened for the end of the response. A
// connection that resets in the middle of the body ends the response with 'aborted' and never with 'end', and the socket's idle
// timeout cannot fire on a socket that is already gone, so the promise waited forever: the caller got no answer until Railway's edge cut
// the request at 300 seconds (route-guard review of Nov 7 2026). Now a response that stops short rejects, and the route answers 502.
// Through the real HTTP handler; the image service is a local fixture (test-fixtures/bfl-local.cjs) that cuts its answers off on demand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SECRET = 'wire-test-librechat-secret-0123456789';
const PORT = 31930;
const FIXTURE_PORT = 31929;

function start(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-avatar-gen-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = {
    ...process.env, PORT: String(PORT), PROVIDER_RECEIPT: receipt, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', VOICE_AUTO_MOVE: '0',
    LIBRECHAT_PROXY_SECRET: SECRET, LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass', LIBRECHAT_BASE: 'http://127.0.0.1:9',
    FLUX_API_KEY: 'dummy-flux-key', FLUX_API_BASE_URL: 'https://bfl.test', BFL_FIXTURE_PORT: String(FIXTURE_PORT), ...extra,
  };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/bfl-local.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
  };
  return { state, stop };
}

async function ready(state) {
  for (let i = 0; i < 200 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// the image service: `plan` says what each of its three answers does
//   'ok'      a whole answer
//   'cut'     the status line, the headers and part of the body, then the socket is destroyed (a reset in the middle of the body)
//   'refused' the socket is destroyed before any answer
function imageService(plan) {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 7)]);
  const hits = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const kind = req.url.startsWith('/v1/flux-2-pro-preview') ? 'submit' : req.url.startsWith('/poll') ? 'poll' : 'image';
      hits.push(kind);
      const what = plan[kind];
      const body = kind === 'submit' ? Buffer.from(JSON.stringify({ id: 'task-1', polling_url: 'https://bfl.test/poll' }))
        : kind === 'poll' ? Buffer.from(JSON.stringify({ status: 'Ready', result: { sample: 'https://bfl.test/image.png' } }))
          : png;
      if (what === 'refused') return req.socket.destroy();
      res.writeHead(200, { 'Content-Type': kind === 'image' ? 'image/png' : 'application/json', 'Content-Length': body.length });
      if (what === 'cut') {
        res.write(body.subarray(0, 10));
        return setTimeout(() => req.socket.destroy(), 30);
      }
      return res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve({ server, hits, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) })));
}

function generate(waitMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const data = Buffer.from(JSON.stringify({ prompt: 'a friendly cartoon owl wearing a scarf' }));
    const t = setTimeout(() => { req.destroy(); resolve({ hang: true, ms: Date.now() - t0 }); }, waitMs);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/librechat/avatar-gen', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + SECRET } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), ms: Date.now() - t0 }); });
    });
    req.on('error', (e) => { clearTimeout(t); resolve({ reset: e.code || e.message, ms: Date.now() - t0 }); });
    req.end(data);
  });
}

async function scenario(plan, waitMs, check) {
  const svc = await imageService(plan);
  const s = start();
  try {
    assert.ok(await ready(s.state), s.state.log);
    const r = await generate(waitMs);
    await check(r, svc.hits, s.state);
    assert.equal(s.state.exited, null, s.state.log.slice(-500));
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/healthz`)).status, 200);
  } finally {
    await s.stop();
    await svc.close();
  }
}

const gone = (r, label) => {
  assert.ok(!r.hang, `${label}: no answer within ${r.ms} ms`);
  assert.equal(r.status, 502, `${label}: ${JSON.stringify(r)}`);
  assert.match(JSON.parse(r.body).error, /ECONNRESET|socket hang up|aborted/i, label);
};

test('a healthy run still returns the picture', async () => {
  await scenario({ submit: 'ok', poll: 'ok', image: 'ok' }, 15000, (r, hits) => {
    assert.equal(r.status, 200, JSON.stringify(r));
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.equal(j.bytes, 304);
    assert.equal(Buffer.from(j.image_b64, 'base64').length, 304);
    assert.deepEqual(hits, ['submit', 'poll', 'image']);
  });
});

test('the submit answer is cut off in the middle of its body: 502 at once, not a wait for the edge', async () => {
  await scenario({ submit: 'cut' }, 8000, (r, hits) => {
    gone(r, 'submit');
    assert.ok(r.ms < 4000, 'answered in ' + r.ms + ' ms');
    assert.deepEqual(hits, ['submit']);
  });
});

test('the poll answer is cut off: 502', async () => {
  await scenario({ submit: 'ok', poll: 'cut' }, 12000, (r, hits) => {
    gone(r, 'poll');
    assert.deepEqual(hits, ['submit', 'poll']);
  });
});

test('the picture itself is cut off while it downloads: 502', async () => {
  await scenario({ submit: 'ok', poll: 'ok', image: 'cut' }, 15000, (r, hits) => {
    gone(r, 'image');
    assert.deepEqual(hits, ['submit', 'poll', 'image']);
  });
});

test('a connection that is refused before any answer is still a 502 (this already worked)', async () => {
  await scenario({ submit: 'refused' }, 8000, (r) => {
    gone(r, 'refused');
  });
});
