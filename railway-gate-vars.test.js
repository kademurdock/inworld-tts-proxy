// Nov 12 2026 (audit SEC-1): the settings that are the approval gate, the secrets that guard this
// service and its approvals, and the owner's id can never be set through /railway/vars, with or
// without an approval. Nothing here reaches Railway or the site: fetch is a stand-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.RAILWAY_PROXY_SECRET = "rw-secret";
process.env.RAILWAY_API_TOKEN = "rw-token";
process.env.KADE_APPROVAL_SECRET = "approval-secret";
process.env.BRIDGE_SECRET = "bridge-secret";
process.env.LIBRECHAT_URL = "http://site.test";
process.env.FORGE_APPROVALS = "1";

const seen = [];
global.fetch = async (url, opts = {}) => {
  seen.push({ url: String(url), opts });
  if (String(url).startsWith("http://site.test/api/kade/approvals/create")) {
    return new Response(JSON.stringify({ approvalId: "a0123456789" }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: { variableUpsert: true } }), { status: 200 });
};

const express = require("express");
const railway = require("./railway");
const app = express();
app.use(express.json());
app.use(railway);

function call(server, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        method: "POST",
        path: "/railway/vars",
        headers: { "content-type": "application/json", authorization: "Bearer rw-secret" },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const ids = { projectId: "p1", environmentId: "e1", serviceId: "s1234567890" };

test("every gate name, in any case or with spaces, is refused with 403 and asks for no approval", async () => {
  const server = app.listen(0);
  try {
    for (const name of [
      "FORGE_APPROVALS", "forge_approvals", " Forge_Approvals ", "APPROVAL_PROTECTED", "APPROVAL_DEPLOY_MAP",
      "KADE_APPROVAL_SECRET", "RAILWAY_PROXY_SECRET", "RAILWAY_API_TOKEN", "GITHUB_PROXY_SECRET",
      "LIBRECHAT_PROXY_SECRET", "BRIDGE_SECRET", "kade_owner_user_id",
    ]) {
      seen.length = 0;
      const r = await call(server, { ...ids, name, value: "0" });
      assert.equal(r.status, 403, name);
      assert.match(r.body.error, /guards the approvals themselves/);
      assert.equal(seen.length, 0, `${name}: no approval request, no Railway call`);
    }
  } finally {
    server.close();
  }
});

test("an ordinary setting still waits for Kade's approval as before", async () => {
  const server = app.listen(0);
  try {
    seen.length = 0;
    const r = await call(server, { ...ids, name: "KADE_STREAMING", value: "1" });
    assert.equal(r.status, 200);
    assert.ok(seen.some((s) => s.url.startsWith("http://site.test/api/kade/approvals/create")));
  } finally {
    server.close();
  }
});

test("the approved-request executor refuses a gate name too", async () => {
  assert.equal(railway.isGateVar("Bridge_Secret"), true);
  assert.equal(railway.isGateVar("KADE_STREAMING"), false);
  assert.equal(railway.isGateVar(undefined), false);
  seen.length = 0;
  await assert.rejects(railway.setVariable({ ...ids, name: "FORGE_APPROVALS", value: "0" }), /cannot be set from here/);
  assert.equal(seen.length, 0);
});
