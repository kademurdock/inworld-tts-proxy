"use strict";
/* Nov 8 2026: the speech gate must not be a way to hurt the service. The route-guard review of Nov 7 found two things in it that any
 * stranger can reach (the gate looks at a request before it knows who is asking):
 *   - callerNet() ran /(\d+)\.(\d+)\.(\d+)\.\d+$/ on the first X-Forwarded-For element, whatever its length. That regex is quadratic on a
 *     long run of digits: a 16 KB header cost 0.2 to 0.4 s of CPU per request on an idle machine (2.1 to 2.3 s under load), and twelve at once held /healthz for 2 s to more than 20 s;
 *   - the `refused` counter was keyed by path, user agent, origin and caller with no cap until the ten-minute summary, and the path was
 *     the one part that was not clipped: 4,000 requests with 15 KB paths took the heap up by 59 to 76 MB.
 * (speech-gate.test.js has the gate's rules; this file only has the limits.)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const v8 = require("node:v8");
const vm = require("node:vm");
const { createSpeechGate, callerNet } = require("./speech-gate");

const SECRET = "speech-secret-0123456789abcdef";
const MB = 1024 * 1024;

// a garbage collector without a command-line flag, so the memory tests can measure what is really kept
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

function quietLog() {
  const lines = [];
  return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m) };
}

function req({ headers = {}, method = "POST", url = "/v1/audio/speech", ip } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { method, originalUrl: url, headers: lower, ip, get: (n) => lower[n.toLowerCase()] };
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function enforcing(log = quietLog()) {
  return createSpeechGate({ env: { SPEECH_GATE: "enforce", KADE_SPEECH_SECRET: SECRET }, log, timers: false });
}

function pass(g, request) {
  let passed = false;
  g.middleware(request, res(), () => { passed = true; });
  return passed;
}

function heapAfter(work) {
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const keep = work();
  gc(); gc();
  const grown = process.memoryUsage().heapUsed - before;
  return { grown, keep };
}

test("callerNet: what a real caller gets is exactly what it got before the limits", () => {
  const net = (xff, ip) => callerNet(req({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, ip }));
  assert.equal(net("198.51.100.23"), "198.51.100.x");
  assert.equal(net("198.51.100.23, 10.0.0.1, 10.0.0.2"), "198.51.100.x", "the first element of a list");
  assert.equal(net("  203.0.113.9  "), "203.0.113.x");
  assert.equal(net("::ffff:203.0.113.9"), "203.0.113.x", "an IPv4-mapped IPv6 address ends in an IPv4 one");
  assert.equal(net("2001:db8:85a3:8d3:1319:8a2e:370:7348"), "2001:db8:85a3:8d3:x", "IPv6 keeps four groups");
  assert.equal(net("198.51.100.23:4711"), "198.51.100.23:4711:x", "an address with a port takes the IPv6 branch, as it always did");
  assert.equal(net("unknown"), "?");
  assert.equal(net(undefined, "203.0.113.77"), "203.0.113.x", "no header: the connection's address");
  assert.equal(net(undefined, undefined), "none");
  assert.equal(net("", ""), "none");
});

test("callerNet: a 16 KB header of digits (and its cousins) costs microseconds, not a third of a second", () => {
  const run = (header) => callerNet(req({ headers: { "x-forwarded-for": header } }));
  const N = 16 * 1024;
  const shapes = {
    "all digits": "1".repeat(N),
    "a dot, then digits": "1." + "1".repeat(N),
    "two dots, then digits": "1.1." + "1".repeat(N),
    "three runs of digits": ("1".repeat(N / 3) + ".").repeat(3) + "1".repeat(N / 3),
    "digits and a colon": "1".repeat(N) + ":1",
    "digits with a trailing address": "1".repeat(N) + ".1.2.3.4",
  };
  for (const [label, header] of Object.entries(shapes)) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 4; i++) run(header);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 40, `${label}: four calls took ${ms.toFixed(1)} ms`);
  }
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 4; i++) callerNet(req({ headers: {}, ip: "1".repeat(N) }));
  assert.ok(Number(process.hrtime.bigint() - t1) / 1e6 < 40, "the connection's own address is read as briefly when it has to stand in for a missing header");
  const label = run("1".repeat(N));
  assert.ok(label.length <= 70, "and the label it makes is short: " + label.length);
  assert.ok(run(("1".repeat(60) + ":").repeat(500)).length <= 70, "an IPv6-looking label is short too");
});

test("the refused counter does not keep long paths: 4,000 requests with 15 KB paths cost under 8 MB of heap, the summary still says 4,000", () => {
  const g = enforcing();
  const { grown } = heapAfter(() => {
    for (let i = 0; i < 4000; i++) pass(g, req({ url: `/v1/audio/speech/${i}${"x".repeat(15000)}?${"q".repeat(100)}` }));
  });
  assert.ok(grown < 8 * MB, `the heap grew by ${(grown / MB).toFixed(1)} MB`);
  const line = g.summary();
  assert.match(line, /refused 4000/);
  assert.ok(line.length < 4000, "and the summary line stays short: " + line.length);
  assert.ok(!line.includes("x".repeat(100)), "no long path in it");
});

test("the log line for a refused request clips the path, and never holds the query string", () => {
  const log = quietLog();
  const g = enforcing(log);
  pass(g, req({ url: `/v1/audio/speech/${"y".repeat(5000)}?apikey=hunter2` }));
  const line = log.lines.find((l) => l.startsWith("[speech-gate] refused:"));
  assert.ok(line.length < 500, "log line: " + line.length);
  assert.doesNotMatch(line, /hunter2|apikey/);
  assert.match(line, /^\[speech-gate\] refused: missing POST \/v1\/audio\/speech\/y+ caller=unnamed /);
  // a short path with a query string: the query is what must not be kept (an api key sent in the URL, say)
  const g2 = enforcing(log);
  pass(g2, req({ url: "/v1/audio/speech?apikey=hunter2" }));
  const line2 = log.lines.filter((l) => l.startsWith("[speech-gate] refused:")).at(-1);
  assert.match(line2, /^\[speech-gate\] refused: missing POST \/v1\/audio\/speech caller=unnamed /);
  assert.doesNotMatch(g2.summary(), /hunter2|apikey/);
});

test("the refused counter keeps at most 100 callers a window and counts the rest together; the total is still right", () => {
  const g = enforcing();
  const N = 100000;
  const { grown } = heapAfter(() => {
    for (let i = 0; i < N; i++) pass(g, req({ headers: { "user-agent": "bot-" + i, origin: "https://o" + i + ".example" } }));
  });
  assert.ok(grown < 8 * MB, `the heap grew by ${(grown / MB).toFixed(1)} MB`);
  const line = g.summary();
  assert.match(line, new RegExp(`refused ${N}`), line.slice(0, 200));
  assert.match(line, /\(other callers\) x\d+/, "the callers past the cap are counted together");
  const other = Number(/\(other callers\) x(\d+)/.exec(line)[1]);
  assert.equal(other, N - 100, "100 callers were kept by name");
});

test("a caller already counted by name keeps its own count after the cap is reached", () => {
  const g = enforcing();
  for (let i = 0; i < 700; i++) pass(g, req({ headers: { "user-agent": "bot-" + i } }));
  for (let i = 0; i < 5; i++) pass(g, req({ headers: { "user-agent": "bot-3" } }));
  pass(g, req({ headers: { "user-agent": "bot-650" } }));
  const line = g.summary();
  assert.match(line, /ua="bot-3" x6/, "bot-3 was counted before the cap, so it is still counted by name: " + line);
  assert.doesNotMatch(line, /ua="bot-650" x/, "bot-650 came after the cap, so it is in the common count");
  assert.match(line, /refused 706/);
  assert.equal(g.summary(), null, "and the window resets as before");
  pass(g, req({ headers: { "user-agent": "bot-650" } }));
  assert.match(g.summary(), /ua="bot-650" x1/, "a new window starts with an empty counter");
});

test("the allowed counter has the same cap (a leaked secret must not be a way to fill the heap either)", () => {
  const g = enforcing();
  const N = 50000;
  const { grown } = heapAfter(() => {
    for (let i = 0; i < N; i++) assert.equal(pass(g, req({ headers: { "x-proxy-secret": SECRET, "x-kade-caller": "lane-" + i } })), true);
  });
  assert.ok(grown < 8 * MB, `the heap grew by ${(grown / MB).toFixed(1)} MB`);
  const line = g.summary();
  assert.match(line, new RegExp(`allowed ${N}`));
  assert.match(line, new RegExp(`\\(other callers\\) ${N - 100}`));
});

test("the route in a refused request's log line and counter key is cut at exactly 80 characters", () => {
  const log = quietLog();
  const g = enforcing(log);
  const exact = "/v1/audio/speech/" + "z".repeat(63);
  assert.equal(exact.length, 80);
  pass(g, req({ url: exact }));
  pass(g, req({ url: exact + "z" }));
  const lines = log.lines.filter((l) => l.startsWith("[speech-gate] refused:"));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes(` POST ${exact} caller=`), "80 characters are kept whole");
  assert.ok(lines[1].includes(` POST ${exact} caller=`) && !lines[1].includes(exact + "z"), "the 81st is cut");
});

test("a refused request's log line carries no control or invisible character of the caller's choosing (reviewer A, A5)", () => {
  const log = quietLog();
  const g = enforcing(log);
  // C1 controls (NEL, CSI) pass the HTTP parser in a header value; the others are what a terminal or a log viewer acts on
  const evil = "A\u0085B\u009b[31mC\u0007D\u001bE\u200bF\u2028G\u2029H\ufeffI\u0009J\u202eK\"L";
  for (const header of ["user-agent", "origin", "x-kade-caller"]) pass(g, req({ headers: { [header]: evil } }));
  const lines = log.lines.filter((l) => l.startsWith("[speech-gate] refused:"));
  assert.equal(lines.length, 3);
  for (const l of lines) {
    assert.doesNotMatch(l, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u, JSON.stringify(l));
    assert.match(l, /A B.*C.*D.*E.*F.*G.*H.*I.*J.*K.*L|A-B/, 'the printable letters of the header are still there: ' + l);
  }
  assert.match(lines[0], / ua="[^"]*"$/, 'a quote in the user agent cannot close the quoted field early: ' + lines[0]);
  assert.ok(lines[0].endsWith('K L"'), lines[0]);
});
