// ---- Forge's Railway ops routes ----
// Mounted on the inworld-tts-proxy service. Gives the private "Forge" agent
// controlled visibility AND a few deliberate write powers into Kade's
// Railway infrastructure via an Action.
//
// SECURITY MODEL:
//  - The powerful Railway API token lives ONLY here as env RAILWAY_API_TOKEN
//    (never handed to the agent, never in any prompt).
//  - Every route requires Authorization: Bearer <RAILWAY_PROXY_SECRET>, so the
//    public URL can't be abused even though it's reachable.
//  - The /vars GET route returns variable NAMES ONLY, never values, so secrets
//    are never exposed to the agent on read.
//  - Mutations are intentionally narrow:
//      * /railway/redeploy  - restart current image (no commit change)
//      * /railway/deploy    - deploy a SPECIFIC commit. commitSha is REQUIRED
//        (Railway's serviceInstanceDeployV2 silently redeploys the service's
//        INITIAL commit if commitSha is omitted -- a documented footgun hit
//        live in production. This route refuses the call without one.)
//      * /railway/vars (POST) - variableUpsert, set ONE named env var at a time.
//        No bulk writes, no delete route. Real blast radius -- a bad value can
//        break a live service instantly. Used deliberately, one var at a time.
//  - Still no delete-service, no project-level mutations, no token exposure.

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

// ---- WRITE power: restart current image ----
// Redeploy the CURRENT deployment of a service (restart latest BUILT code,
// does NOT pull a new commit). Fine for "the service is stuck/crashed,
// just restart it" -- NOT the right call after a fresh commit. Use
// /railway/deploy for that.
router.post("/railway/redeploy", auth, async (req, res) => {
  const { serviceId, environmentId } = req.body || {};
  if (!serviceId || !environmentId) return res.status(400).json({ error: "serviceId and environmentId are required" });
  try {
    const m = `mutation($e:String!,$s:String!){ serviceInstanceRedeploy(environmentId:$e, serviceId:$s) }`;
    const d = await gql(m, { e: environmentId, s: serviceId });
    res.json({ redeployed: d.serviceInstanceRedeploy === true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- WRITE power: deploy a specific commit ----
// Deploys the EXACT commit you give it. commitSha is REQUIRED on purpose --
// Railway's serviceInstanceDeployV2 redeploys the service's INITIAL commit
// if commitSha is left out, which is the opposite of what you want after
// pushing a fix. Get the right sha from your own commitToGitHub response.
router.post("/railway/deploy", auth, async (req, res) => {
  const { serviceId, environmentId, commitSha } = req.body || {};
  if (!serviceId || !environmentId || !commitSha) {
    return res.status(400).json({
      error: "serviceId, environmentId, and commitSha are all required. " +
        "Omitting commitSha will NOT deploy your latest commit -- Railway falls back to redeploying " +
        "the service's very first commit ever. Pass the exact sha you just committed.",
    });
  }
  try {
    const m = `mutation($e:String!,$s:String!,$c:String!){ serviceInstanceDeployV2(environmentId:$e, serviceId:$s, commitSha:$c) }`;
    const d = await gql(m, { e: environmentId, s: serviceId, c: commitSha });
    res.json({ deployed: d.serviceInstanceDeployV2 === true, commitSha });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- WRITE power: set ONE environment variable ----
// One name/value at a time, deliberately -- no bulk-replace route. Real risk:
// a wrong value can break a live service the moment this resolves. Most
// services need a redeploy/restart to actually pick up a changed variable --
// follow up with /railway/redeploy or /railway/deploy if the var doesn't seem
// to take effect.
router.post("/railway/vars", auth, async (req, res) => {
  const { projectId, environmentId, serviceId, name, value } = req.body || {};
  if (!projectId || !environmentId || !serviceId || !name || value === undefined) {
    return res.status(400).json({ error: "projectId, environmentId, serviceId, name, and value are all required" });
  }
  try {
    const m = `mutation($input: VariableUpsertInput!){ variableUpsert(input:$input) }`;
    const d = await gql(m, { input: { projectId, environmentId, serviceId, name, value: String(value) } });
    res.json({ set: d.variableUpsert === true, name });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
