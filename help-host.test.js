'use strict';
// Nov 8 2026. The route-guard review of Nov 7 found that every /help page answered 500 when the request had no Host header
// (HTTP/1.0) or an empty one: the redirect rule for the old railway.app address read `req.hostname.endsWith(...)`, and Express
// 4 leaves req.hostname undefined without a Host. The help pages are the front door of the platform for a blind family: they
// must open for any client that can reach them, and the redirect rule must keep doing what it did for a real railway.app Host.
// (First part: the help router alone in a bare Express app. Second part: the real server, with the route guard in front.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');

// raw bytes on a socket; resolves with { status, headers (lowercased), body }
function raw(port, text) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks = [];
    const done = () => {
      clearTimeout(t);
      s.destroy();
      const all = Buffer.concat(chunks).toString('utf8');
      const [head, ...rest] = all.split('\r\n\r\n');
      const lines = head.split('\r\n');
      const headers = {};
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
      resolve({ status: Number((lines[0].match(/^HTTP\/\d\.\d (\d+)/) || [])[1]) || null, line: lines[0], headers, body: rest.join('\r\n\r\n') });
    };
    const t = setTimeout(done, 3000);
    s.on('data', (d) => chunks.push(d));
    s.on('close', done);
    s.on('error', () => {});
    s.write(text);
  });
}

const CASES = (pathName) => ({
  noHost10: `GET ${pathName} HTTP/1.0\r\n\r\n`,
  emptyHost11: `GET ${pathName} HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n`,
  portOnlyHost: `GET ${pathName} HTTP/1.1\r\nHost: :8080\r\nConnection: close\r\n\r\n`,
  localhost: `GET ${pathName} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
  ordinary: `GET ${pathName} HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`,
  railwayHost: `GET ${pathName}?x=1 HTTP/1.1\r\nHost: inworld-tts-proxy-production.up.railway.app\r\nConnection: close\r\n\r\n`,
  railwayHostFixedOrigin: `GET ${pathName} HTTP/1.1\r\nHost: inworld-tts-proxy-production.up.railway.app\r\nX-Kade-Help-Proxy: 1\r\nConnection: close\r\n\r\n`,
});

function check(label, r, pathName) {
  if (label === 'railwayHost') {
    assert.equal(r.status, 302, `${label}: the old address still redirects: ${r.line}`);
    assert.match(r.headers.location, new RegExp(`${pathName.replace(/\//g, '\\/')}\\?x=1$`), 'and keeps the path and query');
  } else {
    assert.equal(r.status, 200, `${label}: ${r.line} ${r.body.slice(0, 120)}`);
    assert.match(r.headers['content-type'], /^text\/html/, label);
    assert.match(r.body, /<h1[ >]/, `${label}: a page came back`);
  }
}

test('the help router alone: pages open with no Host, an empty Host and a Host that is only a port; the railway.app redirect is unchanged', async () => {
  const app = express();
  app.use(require('./help'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const port = server.address().port;
    for (const pathName of ['/help', '/help/android']) {
      for (const [label, text] of Object.entries(CASES(pathName))) check(label, await raw(port, text), pathName);
    }
  } finally {
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
  }
});

function start(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-help-host-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, VOICE_AUTO_MOVE: '0' };
  delete env.SPEECH_GATE;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('the real server: the same requests, and nothing is logged as a failure of the proxy', async () => {
  const port = 31949;
  const s = start(port);
  try {
    let up = false;
    for (let i = 0; i < 200 && !up && s.state.exited === null; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, s.state.log);
    for (const pathName of ['/help', '/help/android']) {
      for (const [label, text] of Object.entries(CASES(pathName))) check(label, await raw(port, text), pathName);
    }
    assert.doesNotMatch(s.state.log, /failed with 500/, 'no request ended in a 500');
    assert.equal(s.state.exited, null);
  } finally {
    await s.stop();
  }
});
