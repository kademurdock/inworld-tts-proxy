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

// POST /librechat/avatar-gen -> generate a square character portrait via
// Black Forest Labs (FLUX.2 pro preview, ~$0.03/image) and hand back base64.
// Aug 14 2026, born for the 34-agent avatar backfill; stays for Forge, who can
// now conjure a face AND attach it (see agent-avatar below) — the full
// give-a-fleet-mate-a-face loop with no human hands. Admin bearer only, and
// the Cowork sandbox can't reach bfl.ai directly (egress allowlist), which is
// the other reason this lives here: Railway's egress is open.
router.post("/librechat/avatar-gen", auth, express.json({ limit: "64kb" }), async (req, res) => {
  try {
    const key = process.env.FLUX_API_KEY || "";
    if (!key) return res.status(503).json({ error: "FLUX_API_KEY not configured on this service" });
    const { prompt, width, height, seed } = req.body || {};
    if (!prompt || String(prompt).length < 8) return res.status(400).json({ error: "prompt required" });
    /* Node-18 fetch (undici) reported bare "fetch failed" against bfl.ai from
     * this container on the first live try — the classic AAAA-first/IPv6
     * dead-end shape. The raw https module pinned to family:4 is boring and
     * works, and it names its errors properly. */
    const https = require("https");
    const httpsReq = (url, { method = "GET", headers = {}, body = null } = {}) =>
      new Promise((resolve, reject) => {
        const u = new URL(url);
        const r = https.request(
          { hostname: u.hostname, path: u.pathname + u.search, method, headers, family: 4, timeout: 45000 },
          (resp) => {
            /* BFL's sample delivery redirects to signed storage — follow once. */
            if (resp.statusCode >= 301 && resp.statusCode <= 308 && resp.headers.location) {
              resp.resume();
              return httpsReq(resp.headers.location, { headers: { Accept: headers.Accept || "*/*" } }).then(resolve, reject);
            }
            const chunks = [];
            resp.on("data", (c) => chunks.push(c));
            resp.on("end", () => resolve({ status: resp.statusCode, buf: Buffer.concat(chunks) }));
          },
        );
        r.on("timeout", () => r.destroy(new Error("timeout")));
        r.on("error", (err) => reject(new Error(`${err.code || err.message} @ ${u.hostname}`)));
        if (body) r.write(body);
        r.end();
      });
    const jsonOf = (b) => { try { return JSON.parse(b.toString("utf8")); } catch (_) { return {}; } };
    const bflBase = process.env.FLUX_API_BASE_URL || "https://api.bfl.ai";
    const submit = await httpsReq(`${bflBase}/v1/flux-2-pro-preview`, {
      method: "POST",
      headers: { "x-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        prompt: String(prompt).slice(0, 2400),
        width: Math.min(Number(width) || 1024, 1440),
        height: Math.min(Number(height) || 1024, 1440),
        safety_tolerance: 5, /* current public API cap — 6 got 403 "requires authorization" */
        output_format: "png",
        ...(seed !== undefined ? { seed: Number(seed) } : {}),
      }),
    });
    const task = jsonOf(submit.buf);
    if (submit.status !== 200 || !task.id) {
      return res.status(502).json({ error: `bfl submit ${submit.status}`, detail: task });
    }
    const pollUrl = task.polling_url || `${bflBase}/v1/get_result?id=${task.id}`;
    for (let i = 0; i < 75; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pr = await httpsReq(pollUrl, { headers: { "x-key": key, Accept: "application/json" } });
      const pd = jsonOf(pr.buf);
      if (pd.status === "Ready") {
        const img = await httpsReq(pd.result.sample);
        if (img.status !== 200 || !img.buf.length) {
          return res.status(502).json({ error: `sample fetch ${img.status}` });
        }
        return res.json({ ok: true, bytes: img.buf.length, image_b64: img.buf.toString("base64") });
      }
      if (["Error", "Content Moderated", "Request Moderated", "Task not found"].includes(pd.status)) {
        return res.status(502).json({ error: `bfl: ${pd.status}` });
      }
    }
    res.status(504).json({ error: "bfl polling timed out (150s)" });
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/agent-avatar -> set an agent's avatar from an image URL or
// base64 payload. Built Aug 14 2026 for the marketplace avatar backfill (34
// faceless agents) and kept for good: Forge can now give any fleet-mate a
// face. Downloads the image server-side, then forwards it as multipart to the
// fork's POST /api/agents/:id/avatar with the cached token + built-in pacing.
// Node 18 fetch only — no new dependencies; the multipart body is hand-rolled.
router.post("/librechat/agent-avatar", auth, express.json({ limit: "8mb" }), async (req, res) => {
  try {
    const { id, image_url, image_b64, filename, content_type } = req.body || {};
    if (!id || (!image_url && !image_b64)) {
      return res.status(400).json({ error: "id plus image_url or image_b64 required" });
    }
    let bytes, ctype;
    if (image_url) {
      const ir = await fetch(String(image_url));
      if (!ir.ok) return res.status(502).json({ error: `image fetch failed: ${ir.status}` });
      bytes = Buffer.from(await ir.arrayBuffer());
      ctype = content_type || ir.headers.get("content-type") || "image/png";
    } else {
      bytes = Buffer.from(String(image_b64), "base64");
      ctype = content_type || "image/png";
    }
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: `bad image size: ${bytes.length}` });
    }
    const name = String(filename || "avatar.png").replace(/[^\w.\-]/g, "_");
    const boundary = "----kadeAvatar" + Date.now().toString(36);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${ctype}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, bytes, tail]);
    const data = await paced(async () => {
      if (!_token) await login();
      const doPost = async (tok) =>
        fetch(`${BASE}/api/files/images/agents/${encodeURIComponent(id)}/avatar` /* the v1 avatar router mounts under /files/images/agents — /api/agents/:id/avatar is a 404, learned live */, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "User-Agent": UA,
          },
          body,
        });
      let r = await doPost(_token);
      if (r.status === 401) { _token = null; await login(); r = await doPost(_token); }
      const text = await r.text();
      if (!r.ok) { const e = new Error(`avatar upload ${r.status}: ${text.slice(0, 160)}`); e.status = 502; throw e; }
      try { return JSON.parse(text); } catch (_) { return { raw: text.slice(0, 200) }; }
    });
    res.json({ ok: true, id, bytes: bytes.length, avatar: data && data.avatar ? data.avatar : data });
  } catch (e) {
    fail(res, e);
  }
});

