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
    res.json(await lc("POST", "/memories/consolidate", body));
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

// GET /balances -> Flux image credits + Twilio balance in one shot.
router.get("/balances", auth, async (req, res) => {
  const out = { flux: await fluxCredits(), twilio: null, search: null };
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


// ---- /librechat/ask — proxy agent call, returns {text} ----
// LibreChat uses a two-phase model: POST /api/agents/chat returns {streamId}
// immediately; then GET /api/agents/chat/stream/:streamId delivers SSE tokens.
async function lcAsk(agentId, messages) {
  const userText = (messages[messages.length - 1] || {}).content || "";
  const body = {
    endpoint: "agents",
    agentId,
    agent_id: agentId,
    text: userText,
    messages,
    conversationId: "new",
    parentMessageId: "00000000-0000-0000-0000-000000000000",
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
          if (d.final) break;
        } catch {}
      }
    }

    console.log("[lcAsk] SSE lines received:", rawLines.length);
    console.log("[lcAsk] first 5 lines:", JSON.stringify(rawLines.slice(0, 5)));
    console.log("[lcAsk] last 3 lines:", JSON.stringify(rawLines.slice(-3)));
    if (!reply) throw new Error("empty reply from agent");
    return reply;
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
    const text = await lcAsk(agentId, messages);
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

async function lcAskStream(agentId, messages, onToken) {
  const userText = (messages[messages.length - 1] || {}).content || "";
  const body = {
    endpoint: "agents",
    agentId,
    agent_id: agentId,
    text: userText,
    messages,
    conversationId: "new",
    parentMessageId: "00000000-0000-0000-0000-000000000000",
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
    for await (const chunk of streamR.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.event === "on_message_delta" && Array.isArray(d.data?.delta?.content)) {
            for (const part of d.data.delta.content) {
              if (part.type === "text" && part.text) onToken(part.text);
            }
          }
          if (d.final) return;
        } catch {}
      }
    }
  });
}

// POST /librechat/ask-stream  { agentId, messages[] } -> SSE { token } stream
router.post("/librechat/ask-stream", auth, async (req, res) => {
  const { agentId, messages } = req.body;
  console.log("[lcAskStream] hit, agentId=", agentId, "msgs=", Array.isArray(messages) ? messages.length : "not array");
  if (!agentId || !Array.isArray(messages)) {
    return res.status(400).json({ error: "agentId and messages[] required" });
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  try {
    await lcAskStream(agentId, messages, (token) => {
      try { res.write(`data: ${JSON.stringify({ token })}\n\n`); } catch {}
    });
    res.write("data: [DONE]\n\n");
  } catch (err) {
    console.error("[lcAskStream] error:", err.message);
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); } catch {}
  }
  res.end();
});


module.exports = router;
