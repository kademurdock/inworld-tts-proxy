// ---- Forge's read-only Railway ops routes ----
// Mounted on the inworld-tts-proxy service. Gives the private "Forge" agent
// SAFE, READ-ONLY visibility into Kade's Railway infrastructure via an Action.
//
// SECURITY MODEL:
//  - The powerful Railway API token lives ONLY here as env RAILWAY_API_TOKEN
//    (never handed to the agent, never in any prompt).
//  - This module issues READ queries ONLY. There is NO code path that performs
//    a Railway mutation (no deploy, redeploy, variableUpsert, delete, etc.), so
//    even though the token itself is write-capable, nothing reachable here can
//    change infrastructure. Read-only is enforced by construction.
//  - Every route requires Authorization: Bearer <RAILWAY_PROXY_SECRET>, so the
//    public URL can't be abused even though it's reachable.
//  - The /vars route returns variable NAMES ONLY, never values, so secrets
//    are never exposed to the agent.

const express = require("express");
const router = express.Router();

const RW_TOKEN = process.env.RAILWAY_API_TOKEN;
const SECRET = process.env.RAILWAY_PROXY_SECRET;
const GQL = "https://backboard.railway.app/graphql/v2";

function auth(req, res, next) {
  const h = req.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!SECRET || tok !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!RW_TOKEN) return res.status(500).json({ error: "RAILWAY_API_TOKEN not set" });
  next();
}

async function gql(query, variables) {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${RW_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const data = await r.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors).slice(0, 300));
  return data.data;
}

// GET /railway/overview -> all projects, their environments, and services (ids + names)
router.get("/railway/overview", auth, async (req, res) => {
  try {
    const q = `query{ projects{ edges{ node{ id name
        environments{ edges{ node{ id name } } }
        services{ edges{ node{ id name } } } } } } }`;
    const d = await gql(q);
    const projects = (d.projects.edges || []).map((p) => ({
      id: p.node.id,
      name: p.node.name,
      environments: (p.node.environments.edges || []).map((e) => ({ id: e.node.id, name: e.node.name })),
      services: (p.node.services.edges || []).map((s) => ({ id: s.node.id, name: s.node.name })),
    }));
    res.json({ projects });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /railway/status?serviceId=&environmentId= -> latest deployment status/commit
router.get("/railway/status", auth, async (req, res) => {
  const { serviceId, environmentId } = req.query;
  if (!serviceId || !environmentId) return res.status(400).json({ error: "serviceId and environmentId are required" });
  try {
    const q = `query($s:String!,$e:String!){ deployments(first:3, input:{serviceId:$s, environmentId:$e}){ edges{ node{ id status createdAt meta } } } }`;
    const d = await gql(q, { s: serviceId, e: environmentId });
    const deployments = (d.deployments.edges || []).map((x) => ({
      id: x.node.id,
      status: x.node.status,
      createdAt: x.node.createdAt,
      commitHash: x.node.meta && x.node.meta.commitHash,
      commitMessage: x.node.meta && x.node.meta.commitMessage,
    }));
    res.json({ deployments });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /railway/logs?deploymentId=&lines= -> recent deploy logs (default 100, max 400)
router.get("/railway/logs", auth, async (req, res) => {
  const { deploymentId } = req.query;
  let lines = parseInt(req.query.lines, 10) || 100;
  if (lines > 400) lines = 400;
  if (!deploymentId) return res.status(400).json({ error: "deploymentId is required (get it from /railway/status)" });
  try {
    const q = `query($d:String!,$n:Int!){ deploymentLogs(deploymentId:$d, limit:$n){ message } }`;
    const d = await gql(q, { d: deploymentId, n: lines });
    res.json({ logs: (d.deploymentLogs || []).map((l) => l.message) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /railway/vars?projectId=&environmentId=&serviceId= -> variable NAMES only (never values)
router.get("/railway/vars", auth, async (req, res) => {
  const { projectId, environmentId, serviceId } = req.query;
  if (!projectId || !environmentId || !serviceId) return res.status(400).json({ error: "projectId, environmentId, serviceId are required" });
  try {
    const q = `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`;
    const d = await gql(q, { p: projectId, e: environmentId, s: serviceId });
    res.json({ variableNames: Object.keys(d.variables || {}) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
