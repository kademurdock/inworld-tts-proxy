"use strict";
/* Oct 16 2026: the speech routes stop answering strangers. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSpeechGate, parseSecrets, callerNet } = require("./speech-gate");

const SECRET = "speech-secret-0123456789abcdef";
const ADMIN = "admin-secret-0123456789abcdef";

function quietLog() {
  const lines = [];
  return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m) };
}

function req({ headers = {}, method = "POST", url = "/v1/audio/speech" } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { method, originalUrl: url, headers: lower, get: (n) => lower[n.toLowerCase()] };
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function run(gate, request) {
  const response = res();
  let passed = false;
  gate.middleware(request, response, () => { passed = true; });
  return { passed, response };
}

function gate(env, log = quietLog()) {
  return { g: createSpeechGate({ env, log, timers: false }), log };
}

test("enforce: no secret is refused with 401 and a plain sentence", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET });
  const { passed, response } = run(g, req());
  assert.equal(passed, false);
  assert.equal(response.statusCode, 401);
  assert.match(response.body.error, /only answers the Kade-AI platform/);
});

test("enforce: the x-proxy-secret header passes", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET });
  assert.equal(run(g, req({ headers: { "x-proxy-secret": SECRET } })).passed, true);
});

test("enforce: LibreChat's Bearer apiKey passes, and the old placeholder does not", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET });
  assert.equal(run(g, req({ headers: { Authorization: `Bearer ${SECRET}` } })).passed, true);
  assert.equal(run(g, req({ headers: { Authorization: "Bearer placeholder" } })).passed, false);
  assert.equal(run(g, req({ headers: { Authorization: "Bearer ${KADE_SPEECH_SECRET}" } })).passed, false);
});

test("enforce: the proxy's own admin secret also passes", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET, LIBRECHAT_PROXY_SECRET: ADMIN });
  assert.equal(run(g, req({ headers: { "x-proxy-secret": ADMIN } })).passed, true);
  assert.equal(run(g, req({ headers: { Authorization: `Bearer ${ADMIN}` } })).passed, true);
});

test("enforce: a wrong secret, a prefix of the secret and a longer string are all refused", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET });
  for (const v of ["nope", SECRET.slice(0, -1), SECRET + "x", ` ${SECRET}x`]) {
    assert.equal(run(g, req({ headers: { "x-proxy-secret": v } })).response.statusCode, 401, v);
  }
});

test("two secrets separated by a comma both work, so a rotation needs no gap", () => {
  const other = "the-next-secret-abcdef0123456789";
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: `${SECRET}, ${other}` });
  assert.equal(run(g, req({ headers: { "x-proxy-secret": SECRET } })).passed, true);
  assert.equal(run(g, req({ headers: { "x-proxy-secret": other } })).passed, true);
});

test("log mode lets everything through and names the caller it would refuse", () => {
  const { g, log } = gate({ SPEECH_GATE: "log", KADE_SPEECH_SECRET: SECRET });
  const r = req({ headers: { "user-agent": "curl/8.1", origin: "https://kademurdock.com", "x-forwarded-for": "203.0.113.77, 10.0.0.1" } });
  assert.equal(run(g, r).passed, true);
  const line = log.lines.find((l) => l.includes("would refuse"));
  assert.ok(line, log.lines.join("\n"));
  assert.match(line, /missing POST \/v1\/audio\/speech/);
  assert.match(line, /origin=https:\/\/kademurdock\.com/);
  assert.match(line, /net=203\.0\.113\.x/);
  assert.match(line, /ua="curl\/8\.1"/);
  assert.ok(!line.includes(SECRET));
});

test("log mode never writes a presented secret into the log, right or wrong", () => {
  const { g, log } = gate({ SPEECH_GATE: "log", KADE_SPEECH_SECRET: SECRET });
  run(g, req({ headers: { "x-proxy-secret": "a-wrong-but-secret-looking-value" } }));
  run(g, req({ headers: { "x-proxy-secret": SECRET, "x-kade-caller": "bridge-phone" } }));
  const s = g.summary();
  const all = log.lines.join("\n") + "\n" + s;
  assert.ok(!all.includes("a-wrong-but-secret-looking-value"));
  assert.ok(!all.includes(SECRET));
  assert.match(s, /allowed 1 \(bridge-phone\/header 1\)/);
  assert.match(s, /would refuse 1 \(wrong-header/);
});

test("the summary counts allowed lanes and resets after it is read", () => {
  const { g } = gate({ SPEECH_GATE: "log", KADE_SPEECH_SECRET: SECRET });
  run(g, req({ headers: { Authorization: `Bearer ${SECRET}`, "x-kade-caller": "fork-tts" } }));
  run(g, req({ headers: { Authorization: `Bearer ${SECRET}`, "x-kade-caller": "fork-tts" } }));
  run(g, req({ headers: { "x-proxy-secret": SECRET } }));
  assert.match(g.summary(), /allowed 3 \(fork-tts\/bearer 2, unnamed\/header 1\); would refuse 0/);
  assert.equal(g.summary(), null);
});

test("enforce without a secret falls back to log and says so at boot", () => {
  const { g, log } = gate({ SPEECH_GATE: "enforce" });
  assert.equal(g.mode(), "log");
  assert.match(log.lines[0], /KADE_SPEECH_SECRET is not set, so the gate only LOGS/);
  assert.equal(run(g, req()).passed, true);
});

test("an unknown mode word means log; off checks nothing; the default is log", () => {
  assert.equal(gate({ SPEECH_GATE: "ENFORCED", KADE_SPEECH_SECRET: SECRET }).g.mode(), "log");
  assert.equal(gate({ KADE_SPEECH_SECRET: SECRET }).g.mode(), "log");
  const { g, log } = gate({ SPEECH_GATE: "off", KADE_SPEECH_SECRET: SECRET });
  assert.equal(run(g, req()).passed, true);
  assert.equal(log.lines.filter((l) => l.includes("refuse")).length, 0);
});

test("browser preflights pass untouched so CORS can still answer them", () => {
  const { g } = gate({ SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET });
  assert.equal(run(g, req({ method: "OPTIONS" })).passed, true);
});

test("a flood is logged at most twenty lines a minute but still counted", () => {
  let t = 0;
  const log = quietLog();
  const g = createSpeechGate({ env: { SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET }, log, now: () => t, timers: false });
  for (let i = 0; i < 50; i++) run(g, req());
  assert.equal(log.lines.filter((l) => l.startsWith("[speech-gate] refused:")).length, 20);
  assert.match(g.summary(), /refused 50/);
  t = 61000;
  run(g, req());
  assert.equal(log.lines.filter((l) => l.startsWith("[speech-gate] refused:")).length, 21);
});

test("short or empty secrets are ignored rather than trusted", () => {
  assert.deepEqual(parseSecrets("", " ", "short", undefined), []);
  assert.deepEqual(parseSecrets(`${SECRET},,tiny`), [SECRET]);
});

test("callerNet keeps only the /24", () => {
  assert.equal(callerNet(req({ headers: { "x-forwarded-for": "198.51.100.23" } })), "198.51.100.x");
  assert.equal(callerNet(req({ headers: {} })), "none");
});
