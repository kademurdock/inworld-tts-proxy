"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { accountingPath, attachMonthlyBooks } = require("./monthly-books");

test("forwards explicit UTC bounds without converting them to rolling days", () => {
  const path = accountingPath({ from: "2026-09-01T00:00:00-05:00", to: "2026-10-01T00:00:00-05:00" });
  const url = new URL(path, "https://example.test");
  assert.equal(url.pathname, "/api/kade/monthly-books");
  assert.equal(url.searchParams.get("from"), "2026-09-01T05:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-10-01T05:00:00.000Z");
  assert.equal(url.searchParams.has("days"), false);
});

test("invalid or unbounded windows fail before any upstream accounting read", async () => {
  for (const query of [{}, { from: [], to: "2026-10-01" }, { from: "invalid", to: "2026-10-01" }, { from: "2026-09-02", to: "2026-09-01" }, { from: "2026-01-01", to: "2026-10-01" }, { from: "2026-09-31T00:00:00Z", to: "2026-10-02T00:00:00Z" }, { from: "2026-09-01T00:00:00", to: "2026-10-01T00:00:00Z" }, { from: "2026-09-01T24:00:00Z", to: "2026-10-01T00:00:00Z" }]) {
    let handler;
    let called = false;
    let status;
    attachMonthlyBooks({ get: (_path, _auth, fn) => { handler = fn; } }, { auth() {}, lc: async () => { called = true; } });
    await handler({ query }, { status: (code) => { status = code; return { json() {} }; }, json() { assert.fail("expected validation error"); } });
    assert.equal(status, 400);
    assert.equal(called, false);
  }
});

test("read-only route retains auth and returns accounting without identities", async () => {
  const auth = () => {};
  const payload = { version: 1, nonAdmin: { walletChargedUSD: 22.53 } };
  let handler;
  const calls = [];
  attachMonthlyBooks({ get: (path, guard, fn) => { assert.equal(path, "/librechat/monthly-books"); assert.equal(guard, auth); handler = fn; } }, { auth, lc: async (...args) => { calls.push(args); return payload; } });
  let result;
  await handler({ query: { from: "2026-09-01T05:00:00Z", to: "2026-10-01T05:00:00Z" } }, { json: (body) => { result = body; } });
  assert.deepEqual(result, payload);
  assert.equal(calls[0][0], "GET");
});

test("upstream failures are unavailable, not fabricated zero charges", async () => {
  let handler;
  attachMonthlyBooks({ get: (_path, _auth, fn) => { handler = fn; } }, { auth() {}, lc: async () => { throw new Error("private provider error"); } });
  let status;
  let result;
  await handler({ query: { from: "2026-09-01T05:00:00Z", to: "2026-10-01T05:00:00Z" } }, { status: (code) => { status = code; return { json: (body) => { result = body; } }; } });
  assert.equal(status, 503);
  assert.equal(result.error, "Monthly accounting is unavailable.");
  assert.equal(result.detail, undefined);
});
