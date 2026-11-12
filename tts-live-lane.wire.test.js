'use strict';
// Nov 12 2026 (gateway audit GW-9). The speech route against a paced fake Inworld (test-fixtures/provider-inworld-paced.cjs): a call's
// sentence goes ahead of a long read-aloud on a slot kept for it; a request whose caller left gives its queue spots back and ends its
// provider calls without an error line; the short live ladder applies only when INWORLD_LIVE_TIMEOUT_MS is set; typos in the new
// variables never stop speech; TTS_LIVE_FIRST=0 is the old single line. Real server; the fixtures block the network, nothing is paid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LONG = 'The garden is quiet today and the birds are singing in the old pear tree. '.repeat(200); // ~15,000 characters
const LIVE = 'Live call sentence, said to the person on the line.';
const BRIDGE_PHONE = { 'x-kade-caller': 'bridge-phone' };

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-live-lane-'));
  const receipt = path.join(dir, 'requests.jsonl');
  const paced = path.join(dir, 'paced.jsonl');
  fs.writeFileSync(receipt, '');
  fs.writeFileSync(paced, '');
  const env = {
    ...process.env, PORT: String(port), PROVIDER_RECEIPT: receipt, PACED_RECEIPT: paced,
    LIBRECHAT_PROXY_SECRET: 'wire-test-librechat-secret-0123456789',
    INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', DEEPGRAM_API_KEY: 'offline',
    LIBRECHAT_USER: 'wire-test@example.invalid', LIBRECHAT_PASS: 'dummy-pass',
    LIBRECHAT_BASE: 'http://127.0.0.1:9', LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_MIN_GAP_MS: '1', VOICE_AUTO_MOVE: '0',
    ...extra,
  };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM', 'SPEECH_GATE',
    'TTS_LIVE_FIRST', 'TTS_LIVE_RESERVE', 'INWORLD_LIVE_TIMEOUT_MS', 'INWORLD_LIVE_TIMEOUT_MAX_MS', 'INWORLD_LIVE_ATTEMPTS'].filter((k) => !(k in extra))) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'),
    '--require', path.join(__dirname, 'test-fixtures/provider-inworld-paced.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { log: '', exited: null };
  child.stdout.on('data', (x) => { state.log += x; });
  child.stderr.on('data', (x) => { state.log += x; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const events = () => fs.readFileSync(paced, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const stop = async () => {
    if (!state.exited) child.kill();
    await new Promise((r) => (state.exited ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { state, events, stop };
}
async function ready(port, state) {
  for (let i = 0; i < 600 && state.exited === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 500) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
// { kind: 'response', status, raw, ms } | { kind: 'left', ms } when leaveAfterMs destroyed it | { kind: 'hang' }
function speak(port, input, { headers = {}, query = '', timeoutMs = 60000, leaveAfterMs = 0 } = {}) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify({ input, voice: 'alloy' }), 'utf8');
    const t0 = Date.now();
    const timer = setTimeout(() => { req.destroy(); resolve({ kind: 'hang', ms: Date.now() - t0 }); }, timeoutMs);
    const req = http.request({ host: '127.0.0.1', port, path: `/v1/audio/speech${query}`, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ kind: 'response', status: res.statusCode, raw: Buffer.concat(chunks), ms: Date.now() - t0 }); });
      res.on('error', () => {});
    });
    if (leaveAfterMs) setTimeout(() => { clearTimeout(timer); req.destroy(); resolve({ kind: 'left', ms: Date.now() - t0 }); }, leaveAfterMs);
    req.on('error', () => {});
    req.end(data);
  });
}
// Peak calls in flight at the fixture, all and per kind.
function peaks(events) {
  let all = 0, live = 0, rest = 0;
  const peak = { all: 0, live: 0, rest: 0 };
  for (const e of events) {
    const d = e.ev === 'start' ? 1 : -1;
    all += d; if (e.live) live += d; else rest += d;
    peak.all = Math.max(peak.all, all); peak.live = Math.max(peak.live, live); peak.rest = Math.max(peak.rest, rest);
  }
  return peak;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a call sentence goes ahead of a 15,000-character read-aloud, on the slot kept for it', async () => {
  const s = start(32041);
  try {
    assert.ok(await ready(32041, s.state), s.state.log.slice(-2000));
    const read = speak(32041, LONG);
    await sleep(400);
    const call = await speak(32041, LIVE, { headers: BRIDGE_PHONE, query: '?telephony=1' });
    assert.equal(call.kind, 'response');
    assert.equal(call.status, 200, s.state.log.slice(-800));
    const r = await read;
    assert.equal(r.status, 200);
    const ev = s.events();
    const p = peaks(ev);
    assert.ok(p.all <= 6, `never more than 6 at once (saw ${p.all})`);
    assert.ok(p.rest <= 5, `the read-aloud kept to 5 slots (saw ${p.rest})`);
    const liveStart = ev.find((e) => e.ev === 'start' && e.live);
    const restEndsBefore = ev.filter((e) => e.ev === 'end' && !e.live && e.at <= liveStart.at).length;
    const restTotal = ev.filter((e) => e.ev === 'start' && !e.live).length;
    assert.ok(restTotal >= 20, `the read-aloud really was long (${restTotal} chunks)`);
    assert.ok(restEndsBefore < restTotal - 10, `the call did not wait behind the read (it started after ${restEndsBefore} of ${restTotal} chunks)`);
    assert.ok(call.ms < r.ms, `the call (${call.ms} ms) finished before the read-aloud (${r.ms} ms)`);
  } finally {
    await s.stop();
  }
});

