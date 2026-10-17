// Oct 16 2026: Forge's shipping actions wait for Kade (approvals.js, github.js, railway.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.GITHUB_PROXY_SECRET = "gh-secret";
process.env.GITHUB_PAT = "pat";
process.env.BRIDGE_SECRET = "bridge-secret";
process.env.KADE_APPROVAL_SECRET = "approval-secret";
process.env.LIBRECHAT_URL = "http://site.test";

const realFetch = global.fetch;
const seen = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  seen.push({ url: u, opts });
  if (u.startsWith("http://site.test/api/kade/approvals/create")) {
    return new Response(JSON.stringify({ approvalId: "a0123456789" }), { status: 200 });
  }
  if (u.startsWith("https://api.github.com/repos/kademurdock/LibreChat/pulls/7/files")) {
    return new Response(JSON.stringify([{ filename: "a.js", status: "modified", additions: 3, deletions: 1 }]), { status: 200 });
  }
  if (u.startsWith("https://api.github.com/repos/kademurdock/LibreChat/pulls/7/merge")) {
    return new Response(JSON.stringify({ merged: true, sha: "feedface12345678" }), { status: 200 });
  }
  if (u.startsWith("https://api.github.com/repos/kademurdock/LibreChat/pulls/7")) {
    return new Response(JSON.stringify({ number: 7, title: "Fix", state: "open", merged: false, base: { ref: "kade" }, head: { ref: "forge/x", sha: "abc" } }), { status: 200 });
  }
  if (u.startsWith("https://api.github.com/repos/kademurdock/LibreChat") && !u.includes("/contents/")) {
    return new Response(JSON.stringify({ default_branch: "kade" }), { status: 200 });
  }
  if (u.includes("/contents/")) {
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  }
  return new Response("{}", { status: 404 });
};

const express = require("express");
const { isProtected } = require("./approvals");
const app = express();
app.use(express.json());
app.use(require("./github"));
app.use(require("./approvals").router);

function call(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: "127.0.0.1", port: server.address().port, method, path, headers: { "content-type": "application/json", ...headers } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("live branches are protected; working branches are not", () => {
  assert.equal(isProtected("kademurdock", "LibreChat", "kade"), true);
  assert.equal(isProtected("kademurdock", "kade-ai-bridge", "main"), true);
  assert.equal(isProtected("kademurdock", "LibreChat", "forge/fix-1"), false);
  assert.equal(isProtected("kademurdock", "kade-ai-project", "main"), false);
});

test("a merge asks Kade and runs nothing; a commit to the live branch asks too; only the site's key can execute", async () => {
  const server = app.listen(0);
  try {
    const gh = { authorization: "Bearer gh-secret" };
    const merge = await call(server, "POST", "/github/merge", { owner: "kademurdock", repo: "LibreChat", number: 7 }, gh);
    assert.equal(merge.status, 200);
    assert.equal(merge.body.needsApproval, true);
    assert.equal(merge.body.approvalId, "a0123456789");
    assert.ok(!seen.some((s) => s.url.endsWith("/pulls/7/merge")), "nothing merged before her yes");
    const created = JSON.parse(seen.find((s) => s.url.includes("/approvals/create")).opts.body);
    assert.equal(created.kind, "github-merge");
    assert.match(created.summary, /Merge pull request 7 into kade/);

    const commit = await call(server, "POST", "/github/commit", { owner: "kademurdock", repo: "LibreChat", path: "x.js", content: "x", message: "m" }, gh);
    assert.equal(commit.body.needsApproval, true);

    const forged = await call(server, "POST", "/approvals/execute", { approvalId: "a0123456789", kind: "github-merge", params: { owner: "kademurdock", repo: "LibreChat", number: 7 } }, { "x-kade-approval-secret": "gh-secret" });
    assert.equal(forged.status, 403, "an agent's own bearer cannot execute");
    const real = await call(server, "POST", "/approvals/execute", { approvalId: "a0123456789", kind: "github-merge", params: { owner: "kademurdock", repo: "LibreChat", number: 7 } }, { "x-kade-approval-secret": "approval-secret" });
    assert.equal(real.status, 200);
    assert.equal(real.body.result.merged, true);
  } finally {
    server.close();
  }
});

test.after(() => {
  global.fetch = realFetch;
});
