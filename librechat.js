// ---- Forge's LibreChat platform-management routes ----
// Mounted on the inworld-tts-proxy service. Closes Forge's biggest capability
// gap: he had NO way to reach the LibreChat REST API (kademurdock.com), so he
// couldn't even LIST the marketplace agents (they live in Mongo, reachable only
// via /api/*). This gives him list / get / create / update / PUBLISH agents,
// plus read-only usage — the same things the Cowork assistant does by hand.
//
// SECURITY / ANTI-ABUSE MODEL:
//  - Kade's admin login lives ONLY here as env LIBRECHAT_USER / LIBRECHAT_PASS
//    (never handed to the agent, never in a prompt). The proxy logs in
//    server-side, caches the bearer token, and re-logs in only on a 401.
//  - Every route requires Authorization: Bearer <LIBRECHAT_PROXY_SECRET>.
//  - kademurdock.com BANS fast / non-browser bursts (~15 min). So every outbound
//    call: (a) sends a normal browser User-Agent, (b) is serialized through a
//    queue with a min gap (LIBRECHAT_MIN_GAP_MS, default 4s) between requests,
//    (c) reuses ONE cached token (not one login per call), (d) never loops on
//    re-login — on 429/403 it backs off and surfaces the error.

const express = require("express");
const router = express.Router();

const BASE = process.env.LIBRECHAT_BASE || "https://kademurdock.com";
const USER = process.env.LIBRECHAT_USER;
const PASS = process.env.LIBRECHAT_PASS;
const SECRET = process.env.LIBRECHAT_PROXY_SECRET;
const MIN_GAP_MS = parseInt(process.env.LIBRECHAT_MIN_GAP_MS, 10) || 4000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const AGENT_VIEWER = "agent_viewer";

function auth(req, res, next) {
  const h = req.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!SECRET || tok !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  if (!USER || !PASS) return res.status(500).json({ error: "LIBRECHAT_USER / LIBRECHAT_PASS not set" });
  next();
}

// ---- anti-abuse: serialize outbound calls, min gap between them ----
let _chain = Promise.resolve();
let _lastAt = 0;
function paced(fn) {
  const run = async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - _lastAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      _lastAt = Date.now();
    }
  };
  _chain = _chain.then(run, run);
  return _chain;
}

// ---- token cache + server-side login ----
let _token = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ email: USER, password: PASS }),
  });
  if (r.status === 429 || r.status === 403) throw new Error(`anti-abuse block on login (${r.status})`);
  if (!r.ok) throw new Error(`login failed ${r.status}`);
  const j = await r.json();
  if (!j || !j.token) throw new Error("login returned no token");
  _token = j.token;
  return _token;
}

function buildOpts(method, body, token) {
  const opts = { method, headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  return opts;
}

// Core call into the LibreChat API: paced, browser-UA, cached token, ONE
// re-login on a 401. Throws Error with .status set on failure.
async function lc(method, path, body) {
  return paced(async () => {
    if (!_token) await login();
    let r = await fetch(`${BASE}${path}`, buildOpts(method, body, _token));
    if (r.status === 401) {
      _token = null;
      await login();
      r = await fetch(`${BASE}${path}`, buildOpts(method, body, _token));
    }
    if (r.status === 429 || r.status === 403) {
      const t = await r.text();
      const e = new Error(`anti-abuse/forbidden ${r.status}: ${String(t).slice(0, 120)}`);
      e.status = 502;
      throw e;
    }
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
    if (!r.ok) {
      const msg = typeof data === "string" ? String(data).slice(0, 200) : JSON.stringify(data).slice(0, 200);
      const e = new Error(msg || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  });
}

const fail = (res, e) => res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: e.message });

// GET /librechat/agents -> compact list of ALL agents (the marketplace + private)
router.get("/librechat/agents", auth, async (req, res) => {
  try {
    const d = await lc("GET", "/api/agents?limit=150");
    const agents = (d.data || []).map((a) => ({
      id: a.id,
      _id: a._id,
      name: a.name,
      isPublic: !!a.isPublic,
      category: a.category || null,
      description: a.description || null,
      model: a.model || null,
      tools: a.tools || null,
    }));
    res.json({ count: agents.length, has_more: d.has_more === true, agents });
  } catch (e) {
    fail(res, e);
  }
});

// GET /librechat/agent?id=agent_xxx -> full single agent record
router.get("/librechat/agent", auth, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "query param id (agent_xxx) is required" });
  try {
    res.json(await lc("GET", `/api/agents/${encodeURIComponent(id)}`));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/agent -> create a NEW agent (created PRIVATE; publish separately).
// body = { name, provider, model, description?, instructions?, category?, model_parameters?, tools?, ... }
router.post("/librechat/agent", auth, async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.provider || !body.model) {
    return res.status(400).json({ error: "name, provider, and model are required to create an agent" });
  }
  try {
    res.json(await lc("POST", "/api/agents", body));
  } catch (e) {
    fail(res, e);
  }
});

// PATCH /librechat/agent -> update an existing agent. body = { id, ...onlyFieldsToChange }
router.patch("/librechat/agent", auth, async (req, res) => {
  const body = req.body || {};
  const id = body.id;
  if (!id) return res.status(400).json({ error: "id (agent_xxx) is required in the body" });
  const patch = { ...body };
  delete patch.id;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no fields to update" });
  try {
    res.json(await lc("PATCH", `/api/agents/${encodeURIComponent(id)}`, patch));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/publish -> show/hide an agent on the public marketplace.
// body = { id: "agent_xxx", public: true|false }. Resolves the Mongo _id itself
// (the permissions route needs _id, not the agent_xxx id).
router.post("/librechat/publish", auth, async (req, res) => {
  const body = req.body || {};
  const id = body.id;
  const isPublic = body.public;
  if (!id || typeof isPublic !== "boolean") {
    return res.status(400).json({ error: "id (agent_xxx) and public (true|false) are required" });
  }
  try {
    const agent = await lc("GET", `/api/agents/${encodeURIComponent(id)}`);
    const mongoId = agent && agent._id;
    if (!mongoId) return res.status(404).json({ error: "agent not found / no _id" });
    const result = await lc("PUT", `/api/permissions/agent/${mongoId}`, {
      public: isPublic,
      publicAccessRoleId: AGENT_VIEWER,
    });
    res.json({ id, public: isPublic, result });
  } catch (e) {
    fail(res, e);
  }
});

// GET /librechat/usage?days=30 -> admin usage dashboard data (spend per user/service)
router.get("/librechat/usage", auth, async (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  try {
    res.json(await lc("GET", `/api/kade/usage?days=${days}`));
  } catch (e) {
    fail(res, e);
  }
});

module.exports = router;