test('a read-aloud whose caller left drops its queued chunks and logs no error', async () => {
  const s = start(32042);
  try {
    assert.ok(await ready(32042, s.state), s.state.log.slice(-2000));
    const r = await speak(32042, LONG, { leaveAfterMs: 300 });
    assert.equal(r.kind, 'left');
    await sleep(1500);
    const starts = s.events().filter((e) => e.ev === 'start').length;
    assert.ok(starts <= 10, `only the chunks already in flight reached the provider (${starts})`);
    assert.match(s.state.log, /the caller left before its audio was ready \(not live\)/);
    assert.doesNotMatch(s.state.log, /Proxy error:/);
    const health = await (await fetch('http://127.0.0.1:32042/health')).text();
    assert.doesNotMatch(health, /"failed":[1-9]/, 'abandoned chunks are not counted as failures');
  } finally {
    await s.stop();
  }
});

test('the short live ladder runs only when INWORLD_LIVE_TIMEOUT_MS is set', async () => {
  const s = start(32043, { INWORLD_STALL: '1', INWORLD_LIVE_TIMEOUT_MS: '1000' });
  try {
    assert.ok(await ready(32043, s.state), s.state.log.slice(-2000));
    const call = await speak(32043, LIVE, { headers: BRIDGE_PHONE, query: '?telephony=1', timeoutMs: 15000 });
    assert.equal(call.kind, 'response');
    assert.ok(call.status >= 500);
    assert.match(s.state.log, /chunk attempt 1\/2 failed \(Inworld request timed out after 1000ms\)/);
    assert.doesNotMatch(s.state.log, /attempt 2\/2 failed.*retrying/);
    // A request nobody is on the line for keeps the 4-attempt, 20 s ladder: its first attempt is still running after 3 s.
    const read = await speak(32043, 'A plain chat sentence.', { leaveAfterMs: 3000 });
    assert.equal(read.kind, 'left');
    await sleep(300);
    assert.doesNotMatch(s.state.log, /attempt 1\/4 failed/);
  } finally {
    await s.stop();
  }
});

test('typos in the new variables never stop speech', async () => {
  const s = start(32044, { TTS_LIVE_RESERVE: 'abc', INWORLD_LIVE_ATTEMPTS: '0', INWORLD_LIVE_TIMEOUT_MS: 'x', INWORLD_FIXTURE_MS: '20' });
  try {
    assert.ok(await ready(32044, s.state), s.state.log.slice(-2000));
    const call = await speak(32044, LIVE, { headers: BRIDGE_PHONE, query: '?telephony=1', timeoutMs: 15000 });
    assert.equal(call.status, 200, s.state.log.slice(-800));
    const chat = await speak(32044, 'A plain chat sentence.', { timeoutMs: 15000 });
    assert.equal(chat.status, 200);
    assert.equal(chat.raw.toString('latin1', 0, 4), 'RIFF');
  } finally {
    await s.stop();
  }
});

test('TTS_LIVE_FIRST=0: one line again, and the read-aloud may use all six slots', async () => {
  const s = start(32045, { TTS_LIVE_FIRST: '0' });
  try {
    assert.ok(await ready(32045, s.state), s.state.log.slice(-2000));
    const r = await speak(32045, LONG.slice(0, 6000));
    assert.equal(r.status, 200);
    assert.equal(peaks(s.events()).rest, 6);
  } finally {
    await s.stop();
  }
});
