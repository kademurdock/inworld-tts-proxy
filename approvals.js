// ---- Approvals for Forge's shipping actions (Oct 16 2026) ----
//
// Kade's decision, Oct 16 2026: "Approve, then he ships." Forge works on a
// branch and opens a pull request; merging into a live branch, deploying a
// commit and changing a service setting wait for her yes. Before this the
// GitHub and Railway routes ran the moment Forge called them.
//
// The pending list lives in the site's database (fork routes/kadeApprovals.js),
// so a redeploy of this service never loses a request. This file:
//   - requestApproval(): asks the site to record a request and ping her phone;
//   - POST /approvals/execute: runs an APPROVED request. Only the site can call
//     it (KADE_APPROVAL_SECRET, held by the site and this service, never by any
//     agent action), and only after her button or her own words said yes;
//   - GET /approvals/:id: Forge can ask where his request stands;
//   - after a merge into a live branch, watches Railway until that commit's
//     deploy SUCCEEDS or FAILS and tells the site, so she hears it went live.
//
// FORGE_APPROVALS=0 restores the old immediate behaviour (nothing waits).

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const SITE = (process.env.LIBRECHAT_URL || "https://kademurdock.com").replace(/\/$/, "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* Live branches: a commit here is a deploy (every one of these auto-deploys or ships). */
const PROTECTED_DEFAULT = [
  "kademurdock/LibreChat:kade",
  "kademurdock/inworld-tts-proxy:main",
  "kademurdock/kade-ai-bridge:main",
  "kademurdock/reframe-proxy:main",
  "kademurdock/kade-harness-svc:main",
  "kademurdock/kade-ai-native:main",
  "kademurdock/kade-page-truth:main",
];

/* Which Railway service a repo deploys to, for the went-live check. */
const DEPLOY_MAP_DEFAULT = {
  "kademurdock/LibreChat": { serviceId: "b218ff8a-a86e-4ce7-8cb9-00d8cf971f78", environmentId: "3bf75b03-d24f-4bdf-9a82-380d94b03797", name: "the website" },
  "kademurdock/inworld-tts-proxy": { serviceId: "c5492e31-cd83-47a6-a37c-a6a16fe4ea31", environmentId: "c3d3d4c9-7428-4cda-bf70-b0ee45a84673", name: "the voice server" },
  "kademurdock/reframe-proxy": { serviceId: "d528d4ab-d029-44b2-953c-57c36ac0d586", environmentId: "c3d3d4c9-7428-4cda-bf70-b0ee45a84673", name: "the model gateway" },
  "kademurdock/kade-ai-bridge": { serviceId: "6ff8f959-9156-4ea0-8774-e16f81a5b14f", environmentId: "25adaf26-3f9e-4cf1-a84a-0f827064349c", name: "the phone bridge" },
  "kademurdock/kade-harness-svc": { serviceId: "6b680944-421e-4aba-be7b-06220bdfdef9", environmentId: "5a3e1d32-a52f-45ca-ab9d-7f374366b2b1", name: "the coding harness" },
};

function approvalsOn() {
  return process.env.FORGE_APPROVALS !== "0";
}

function protectedList() {
  const raw = (process.env.APPROVAL_PROTECTED || "").trim();
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : PROTECTED_DEFAULT;
}

function isProtected(owner, repo, branch) {
  if (!approvalsOn()) return false;
  const want = `${owner}/${repo}:${branch || ""}`.toLowerCase();
  return protectedList().some((p) => p.toLowerCase() === want);
}

function deployTarget(owner, repo) {
  let map = DEPLOY_MAP_DEFAULT;
  try {
    if (process.env.APPROVAL_DEPLOY_MAP) map = JSON.parse(process.env.APPROVAL_DEPLOY_MAP);
  } catch (_) {}
  return map[`${owner}/${repo}`] || null;
}

async function site(method, path, body) {
  const secret = process.env.BRIDGE_SECRET || "";
  const r = await fetch(`${SITE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": UA, "x-kade-secret": secret },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `site said ${r.status}`);
  return data;
}

/**
 * Record a request and ping her phone. Returns what Forge should say.
 * @param {{kind:string, params:object, summary:string, revert?:string, agentId?:string}} req
 */
async function requestApproval({ kind, params, summary, revert, agentId }) {
  const out = await site("POST", "/api/kade/approvals/create", {
    kind,
    params,
    summary: String(summary || "").slice(0, 900),
    revert: String(revert || "").slice(0, 300),
    agentId: agentId || "agent_FFecOqZ6hHCVpY507-VAD",
  });
  return {
    needsApproval: true,
    approvalId: out.approvalId,
    spoken:
      `Waiting on Kade. I asked her to approve this (request ${out.approvalId}); her phone got a notification. ` +
      "Nothing has changed yet. When she approves, it runs, and the result comes back into this conversation. Do not retry it.",
  };
}

/* ---- executors, registered by github.js and railway.js ---- */
const executors = new Map();
function registerExecutor(kind, fn) {
  executors.set(kind, fn);
}

function secretOk(req) {
  const expected = String(process.env.KADE_APPROVAL_SECRET || "");
  const given = String(req.get("x-kade-approval-secret") || "");
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// POST /approvals/execute {approvalId, kind, params}  (site only)
router.post("/approvals/execute", async (req, res) => {
  if (!secretOk(req)) return res.status(403).json({ error: "Unauthorized" });
  const { approvalId, kind, params } = req.body || {};
  const run = executors.get(String(kind || ""));
  if (!run) return res.status(400).json({ error: `no executor for ${kind}` });
  try {
    const result = await run(params || {}, { approvalId });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 400) });
  }
});

// GET /approvals/:id  (Forge's GitHub or Railway bearer)
router.get("/approvals/:id", async (req, res) => {
  const h = req.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const allowed = [process.env.GITHUB_PROXY_SECRET, process.env.RAILWAY_PROXY_SECRET, process.env.LIBRECHAT_PROXY_SECRET].filter(Boolean);
  if (!tok || !allowed.includes(tok)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const out = await site("GET", `/api/kade/approvals/${encodeURIComponent(req.params.id)}`);
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * After a merge into a live branch: watch Railway for that commit and tell the
 * site whether it went live. Runs in the background; a restart of this service
 * ends the watch, and Forge can still check the deploy himself.
 */
function watchDeploy({ approvalId, owner, repo, commitSha }) {
  const target = deployTarget(owner, repo);
  if (!target || !commitSha) return;
  const { railwayQuery } = require("./railway-client");
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return;
  const started = Date.now();
  const q =
    "query($s:String!,$e:String!){deployments(first:5,input:{serviceId:$s,environmentId:$e}){edges{node{id status createdAt meta}}}}";
  const tick = async () => {
    try {
      const d = await railwayQuery(token, q, { s: target.serviceId, e: target.environmentId });
      const mine = (d.deployments.edges || [])
        .map((e) => e.node)
        .find((n) => n.meta && String(n.meta.commitHash || "").startsWith(String(commitSha).slice(0, 12)));
      const status = mine && mine.status;
      if (status === "SUCCESS" || status === "FAILED" || status === "CRASHED") {
        await site("POST", `/api/kade/approvals/${approvalId}/followup`, {
          deploy: { status, service: target.name, commitSha: String(commitSha).slice(0, 12), deploymentId: mine.id },
        }).catch(() => {});
        return;
      }
      if (Date.now() - started > 25 * 60000) {
        await site("POST", `/api/kade/approvals/${approvalId}/followup`, {
          deploy: { status: "UNKNOWN", service: target.name, commitSha: String(commitSha).slice(0, 12), note: "no finished deploy after 25 minutes" },
        }).catch(() => {});
        return;
      }
    } catch (_) {
      /* keep watching; the next tick may see it */
    }
    setTimeout(tick, 30000).unref?.();
  };
  setTimeout(tick, 45000).unref?.();
}

module.exports = { router, requestApproval, registerExecutor, isProtected, watchDeploy, deployTarget, approvalsOn };
