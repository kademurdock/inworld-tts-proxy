"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { railwayQuery } = require("./railway-client");

test("returns verified GraphQL data and keeps credentials in the header", async () => {
  const result = await railwayQuery("private-token", "query{projects{id}}", { id: "project" }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://backboard.railway.com/graphql/v2");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.match(options.headers["User-Agent"], /Chrome\//);
      assert.deepEqual(JSON.parse(options.body).variables, { id: "project" });
      return new Response(JSON.stringify({ data: { projects: [] } }));
    },
  });
  assert.deepEqual(result, { projects: [] });
});

test("plain-text HTTP failure reports status without leaking body or retrying a mutation", async () => {
  let calls = 0;
  await assert.rejects(railwayQuery("token", "mutation{restart}", {}, {
    fetchImpl: async () => { calls++; return new Response("private submitted value", { status: 500 }); },
  }), (error) => /HTTP 500/.test(error.message) && !/private submitted/.test(error.message));
  assert.equal(calls, 1);
});

test("timeout aborts a hung request and warns that the operation outcome is unknown", async () => {
  let calls = 0;
  await assert.rejects(railwayQuery("token", "mutation{restart}", {}, {
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }); },
  }), /timed out.*outcome is unknown/);
  assert.equal(calls, 1);
});

test("timeout also covers stalled response bodies", async () => {
  await assert.rejects(railwayQuery("token", "query{x}", {}, {
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) }),
  }), /timed out/);
});

test("malformed, missing, and GraphQL error results never count as success", async () => {
  for (const body of ["bad JSON", "null", "{}", '{"data":null}', '{"errors":[{"message":"private value"}],"data":{"partial":true}}']) {
    await assert.rejects(railwayQuery("token", "query{x}", {}, {
      fetchImpl: async () => new Response(body),
    }), (error) => !error.message.includes("private value"));
  }
});
