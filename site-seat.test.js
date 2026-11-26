"use strict";
/* site-seat.test.js -- Nov 26 2026 (Part 461). Calls to the site carry X-Kade-Service; calls to
 * anywhere else never do, not even after a redirect from the site. No network beyond 127.0.0.1. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const seat = require("./site-seat");

const SECRET = "test-only-seat-secret-0123456789abcdef";

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
function echo(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ seat: req.headers["x-kade-service"] || null, method: req.method, body, ua: req.headers["user-agent"] || null }));
  });
}
const realFetch = globalThis.fetch;
const call = (env, input, init) => seat.seatFetch(realFetch, input, init, env);

test("only the site origins count", () => {
  const env = { LIBRECHAT_BASE: "https://kademurdock.com", LIBRECHAT_URL: "https://kade-production.up.railway.app/" };
  assert.equal(seat.isSiteUrl("https://kademurdock.com/api/auth/login", env), true);
  assert.equal(seat.isSiteUrl("https://kade-production.up.railway.app/api", env), true);
  assert.equal(seat.isSiteUrl("https://kademurdock.com.evil.example/api", env), false);
  assert.equal(seat.isSiteUrl("http://kademurdock.com/api", env), false);
  assert.equal(seat.isSiteUrl("https://api.fish.audio/v1/tts", env), false);
});

test("the site gets the header with the caller's own headers kept; another host never does", async () => {
  const site = await listen(echo);
  const other = await listen(echo);
  const env = { LIBRECHAT_BASE: site.base, KADE_SERVICE_LIMIT_SECRET: SECRET };
  try {
    const a = await (await call(env, `${site.base}/api/auth/login`, { method: "POST", headers: { "User-Agent": "ua-1", "Content-Type": "application/json" }, body: "{}" })).json();
    assert.deepEqual(a, { seat: SECRET, method: "POST", body: "{}", ua: "ua-1" });
    const b = await (await call(env, new URL(`${site.base}/api/agents`))).json();
    assert.equal(b.seat, SECRET);
    const c = await (await call(env, `${other.base}/x`, { headers: { "User-Agent": "ua-2" } })).json();
    assert.equal(c.seat, null);
  } finally {
    site.server.close();
    other.server.close();
  }
});

test("with the secret unset, fetch is untouched", async () => {
  const site = await listen(echo);
  try {
    const r = await (await call({ LIBRECHAT_BASE: site.base }, `${site.base}/api/x`)).json();
    assert.equal(r.seat, null);
  } finally {
    site.server.close();
  }
});

test("redirects: on the site the header stays, off the site it is dropped", async () => {
  const other = await listen(echo);
  const site = await listen((req, res) => {
    if (req.url === "/away") { res.statusCode = 302; res.setHeader("location", `${other.base}/landed`); return res.end(); }
    if (req.url === "/stay") { res.statusCode = 307; res.setHeader("location", "/here"); return res.end(); }
    if (req.url === "/post-away") { res.statusCode = 302; res.setHeader("location", `${other.base}/landed`); return res.end(); }
    return echo(req, res);
  });
  const env = { LIBRECHAT_BASE: site.base, KADE_SERVICE_LIMIT_SECRET: SECRET };
  try {
    const stay = await (await call(env, `${site.base}/stay`, { method: "POST", body: "keep" })).json();
    assert.deepEqual([stay.seat, stay.method, stay.body], [SECRET, "POST", "keep"]);
    const away = await (await call(env, `${site.base}/away`, { headers: { "User-Agent": "ua-3" } })).json();
    assert.deepEqual([away.seat, away.ua], [null, "ua-3"]);
    const postAway = await (await call(env, `${site.base}/post-away`, { method: "POST", body: "x", headers: { "Content-Type": "text/plain" } })).json();
    assert.deepEqual([postAway.seat, postAway.method, postAway.body], [null, "GET", ""]);
    const manual = await call(env, `${site.base}/away`, { redirect: "manual" });
    assert.equal(manual.status, 302);
    await assert.rejects(call(env, `${site.base}/away`, { redirect: "error" }));
  } finally {
    site.server.close();
    other.server.close();
  }
});

test("installFetchSeat wraps the global fetch once, and server.js installs it at the top", () => {
  const saved = globalThis.fetch;
  try {
    const first = seat.installFetchSeat({});
    const wrapped = globalThis.fetch;
    assert.equal(first, true);
    assert.equal(seat.installFetchSeat({}), false);
    assert.equal(globalThis.fetch, wrapped);
    assert.equal(wrapped.name, "kadeSeatFetch");
  } finally {
    globalThis.fetch = saved;
  }
  const src = require("fs").readFileSync(require("path").join(__dirname, "server.js"), "utf8");
  const top = src.split("\n").slice(0, 8).join("\n");
  assert.match(top, /require\("\.\/site-seat"\)\.installFetchSeat\(\);/);
});