// GET /librechat/agents -> compact list of ALL agents (the marketplace + private)
router.get("/librechat/agents", auth, async (req, res) => {
  try {
    // Aug 3 2026: cursor/limit passthrough — the fleet outgrew the old fixed
    // limit=150 (has_more was true and the tail was unreachable through here).
    const qs = new URLSearchParams({ limit: String(Math.min(parseInt(req.query.limit, 10) || 150, 500)) });
    if (req.query.cursor) qs.set("cursor", String(req.query.cursor));
    const d = await lc("GET", `/api/agents?${qs.toString()}`);
    const agents = (d.data || []).map((a) => ({
      id: a.id,
      _id: a._id,
      name: a.name,
      isPublic: !!a.isPublic,
      category: a.category || null,
      description: a.description || null,
      model: a.model || null,
      provider: a.provider || null,
      /* Aug 14 2026: avatar joined the projection for the marketplace avatar
       * audit (her ask: "do all the market agents have avatars that actually
       * fit them?"). Kept compact — just the filepath/source, enough to know
       * WHETHER one exists and WHERE it lives without shipping whole docs. */
      avatar: a.avatar ? { filepath: a.avatar.filepath || null, source: a.avatar.source || null } : null,
    }));
    res.json({ count: agents.length, has_more: d.has_more === true, after: d.after ?? d.next_cursor ?? null, agents });
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

// ============================================================================
// MEMORIES — /api/memories (LibreChat native memory). Same anti-abuse path as
// the agent routes (goes through lc()). Standing rule: anything that can CHANGE
// about Kade/the project lives here, not in agent instructions — so Forge needs
// read+write here to keep parity with the Cowork assistant.
//
// TWO-TIER MEMORY (added July 2026): every entry is either SHARED (agentId
// omitted/null — visible to every persona, the original behavior) or scoped to
// ONE agent's own bucket (agentId = that agent's string id, e.g.
// "agent_6llV0eMu4fmIaj8f2x1Sb" for Kiana). The one agent-scoped key in use is
// "agent_notes". Pass `agentId` on any of the routes below to reach that
// persona's own bucket instead of the shared one; omit it for shared (unchanged
// default behavior).
//
// FOOTGUN: PATCH /api/memories/preferences does NOT edit a memory named
// "preferences" — that exact path is hardcoded server-side as the memory on/off
// toggle (body {memories:boolean}), evaluated before the /:key route. So we
// refuse PATCH/DELETE on the literal key "preferences" and tell Forge to rename
// or recreate under a different key instead.
// ============================================================================
const MEM_RESERVED = "preferences";

// GET /librechat/memories -> list memory entries (+ usage). Query: ?agentId=
// to show just one agent's own bucket; omit to show everything (shared + every
// agent's), same as before two-tier memory existed.
router.get("/librechat/memories", auth, async (req, res) => {
  try {
    const d = await lc("GET", "/api/memories");
    const filterAgentId = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";
    const all = (d.memories || []).map((m) => ({
      key: m.key,
      value: m.value,
      agentId: m.agentId || null,
      type: m.type || "fact",
      tokenCount: m.tokenCount,
      updated_at: m.updated_at,
    }));
    const memories = filterAgentId ? all.filter((m) => m.agentId === filterAgentId) : all;
    res.json({
      count: memories.length,
      totalTokens: d.totalTokens,
      tokenLimit: d.tokenLimit,
      usagePercentage: d.usagePercentage,
      memories,
    });
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/memory -> create a NEW memory. body = { key, value, agentId? }
// agentId scopes it to one agent's own bucket; omit for shared (default).
router.post("/librechat/memory", auth, async (req, res) => {
  const { key, value, agentId } = req.body || {};
  if (typeof key !== "string" || !key.trim() || typeof value !== "string" || !value.trim()) {
    return res.status(400).json({ error: "key and value (non-empty strings) are required" });
  }
  const body = { key: key.trim(), value };
  if (typeof agentId === "string" && agentId.trim()) body.agentId = agentId.trim();
  try {
    res.json(await lc("POST", "/api/memories", body));
  } catch (e) {
    fail(res, e);
  }
});

// PATCH /librechat/memory -> update an existing memory's value (and optionally
// rename it). body = { key, value, newKey?, agentId? }. agentId must match the
// bucket the existing entry is already in (omit for shared).
router.patch("/librechat/memory", auth, async (req, res) => {
  const { key, value, newKey, agentId } = req.body || {};
  if (typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ error: "key (the existing memory key) is required" });
  }
  if (typeof value !== "string" || !value.trim()) {
    return res.status(400).json({ error: "value (non-empty string) is required" });
  }
  if (key.trim() === MEM_RESERVED) {
    return res.status(409).json({
      error:
        "Cannot PATCH the 'preferences' key: that path is hijacked server-side as the memory on/off toggle. " +
        "To change its content, create a new key (POST /librechat/memory) and delete this one, or use a different key name.",
    });
  }
  const body = { value };
  if (typeof newKey === "string" && newKey.trim()) body.key = newKey.trim();
  if (typeof agentId === "string" && agentId.trim()) body.agentId = agentId.trim();
  try {
    res.json(await lc("PATCH", `/api/memories/${encodeURIComponent(key.trim())}`, body));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/memory/delete -> delete a memory (its ENTIRE history, not just
// the current value). body = { key, agentId? }. agentId must match the bucket
// the entry is in (omit for shared).
router.post("/librechat/memory/delete", auth, async (req, res) => {
  const { key, agentId } = req.body || {};
  if (typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ error: "key is required" });
  }
  let path = `/api/memories/${encodeURIComponent(key.trim())}`;
  if (typeof agentId === "string" && agentId.trim()) {
    path += `?agentId=${encodeURIComponent(agentId.trim())}`;
  }
  try {
    res.json(await lc("DELETE", path));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/memory/consolidate -> memory-hygiene pass: reviews everything
// ACTIVE in one bucket and asks the memory-writer model to merge near-duplicates
// / tighten stale phrasing (never invents new facts). body = { agentId? } --
// omit for the shared bucket, or pass an agent's string id for just that
// persona's own bucket. NOT on an automatic schedule -- on-demand only, until an
// automatic cadence is explicitly turned on (see PROJECT_STATUS.md).
router.post("/librechat/memory/consolidate", auth, async (req, res) => {
  const { agentId } = req.body || {};
  const body = {};
  if (typeof agentId === "string" && agentId.trim()) body.agentId = agentId.trim();
  try {
    res.json(await lc("POST", "/api/memories/consolidate", body));
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================================
// Part 69 (Aug 15 2026) — THE MEMORY SYSTEM lanes. consolidate2 = the
// CONNECTION pass (entity linking + honest inference + contradiction trails,
// auto-apply + ledger, her checkpoint call). -all/-status = the platform-wide
// backfill ("all seats quietly") + its progress read. /ledger = the edit
// trail, newest first. /rag-sync = one-shot card-embedding backfill for the
// relevant-recall lane. All ride the same cached login + pacing as the rest.
// ============================================================================
router.post("/librechat/memory/consolidate2", auth, async (req, res) => {
  const { agentId } = req.body || {};
  const body = {};
  if (typeof agentId === "string" && agentId.trim()) body.agentId = agentId.trim();
  try {
    res.json(await lc("POST", "/api/memories/consolidate-v2", body));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/librechat/memory/consolidate2-all", auth, async (req, res) => {
  try {
    res.json(await lc("POST", "/api/memories/consolidate-v2-all", {}));
  } catch (e) {
    fail(res, e);
  }
});

router.get("/librechat/memory/consolidate2-status", auth, async (req, res) => {
  try {
    res.json(await lc("GET", "/api/memories/consolidate-v2-status"));
  } catch (e) {
    fail(res, e);
  }
});

router.get("/librechat/memory/ledger", auth, async (req, res) => {
  const q = [];
  if (req.query.agentId) q.push("agentId=" + encodeURIComponent(req.query.agentId));
  if (req.query.limit) q.push("limit=" + encodeURIComponent(req.query.limit));
  if (req.query.sinceDays) q.push("sinceDays=" + encodeURIComponent(req.query.sinceDays));
  try {
    res.json(await lc("GET", "/api/memories/ledger" + (q.length ? "?" + q.join("&") : "")));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/librechat/memory/rag-sync", auth, async (req, res) => {
  try {
    res.json(await lc("POST", "/api/memories/rag-sync", {}));
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================================
// TWILIO + kade-ai-bridge control. These hit EXTERNAL services (Twilio REST API
// and the bridge), NOT kademurdock.com — so they bypass lc()/the anti-abuse
// queue and use their own creds. Read/registration only; NO outbound calls, NO
// money movement (Kade's standing rule).
// ============================================================================
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const BRIDGE_BASE = process.env.BRIDGE_BASE || "https://kade-ai-bridge-production.up.railway.app";
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;

function twilioAuthHeader() {
  return "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
}
async function twilio(url) {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    const e = new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set on the proxy");
    e.status = 500;
    throw e;
  }
  const r = await fetch(url, { headers: { Authorization: twilioAuthHeader(), "User-Agent": UA } });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!r.ok) {
    const e = new Error(typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200));
    e.status = r.status;
    throw e;
  }
  return data;
}

// GET /twilio/balance -> current Twilio account balance
router.get("/twilio/balance", auth, async (req, res) => {
  try {
    const d = await twilio(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Balance.json`);
    res.json({ balance: d.balance, currency: d.currency });
  } catch (e) {
    fail(res, e);
  }
});

// GET /twilio/verification?sid=HH... -> toll-free verification status.
// Defaults to the known toll-free verification SID if none passed.
router.get("/twilio/verification", auth, async (req, res) => {
  const sid = req.query.sid || process.env.TOLLFREE_VERIFICATION_SID;
  if (!sid) return res.status(400).json({ error: "query param sid (HH...) is required" });
  try {
    const d = await twilio(`https://messaging.twilio.com/v1/Tollfree/Verifications/${encodeURIComponent(sid)}`);
    res.json({
      sid: d.sid,
      status: d.status,
      business_name: d.business_name,
      phone_number_sid: d.tollfree_phone_number_sid,
      rejection_reason: d.rejection_reason || null,
      date_updated: d.date_updated,
    });
  } catch (e) {
    fail(res, e);
  }
});

// GET /twilio/usage -> Twilio usage records (today)
router.get("/twilio/usage", auth, async (req, res) => {
  try {
    const d = await twilio(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Usage/Records/Today.json?PageSize=50`,
    );
    const records = (d.usage_records || []).map((u) => ({
      category: u.category,
      description: u.description,
      count: u.count,
      usage: u.usage,
      usage_unit: u.usage_unit,
      price: u.price,
      price_unit: u.price_unit,
    }));
    res.json({ count: records.length, records });
  } catch (e) {
    fail(res, e);
  }
});

// GET /bridge/numbers -> list phone numbers registered to the SMS/voice bridge
router.get("/bridge/numbers", auth, async (req, res) => {
  if (!BRIDGE_SECRET) return res.status(500).json({ error: "BRIDGE_SECRET not set on the proxy" });
  try {
    const r = await fetch(`${BRIDGE_BASE}/users?secret=${encodeURIComponent(BRIDGE_SECRET)}`, {
      headers: { "User-Agent": UA },
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text.slice(0, 200) });
    res.json(text ? JSON.parse(text) : {});
  } catch (e) {
    fail(res, e);
  }
});

// POST /bridge/register -> map a phone number to an agent.
// body = { phone, name, agentId? }. (No money moves; just a JSON mapping.)
router.post("/bridge/register", auth, async (req, res) => {
  if (!BRIDGE_SECRET) return res.status(500).json({ error: "BRIDGE_SECRET not set on the proxy" });
  const { phone, name, agentId } = req.body || {};
  if (!phone || !name) return res.status(400).json({ error: "phone and name are required" });
  try {
    const r = await fetch(`${BRIDGE_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ phone, name, agentId, secret: BRIDGE_SECRET }),
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text.slice(0, 200) });
    res.json(text ? JSON.parse(text) : { ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================================
// IMAGE + SEARCH BALANCES. Flux/BFL has a real credits API; Twilio balance is
// above. Tavily has no public balance endpoint, so search usage comes from the
// in-app tracker (/api/kade/usage). One roll-up route for convenience.
// ============================================================================
const BFL_KEY = process.env.BFL_API_KEY || process.env.FLUX_API_KEY;

async function fluxCredits() {
  if (!BFL_KEY) return { error: "BFL_API_KEY / FLUX_API_KEY not set" };
  try {
    const r = await fetch("https://api.bfl.ai/v1/credits", {
      headers: { "x-key": BFL_KEY, "User-Agent": UA },
    });
    const text = await r.text();
    if (!r.ok) return { error: `bfl ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text);
    return { credits: j.credits ?? j.balance ?? j };
  } catch (e) {
    return { error: e.message };
  }
}

/* Aug 6 2026 (idea 42, the spend heartbeat): /balances grew the three bills
 * that actually matter — Moonshot (the fleet's brain), OpenRouter (the
 * fallback lane), and fish.audio (TTS provider two; the key already lives on
 * this service for synthesis). Inworld publishes no balance API — its spend
 * stays visible via synth volume in the logs. Each provider fails soft to an
 * {error} so one dead dashboard never hides the others. The bridge snapshots
 * this daily (balance-history.jsonl on its volume) and /platform-status
 * turns the deltas into the spoken spend line. */
async function moonshotBalance() {
  const key = process.env.MOONSHOT_KEY || process.env.MOONSHOT_API_KEY;
  if (!key) return { error: "MOONSHOT_KEY not set on this service" };
  try {
    const r = await fetch("https://api.moonshot.ai/v1/users/me/balance", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": UA },
    });
    const text = await r.text();
    if (!r.ok) return { error: `moonshot ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text);
    const d = j.data || j;
    const bal = d.available_balance ?? d.availableBalance ?? d.balance;
    return bal != null ? { balance: bal, raw: d } : { error: "no balance field", raw: d };
  } catch (e) {
    return { error: e.message };
  }
}

async function openrouterCredits() {
  const key = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) return { error: "OPENROUTER_KEY not set on this service" };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": UA },
    });
    const text = await r.text();
    if (!r.ok) return { error: `openrouter ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text);
    const d = j.data || j;
    if (d.total_credits != null && d.total_usage != null) {
      return { balance: d.total_credits - d.total_usage, usage: d.total_usage, raw: d };
    }
    return { error: "no credits fields", raw: d };
  } catch (e) {
    return { error: e.message };
  }
}

async function fishCredit() {
  const key = process.env.FISH_API_KEY;
  if (!key) return { error: "FISH_API_KEY not set on this service" };
  try {
    const r = await fetch("https://api.fish.audio/wallet/self/api-credit", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": UA },
    });
    const text = await r.text();
    if (!r.ok) return { error: `fish ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text);
    const credit = j.credit ?? (j.data && j.data.credit);
    return credit != null ? { credit, raw: j } : { error: "no credit field", raw: j };
  } catch (e) {
    return { error: e.message };
  }
}

// GET /balances -> Flux image credits + Twilio balance + Moonshot/OpenRouter/fish in one shot.
router.get("/balances", auth, async (req, res) => {
  const [flux, moonshot, openrouter, fish] = await Promise.all([
    fluxCredits(),
    moonshotBalance(),
    openrouterCredits(),
    fishCredit(),
  ]);
  const out = { flux, moonshot, openrouter, fish, twilio: null, search: null };
  try {
    const t = await twilio(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Balance.json`);
    out.twilio = { balance: t.balance, currency: t.currency };
  } catch (e) {
    out.twilio = { error: e.message };
  }
  try {
    const u = await lc("GET", "/api/kade/usage?days=30");
    out.search = {
      note: "Tavily has no public balance API; this is in-app search usage (last 30d).",
      usage: u.perService ? u.perService.tavily || u.perService.search || null : null,
    };
  } catch (e) {
    out.search = { error: e.message };
  }
  res.json(out);
});

// ---- Codemagic (iOS CI — added July 17 2026) ----
// Trigger + poll iOS TestFlight builds of the kade-ai-app shell, so Forge can
// ship native app changes end-to-end (commit via the GitHub action, build here,
// poll to green). Env: CODEMAGIC_TOKEN (sent as x-auth-token) and optional
// CODEMAGIC_APP_ID (defaults to the kade-ai-app id). Builds auto-publish to
// TestFlight internal on success (workflow ios-testflight).
const CM_APP_ID = process.env.CODEMAGIC_APP_ID || "6a570159a79b1534242af0d9";
async function codemagic(path, opts = {}) {
  const tok = process.env.CODEMAGIC_TOKEN;
  if (!tok) throw new Error("CODEMAGIC_TOKEN env var is not set on the proxy");
  const r = await fetch(`https://api.codemagic.io${path}`, {
    ...opts,
    headers: { "x-auth-token": tok, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Codemagic ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

// POST /codemagic/build {workflowId?, branch?} -> {buildId}
router.post("/codemagic/build", auth, async (req, res) => {
  const { workflowId, branch } = req.body || {};
  try {
    const d = await codemagic("/builds", {
      method: "POST",
      body: JSON.stringify({
        appId: CM_APP_ID,
        workflowId: workflowId || "ios-testflight",
        branch: branch || "main",
      }),
    });
    res.json(d);
  } catch (e) {
    fail(res, e);
  }
});

// GET /codemagic/build?buildId=... -> one build's status; omit buildId for recent builds
router.get("/codemagic/build", auth, async (req, res) => {
  const { buildId } = req.query;
  try {
    if (buildId) {
      const d = await codemagic(`/builds/${encodeURIComponent(buildId)}`);
      const b = d.build || {};
      return res.json({
        id: b._id,
        status: b.status,
        commit: b.commit && b.commit.hash,
        branch: b.branch,
        workflow: b.workflowId,
        startedAt: b.startedAt,
        finishedAt: b.finishedAt,
      });
    }
    const d = await codemagic(`/builds?appId=${CM_APP_ID}&limit=5`);
    res.json({
      builds: (d.builds || []).map((b) => ({
        id: b._id,
        status: b.status,
        commit: b.commit && b.commit.hash,
        branch: b.branch,
        startedAt: b.startedAt,
      })),
    });
  } catch (e) {
    fail(res, e);
  }
});


// ---- /librechat/ask — proxy agent call, returns {text} ----
// LibreChat uses a two-phase model: POST /api/agents/chat returns {streamId}
// immediately; then GET /api/agents/chat/stream/:streamId delivers SSE tokens.

// Call-transcript embedding (July 4 2026 — Kade: "she keeps forgetting what
// game we're in"). ROOT CAUSE of phone/SMS amnesia: both lcAsk and
// lcAskStream posted conversationId:"new" with text = ONLY the last user
// message; the messages[] array rode along in the body but LibreChat's
// /api/agents/chat ignores it entirely (verified: nothing in the fork
// consumes req.body.messages). So every phone turn was the agent's FIRST —
// the bridge's carefully-kept 30-turn history never reached the model.
// Fix: fold prior turns into the text itself as a compact transcript block.
// The last message keeps its suffixes ([PHONE CALL...], game mode, caller
// line) untouched at the end, where reframe-proxy's marker detection and
// the model's attention both live.
const TRANSCRIPT_TURNS = parseInt(process.env.LC_TRANSCRIPT_TURNS || "24", 10);
// Session 22 cache shaping (Kade: "Check caching, because that saves money in
// multiple places"): Moonshot k2.6 auto-caches repeated PREFIXES ($0.16/M hit
// vs $0.95/M miss, and prefill time is the call lane's biggest latency leg --
// receipts in reframe's msg-fingerprint/cached_tokens logs). The old exact
// sliding window (slice(-TRANSCRIPT_TURNS)) dropped the OLDEST line every
// turn once full, so the history block's HEAD changed per turn and nothing
// after the persona ever cached -- and a continuity call seeds 12 turns, so
// the slide started almost immediately (her thunderstorm call: turn 1 first
// byte 2.9s, turns 2-3 5.3s+, zero hits). Fix: quantize the window's START
// so it only advances every TRANSCRIPT_QUANTUM turns. Between advances the
// block is append-only = near-full cache hits; the quantum turn pays one
// re-prefill. Window length now varies TRANSCRIPT_TURNS..TURNS+QUANTUM-1
// lines (the model briefly sees a little MORE history, never less).
// LC_TRANSCRIPT_QUANTUM=0 restores the old exact slide.
const TRANSCRIPT_QUANTUM = parseInt(process.env.LC_TRANSCRIPT_QUANTUM || "8", 10);
function composeTextWithHistory(messages) {
  const last = messages[messages.length - 1] || {};
  const lastText = last.content || "";
  const prior = messages.slice(0, -1).filter((m) => m && m.content);
  if (!prior.length) return lastText;
  let start = Math.max(0, prior.length - TRANSCRIPT_TURNS);
  if (TRANSCRIPT_QUANTUM > 0 && start > 0) {
    start = Math.floor(start / TRANSCRIPT_QUANTUM) * TRANSCRIPT_QUANTUM;
  }
  const lines = prior.slice(start).map((m) =>
    `${m.role === "assistant" ? "YOU" : "THEM"}: ${String(m.content).slice(0, 600)}`
  );
  return (
    "[EARLIER IN THIS CONVERSATION — context only, already handled, do not re-answer:\n" +
    lines.join("\n") +
    "\n— end of earlier context. Reply ONLY to what follows.]\n\n" +
    lastText
  );
}

async function lcAsk(agentId, messages, userEmail, opts = {}) {
  const userText = composeTextWithHistory(messages);
  const body = {
    endpoint: "agents",
    agentId,
    agent_id: agentId,
    text: userText,
    messages,
    // Session 23 — voice-lane identity threading: who is REALLY on the line
    // (bridge session.lcEmail). The fork honors this ADMIN-ONLY and only for
    // the per-user Kade tools (feedback/notify/message/transcribe), so
    // Amber's report files as Amber instead of the service account. Absent
    // field = old behavior.
    kadeOnBehalfOf: userEmail || undefined,
    conversationId: "new",
    parentMessageId: "00000000-0000-0000-0000-000000000000",
    // isTemporary (July 15 2026 -- Kade: 45 orphaned "shadow" conversations found
    // cluttering chat history). ROOT CAUSE: every headless ask -- phone-call turns,
    // voice-stream/Twilio turns, outreach/wellness generation via askAgentRich --
    // hits this endpoint with conversationId:"new", so LibreChat mints a fresh,
    // permanent, VISIBLE conversation every single turn. kadeCallMerge.js already
    // creates the one real "Phone call with X" summary after the call ends from
    // KadeCallTranscript, so these scratch turns were pure duplicate clutter.
    // Fix: mark them temporary. LibreChat's buildRetentionVisibilityFilter
    // (packages/data-schemas/src/utils/retention.ts) excludes isTemporary:true
    // from the conversation list UNCONDITIONALLY (regardless of expiredAt), so
    // this makes them invisible immediately, skips wasted title-gen calls, and
    // auto-expires them later (default 30-day retention) as a bonus.
    isTemporary: true,
  };

  return paced(async () => {
    if (!_token) await login();

    const authHeaders = (tok) => ({
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    });

    // Phase 1: start the generation job
    const doStart = (tok) =>
      fetch(`${BASE}/api/agents/chat`, {
        method: "POST",
        headers: authHeaders(tok),
        body: JSON.stringify(body),
      });

    let r = await doStart(_token);
    if (r.status === 401) { _token = null; await login(); r = await doStart(_token); }
    if (r.status === 429 || r.status === 403) {
      const t = await r.text();
      const e = new Error(`anti-abuse/forbidden ${r.status}: ${String(t).slice(0, 120)}`);
      e.status = 502; throw e;
    }
    if (!r.ok) {
      const t = await r.text();
      const e = new Error(`ask agents start failed ${r.status}: ${String(t).slice(0, 200)}`);
      e.status = r.status; throw e;
    }

    const startData = await r.json();
    const streamId = startData.streamId;
    if (!streamId) throw new Error(`no streamId returned: ${JSON.stringify(startData)}`);
    // Aug 9 2026 (her bloat pass): opts.deleteAfter — the probe erases its
    // own conversation once the reply is read. Stronger than isTemporary
    // alone, which still surfaces in the admin logs drill-down and lingers
    // ~30 days; a deleted probe never haunts anyone's account, hers least.
    const bornConversationId = startData.conversationId || null;

    // Phase 2: subscribe to SSE stream (give job ~300ms to start)
    await new Promise((res) => setTimeout(res, 300));

    const streamR = await fetch(`${BASE}/api/agents/chat/stream/${streamId}`, {
      headers: { Authorization: `Bearer ${_token}`, "User-Agent": UA, Accept: "text/event-stream" },
    });
    if (!streamR.ok) {
      const t = await streamR.text();
      throw new Error(`stream subscribe failed ${streamR.status}: ${String(t).slice(0, 200)}`);
    }

    // Read SSE: accumulate d.text (LibreChat sends full text-so-far in each chunk)
    let reply = "";
    const dec = new TextDecoder();
    let buf = "";
    let rawLines = [];
    for await (const chunk of streamR.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) rawLines.push(line.slice(0, 200));
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          // LibreChat streams text via on_message_delta events
          if (d.event === "on_message_delta" && Array.isArray(d.data?.delta?.content)) {
            for (const part of d.data.delta.content) {
              if (part.type === "text" && part.text) reply += part.text;
            }
          }
          if (d.final) {
            // Same fix as lcAskStream (July 1 2026): tool-using turns deliver
            // their text at/near the final event in shapes the delta loop
            // above can miss entirely -- reconcile against the final
            // responseMessage so an SMS weather ask isn't "empty reply".
            if (!reply) {
              const full = messageText(d.responseMessage) || (typeof d.text === "string" ? d.text : "");
              if (full) reply = full;
            }
            break;
          }
        } catch {}
      }
    }

    console.log("[lcAsk] SSE lines received:", rawLines.length);
    console.log("[lcAsk] first 5 lines:", JSON.stringify(rawLines.slice(0, 5)));
    console.log("[lcAsk] last 3 lines:", JSON.stringify(rawLines.slice(-3)));
    if (!reply) throw new Error("empty reply from agent");
    if (opts.deleteAfter && bornConversationId) {
      // Fire-and-forget through the same paced lane; a failed delete is
      // only cosmetic (the convo is still isTemporary), never a failed ask.
      lc("DELETE", "/api/convos/", { arg: { conversationId: bornConversationId } })
        .then(() => console.log(`[lcAsk] probe convo deleted (${bornConversationId.slice(0, 8)}…)`))
        .catch((e) => console.warn("[lcAsk] probe delete failed (harmless):", e.message));
    }
    return stripCitationAnchors(reply);
  });
}

// POST /librechat/ask  { agentId, messages[] } -> { text }
router.post("/librechat/ask", auth, async (req, res) => {
  const { agentId, messages } = req.body;
  console.log("[lcAsk] hit, agentId=", agentId, "msgs=", Array.isArray(messages) ? messages.length : "not array");
  if (!agentId || !Array.isArray(messages)) {
    return res.status(400).json({ error: "agentId and messages[] required" });
  }
  try {
    const text = await lcAsk(agentId, messages, (req.body || {}).userEmail, {
      deleteAfter: (req.body || {}).deleteAfter === true,
    });
    console.log("[lcAsk] success, reply length=", text.length);
    res.json({ text });
  } catch (err) {
    console.error("[lcAsk] error:", err.message);
    const status = typeof err.status === "number" ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
});

// ---- /librechat/ask-stream — SSE token stream for voice-stream.js ----
// Same two-phase LibreChat call as lcAsk, but forwards each on_message_delta
// token to the caller as an SSE event as it arrives.  voice-stream.js (Twilio
// Media Streams path) consumes this to start synthesizing sentence 1 while the
// rest of the reply is still generating — that's what cuts first-audio latency
// from ~20-30s to ~2-3s.
//
// Uses the same paced() queue as lcAsk so we never hit the anti-abuse gate
// with back-to-back rapid-fire LibreChat calls.  For Kade's low call volume
// (one caller at a time) this is never a bottleneck.

// Citation-anchor scrub (July 1 2026): LibreChat's web_search decorates
// replies with private-use unicode citation anchors (e.g. "\ue202turn0search0")
// that the web UI renders as clickable chips. On the phone/SMS they'd be
// SPOKEN/texted as literal garbage, so strip them before handing text to
// the bridge. Covers the PUA markers (U+E200-U+E2FF) and the bare
// turnNsearchN / turnNnewsN / turnNimageN / turnNrefN / turnNfetchN tokens
// they wrap, plus any doubled-up whitespace left behind.
function stripCitationAnchors(t) {
  if (!t) return t;
  return t
    .replace(/[\ue200-\ue2ff]/g, "")
    .replace(/\bturn\d+(?:search|news|image|ref|fetch|forecast)\d*\b/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

// Text extraction helpers -- ported from the fork's ConversationMode.tsx
// (client/src/components/Chat/ConversationMode.tsx), which is the proven-live
// parser for this exact SSE stream shape.
function partToText(pp) {
  if (pp == null) return "";
  if (typeof pp === "string") return pp;
  if (typeof pp.text === "string") return pp.text;
  if (pp.text && typeof pp.text.value === "string") return pp.text.value;
  return "";
}
function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(partToText).join("");
  return partToText(content);
}
function messageText(msg) {
  if (!msg) return "";
  if (typeof msg.text === "string" && msg.text) return msg.text;
  return contentToText(msg.content);
}

async function lcAskStream(agentId, messages, onToken, userEmail) {
  const userText = composeTextWithHistory(messages);
  const body = {
    endpoint: "agents",
    agentId,
    agent_id: agentId,
    text: userText,
    messages,
    conversationId: "new",
    parentMessageId: "00000000-0000-0000-0000-000000000000",
    isTemporary: true, // same fix as lcAsk above (July 15 2026) -- see comment there
    kadeOnBehalfOf: userEmail || undefined, // session 23 identity threading -- see lcAsk
  };

  return paced(async () => {
    if (!_token) await login();

    const authHeaders = (tok) => ({
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    });

    const doStart = (tok) =>
      fetch(`${BASE}/api/agents/chat`, {
        method: "POST",
        headers: authHeaders(tok),
        body: JSON.stringify(body),
      });

    let r = await doStart(_token);
    if (r.status === 401) { _token = null; await login(); r = await doStart(_token); }
    if (r.status === 429 || r.status === 403) {
      const t = await r.text();
      const e = new Error(`anti-abuse/forbidden ${r.status}: ${String(t).slice(0, 120)}`);
      e.status = 502; throw e;
    }
    if (!r.ok) {
      const t = await r.text();
      const e = new Error(`ask agents start failed ${r.status}: ${String(t).slice(0, 200)}`);
      e.status = r.status; throw e;
    }

    const startData = await r.json();
    const streamId = startData.streamId;
    if (!streamId) throw new Error(`no streamId: ${JSON.stringify(startData)}`);

    await new Promise((res) => setTimeout(res, 300));

    const streamR = await fetch(`${BASE}/api/agents/chat/stream/${streamId}`, {
      headers: { Authorization: `Bearer ${_token}`, "User-Agent": UA, Accept: "text/event-stream" },
    });
    if (!streamR.ok) {
      const t = await streamR.text();
      throw new Error(`stream subscribe failed ${streamR.status}: ${String(t).slice(0, 200)}`);
    }

    const dec = new TextDecoder();
    let buf = "";
    let acc = ""; // everything already forwarded to the caller
    const emit = (raw) => {
      const t = stripCitationAnchors(raw);
      if (raw) acc += raw; // acc tracks RAW so final-event startsWith() reconciliation stays exact
      if (t) onToken(t);
    };
    for await (const chunk of streamR.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.final != null) {
            // FIX (July 1 2026): tool-using turns (web_search etc.) deliver
            // their text in delta shapes the old on_message_delta-only parser
            // missed entirely -- "get me the weather" was pure SILENCE on the
            // phone while plain turns worked. The fork's ConversationMode hit
            // the same problem and reconciles against the final event's full
            // responseMessage; same fix here: speak whatever the deltas
            // didn't already deliver.
            const deltasSpoke = acc.length;
            const full = messageText(d.responseMessage) || (typeof d.text === "string" ? d.text : "");
            if (full && full.length > acc.length && full.startsWith(acc)) emit(full.slice(acc.length));
            else if (full && acc === "") emit(full);
            console.log(`[lcAskStream] final: ${acc.length} chars total, ${deltasSpoke} via deltas${deltasSpoke ? "" : " (final-event fallback carried the reply)"}`);
            return;
          }
          if (d.event === "on_reasoning_delta") continue;
          const deltaContent = d?.data?.delta?.content ?? d?.delta?.content;
          if (deltaContent != null) { emit(contentToText(deltaContent)); continue; }
        } catch {}
      }
    }
  });
}

// POST /librechat/ask-stream  { agentId, messages[] } -> SSE { token } stream
router.post("/librechat/ask-stream", auth, async (req, res) => {
  const { agentId, messages, userEmail } = req.body;
  console.log("[lcAskStream] hit, agentId=", agentId, "msgs=", Array.isArray(messages) ? messages.length : "not array", userEmail ? `onBehalfOf=${userEmail}` : "");
  if (!agentId || !Array.isArray(messages)) {
    return res.status(400).json({ error: "agentId and messages[] required" });
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  // Keepalive: a tool-using turn (web search etc.) can produce long silent
  // gaps while LibreChat runs the tool. The bridge treats 25s of socket
  // silence as a hang, so tick a comment line every 10s -- SSE parsers
  // ignore it, but it keeps the socket audibly alive.
  const keepalive = setInterval(() => { try { res.write(":ka\n\n"); } catch {} }, 10000);
  try {
    await lcAskStream(agentId, messages, (token) => {
      try { res.write(`data: ${JSON.stringify({ token })}\n\n`); } catch {}
    }, userEmail);
    res.write("data: [DONE]\n\n");
  } catch (err) {
    console.error("[lcAskStream] error:", err.message);
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); } catch {}
  }
  clearInterval(keepalive);
  res.end();
});


// July 13 2026 cache-race audit: the login token was LAZY — the first
// /librechat/* call after every proxy deploy paid a full login (plus pacing)
// before doing its real work, which is exactly when the bridge's boot warm-up
// storm arrives. Warm it once, quietly, shortly after boot. Fail-soft: a
// failed warm just means the old lazy path (which still works) pays the cost.
if (process.env.LIBRECHAT_USER && process.env.LIBRECHAT_PASS) {
  setTimeout(() => {
    login()
      .then(() => console.log("[librechat.js] token warmed at boot"))
      .catch((e) => console.warn("[librechat.js] boot token warm failed (lazy path still works):", e.message));
  }, 4000);
}

// ── THE JANITOR (Aug 9 2026 — her ask, near-verbatim: "I like the idea of
// not having to keep track of these things personally. Automation is great
// when it's free/cheap, easy to control, and damn good at what it does.")
//
// A deterministic librarian for the admin account's conversation list:
// finds obvious TEST conversations by title and ARCHIVES them — never
// deletes, so one wrong guess is a two-tap recovery in the web archive
// view, not a loss. Free (no model anywhere), controlled by env, honest
// about every move (returns the full list it touched; the bridge logs it).
//
// MATCH DISCIPLINE — why two nets: a bare /test/ match would have archived
// "Kasper Testing My Patience" (her CAT, a real chat — caught live during
// this build, Aug 9). So: STRONG patterns archive on their own (canary/
// probe/sweep/diagnostic — words with no civilian use here), while the
// word "test" only counts beside a tech word (voice, bridge, TTS, call,
// system…). New patterns land via env JANITOR_EXTRA_PATTERNS (comma-
// separated regexes) — no deploy needed to teach it a new mess.
const JANITOR_STRONG = [/^canary check/i, /\bprobe\b/i, /\bsweep\b/i, /\bdiagnostic\b/i];
const JANITOR_TEST_WORD = /\btest(s|ing|ed)?\b/i;
const JANITOR_TECH_WORD = /\b(system|systems|voice|haptics|tts|beta|debug|debugging|bridge|outbound|overnight|save file|chunk|chunking|flow|phone|call|calls|mode|tool|file|game|conversation|request|redo|image|news|headline|stream|earcon|chime|spotter|frame|api|memory update)\b/i;
const JANITOR_MIN_AGE_DAYS = parseInt(process.env.JANITOR_MIN_AGE_DAYS || "3", 10);
function janitorExtra() {
  return String(process.env.JANITOR_EXTRA_PATTERNS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => { try { return new RegExp(s, "i"); } catch { return null; } })
    .filter(Boolean);
}
function janitorMatch(title) {
  const t = String(title || "");
  if (JANITOR_STRONG.some((re) => re.test(t))) return true;
  if (janitorExtra().some((re) => re.test(t))) return true;
  return JANITOR_TEST_WORD.test(t) && JANITOR_TECH_WORD.test(t);
}

// POST /librechat/janitor { dryRun?: true, maxPages?: 12 }
//   -> { scanned, matched: [{conversationId,title,updatedAt}], archived }
// dryRun lists what WOULD move and touches nothing.
router.post("/librechat/janitor", auth, async (req, res) => {
  const dryRun = (req.body || {}).dryRun === true;
  const maxPages = Math.min(30, parseInt((req.body || {}).maxPages, 10) || 12);
  try {
    const cutoff = Date.now() - JANITOR_MIN_AGE_DAYS * 24 * 3600 * 1000;
    const matched = [];
    let scanned = 0;
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const path = "/api/convos?limit=50" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const d = await lc("GET", path);
      const convos = (d && d.conversations) || [];
      scanned += convos.length;
      for (const c of convos) {
        const updated = Date.parse(c.updatedAt || c.createdAt || "") || 0;
        if (updated > cutoff) continue; // never yank something mid-use
        if (janitorMatch(c.title)) {
          matched.push({ conversationId: c.conversationId, title: c.title, updatedAt: c.updatedAt });
        }
      }
      cursor = d && d.nextCursor;
      if (!cursor) break;
    }
    let archived = 0;
    if (!dryRun) {
      for (const m of matched) {
        try {
          await lc("POST", "/api/convos/archive", { arg: { conversationId: m.conversationId, isArchived: true } });
          archived++;
        } catch (e) {
          console.warn(`[janitor] archive failed for "${String(m.title).slice(0, 40)}":`, e.message);
        }
      }
    }
    console.log(`[janitor] ${dryRun ? "DRY RUN" : "RUN"}: scanned=${scanned} matched=${matched.length} archived=${archived}`);
    res.json({ dryRun, scanned, matched, archived });
  } catch (err) {
    console.error("[janitor] error:", err.message);
    res.status(typeof err.status === "number" ? err.status : 500).json({ error: err.message });
  }
});

module.exports = router;
