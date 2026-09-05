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
const { createHash } = require("crypto");
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

// ---- Part 116 (Sep 1 2026): PROBES RIDE THE TEST SEAT, NEVER HERS ----
// HOW_TO_VERIFY law 25: `userEmail` on /librechat/ask is NOT a seat -- it
// becomes kadeOnBehalfOf, admin-only, four tools, and re-scopes nothing. Every
// probe through here ran as kademurdock@gmail.com and the memory keeper filed
// a card into HER memory that Kiana then asked her about on a call. So: an
// explicit `seat:"vischeck"` logs in as the regular-user test seat
// (LIBRECHAT_SEAT_VISCHECK_USER / _PASS on this service) with its own token
// cache. Default stays the admin seat so Forge's existing calls do not move.
// A seat that is asked for and not configured is a hard 500, never a silent
// fall-through to her account -- that fall-through is exactly the bug.
const SEATS = {
  admin: { user: () => USER, pass: () => PASS, token: null },
  vischeck: {
    user: () => process.env.LIBRECHAT_SEAT_VISCHECK_USER,
    pass: () => process.env.LIBRECHAT_SEAT_VISCHECK_PASS,
    token: null,
  },
};
function seatByName(name) {
  const key = String(name || "admin").toLowerCase();
  const seat = SEATS[key];
  if (!seat) {
    const e = new Error(`unknown seat "${name}" (admin|vischeck)`);
    e.status = 400; throw e;
  }
  if (!seat.user() || !seat.pass()) {
    const e = new Error(`seat "${key}" is not configured on the proxy (LIBRECHAT_SEAT_${key.toUpperCase()}_USER/_PASS)`);
    e.status = 500; throw e;
  }
  return seat;
}
async function seatLogin(seat) {
  if (seat === SEATS.admin) return login();
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ email: seat.user(), password: seat.pass() }),
  });
  if (r.status === 429 || r.status === 403) throw new Error(`anti-abuse block on seat login (${r.status})`);
  if (!r.ok) throw new Error(`seat login failed ${r.status}`);
  const j = await r.json();
  if (!j || !j.token) throw new Error("seat login returned no token");
  seat.token = j.token;
  return seat.token;
}
function seatToken(seat) {
  return seat === SEATS.admin ? _token : seat.token;
}
function seatClear(seat) {
  if (seat === SEATS.admin) _token = null; else seat.token = null;
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
/* ⭐⭐ AGENT MODEL RESOLUTION (Aug 19 2026) — WHY THIS EXISTS, so it is never
 * quietly removed again.
 *
 * THE BUG IT FIXES: this list endpoint has projected `model` and `provider`
 * since Aug 3, and they have been `null` for EVERY agent that whole time --
 * LibreChat's `/api/agents` list projection simply does not include them. The
 * single-agent route returns them fine. So anything reading the fleet in bulk
 * (Forge, chiefly) got 150+ nulls and no hint that the nulls were an artifact
 * rather than the truth.
 *
 * WHAT THAT COST: asked "what model is Kiana on", Forge answered DEEPSEEK. Her
 * record plainly says `z-ai/glm-5.2` on OpenRouter. He had no authoritative
 * source -- nulls here, nothing in PLATFORM_SNAPSHOT.md -- and the two things
 * he COULD see both point at deepseek: a shelf of research docs weighing it as
 * a candidate, and proxy logs where `deepseek/deepseek-v4-flash` is the single
 * most common model by volume (279 of 374 turns on Aug 18) because it is the
 * TITLER, firing once per conversation. Given nothing true, he assembled
 * something plausible. A silent null is worse than an error.
 *
 * WHY IT IS BOUNDED: every kademurdock.com call goes through `paced()` with a
 * 4s global gap (anti-abuse, and rightly so). Resolving all 150+ agents would
 * pound her site for ten straight minutes. So: opt-in, hard-capped, and cached
 * for 6h -- the daily snapshot pays ~8 lookups once and everything else is free.
 *
 * AND IT NEVER LIES BY OMISSION: the response always carries `modelsNote`
 * saying why model/provider are null when they are, plus `modelsResolved` and
 * `modelsTruncated`, so partial data can never be mistaken for the whole fleet.
 * That is the entire lesson of the bug above. */
const AGENT_MODEL_TTL_MS = parseInt(process.env.LIBRECHAT_AGENT_MODEL_TTL_MS, 10) || 6 * 60 * 60 * 1000;
const AGENT_MODEL_CAP = Math.min(parseInt(process.env.LIBRECHAT_AGENT_MODEL_CAP, 10) || 12, 40);
const _modelCache = new Map(); // id -> { model, provider, at }

async function resolveAgentModels(agents, want, only) {
  const cap = Math.min(want, AGENT_MODEL_CAP);
  const now = Date.now();
  let resolved = 0;
  /* `only` (from ?modelsFor=Kiana,Forge,...) spends the cap on the agents the
   * caller actually asked about instead of whoever happens to sort first.
   * Without it a cap of 12 against 223 agents resolves an arbitrary dozen --
   * which is how the first cut of this shipped a fleet table with half the
   * named characters reading "(not resolved)". Same class of half-truth this
   * whole route exists to kill. */
  const ordered = only && only.length
    ? [
        ...agents.filter((a) => only.includes(String(a.name || "").trim().toLowerCase())),
        ...agents.filter((a) => !only.includes(String(a.name || "").trim().toLowerCase())),
      ]
    : agents;
  for (const a of ordered) {
    const hit = _modelCache.get(a.id);
    if (hit && now - hit.at < AGENT_MODEL_TTL_MS) {
      a.model = hit.model;
      a.provider = hit.provider;
      resolved += 1;
      continue;
    }
    if (resolved >= cap) continue;
    try {
      const full = await lc("GET", `/api/agents/${encodeURIComponent(a.id)}`);
      const rec = (full && (full.agent || full)) || {};
      a.model = rec.model ?? null;
      a.provider = rec.provider ?? null;
      _modelCache.set(a.id, { model: a.model, provider: a.provider, at: now });
      resolved += 1;
    } catch (e) {
      // One bad agent must never sink the list.
      a.model = null;
      a.provider = null;
    }
  }
  return resolved;
}

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
    // See resolveAgentModels above: model/provider are NULL from LibreChat's
    // list projection unless explicitly resolved. Say so, always.
    const withModels = String(req.query.withModels || "") === "1";
    const only = String(req.query.modelsFor || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    let modelsResolved = 0;
    if (withModels) modelsResolved = await resolveAgentModels(agents, agents.length, only);
    res.json({
      count: agents.length,
      has_more: d.has_more === true,
      after: d.after ?? d.next_cursor ?? null,
      modelsResolved,
      modelsTruncated: withModels && modelsResolved < agents.length,
      modelsNote: withModels
        ? `model/provider resolved for ${modelsResolved} of ${agents.length} agents (cap ${AGENT_MODEL_CAP}, cached ${Math.round(AGENT_MODEL_TTL_MS / 3600000)}h). Any agent still showing null was NOT resolved -- it does not mean the agent has no model.`
        : "model/provider are NULL here by default: LibreChat's list projection omits them. Pass withModels=1 to resolve them (bounded + cached), or GET /librechat/agent?id=... for one full record. A null in this response is NOT evidence an agent has no model.",
      agents,
    });
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
//
// Part 85.5 (Aug 22 2026) — THE NIGHT FORGE BROKE KIANA. His tool call tried
// to carry her full ~48K-char persona as `instructions`; the argument stream
// truncated mid-flight and the PATCH landed as a stump. Kade hand-restored
// her. Two cures, both server-side so no tool call ever carries a persona:
//
// (a) THE SHRINK GUARD — an `instructions` write that would shrink a big
//     persona (>20K chars live) by more than half is refused without
//     force:true. A truncated tool call can never silently land again.
// (b) SURGICAL EDITS — the body may carry `find`/`replace` (exact string,
//     expected once; pass expect_count for more) and/or `append` instead of
//     `instructions`. The proxy fetches the live text, does the splice HERE,
//     verifies the match count, and writes the result. A wrong or ambiguous
//     `find` is a 409 and NOTHING is written. `dry:true` previews counts.
//     POST /librechat/agent-edit is the same handler under a clean name.
async function agentPatchHandler(req, res) {
  const body = req.body || {};
  const id = body.id;
  if (!id) return res.status(400).json({ error: "id (agent_xxx) is required in the body" });
  const patch = { ...body };
  for (const k of ["id", "force", "find", "replace", "append", "expect_count", "dry"]) delete patch[k];
  const hasSplice = (typeof body.find === "string" && body.find.length > 0)
    || (typeof body.append === "string" && body.append.length > 0);
  try {
    let live = null;
    if (hasSplice || typeof patch.instructions === "string") {
      live = await lc("GET", `/api/agents/${encodeURIComponent(id)}`);
    }
    if (hasSplice) {
      if (typeof patch.instructions === "string") {
        return res.status(400).json({ error: "send either instructions OR find/replace/append, not both" });
      }
      const cur = String((live && live.instructions) || "");
      let next = cur;
      let occurrences = 0;
      if (typeof body.find === "string" && body.find.length > 0) {
        occurrences = cur.split(body.find).length - 1;
        const expected = Number.isInteger(body.expect_count) ? body.expect_count : 1;
        /* STALE-READ DEFENSE (Aug 28 2026) — a single GET can be hours and
         * versions stale (Part 92.23: one read lied by 18 hours; Forge lost
         * an evening to three spurious 409s on Aug 25). Before refusing,
         * re-read up to twice (paced) and keep the highest version seen.
         * Only a mismatch that SURVIVES three reads is called real. */
        const versionsSeen = [live && live.version];
        for (let extra = 0; extra < 2 && occurrences !== expected; extra++) {
          const again = await lc("GET", `/api/agents/${encodeURIComponent(id)}`);
          versionsSeen.push(again && again.version);
          if ((again && again.version || 0) >= (live && live.version || 0)) live = again;
          cur = String((live && live.instructions) || "");
          occurrences = cur.split(body.find).length - 1;
        }
        if (occurrences !== expected) {
          return res.status(409).json({
            error: `find matched ${occurrences} time(s), expected ${expected} — nothing written`,
            hint: "make find longer and exact (copy it from getAgent), or pass expect_count",
            versions_read: versionsSeen,
          });
        }
        next = cur.split(body.find).join(typeof body.replace === "string" ? body.replace : "");
      }
      if (typeof body.append === "string" && body.append.length > 0) {
        next = next.replace(/\s*$/, "") + "\n\n" + body.append;
      }
      if (body.dry === true) {
        return res.json({ dry: true, occurrences, before_chars: cur.length, after_chars: next.length });
      }
      patch.instructions = next;
    } else if (typeof patch.instructions === "string" && live) {
      const cur = String(live.instructions || "");
      if (cur.length > 20000 && patch.instructions.length < cur.length * 0.5 && body.force !== true) {
        return res.status(409).json({
          error: `REFUSED: this would shrink a ${cur.length}-char persona to ${patch.instructions.length} chars. Full-text personas do not survive tool-call transport (this exact move broke Kiana, Aug 22 2026). Use find/replace/append on this route — the splice happens server-side — or pass force:true only if the shrink is truly intended.`,
        });
      }
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no fields to update" });
    const updated = await lc("PATCH", `/api/agents/${encodeURIComponent(id)}`, patch);
    /* POST-WRITE VERIFICATION (Aug 28 2026) — "one read is not a verification."
     * For instruction writes, read back until the text we intended comes back
     * byte-identical (sha256), up to 3 paced reads. The write result is still
     * the response body either way; _kade_verify says what a re-read saw, so a
     * landed write can never again be reported as a failure — and an unlanded
     * one can never again be reported as done. */
    if (hasSplice && typeof patch.instructions === "string") {
      const wantSha = createHash("sha256").update(patch.instructions).digest("hex");
      const v = { verified: false, reads: 0, want_sha12: wantSha.slice(0, 12) };
      for (let i = 0; i < 3 && !v.verified; i++) {
        try {
          const back = await lc("GET", `/api/agents/${encodeURIComponent(id)}`);
          v.reads++;
          v.version_seen = back && back.version;
          const gotSha = createHash("sha256").update(String((back && back.instructions) || "")).digest("hex");
          if (gotSha === wantSha) v.verified = true;
        } catch (_) { break; }
      }
      if (updated && typeof updated === "object") updated._kade_verify = v;
    }
    res.json(updated);
  } catch (e) {
    fail(res, e);
  }
}
router.patch("/librechat/agent", auth, agentPatchHandler);
router.post("/librechat/agent-edit", auth, agentPatchHandler);

// Part 85.5 (Aug 22 2026) — two READ lanes so nobody needs a raw site login:
// GET /librechat/feedback?status=open|all -> the family bug/feedback pile
//   (admin surface; same data as /feedback-dashboard).
// GET /librechat/convos?limit=N -> Kade's own conversation list (the proxy's
//   session IS her seat, so this can only ever see her own conversations —
//   the privacy wall is LibreChat's own scoping, not a promise).
// GET /librechat/messages?convoId=... -> messages of one of her conversations.
router.get("/librechat/feedback", auth, async (req, res) => {
  try {
    const status = req.query.status === "all" ? "all" : "open";
    res.json(await lc("GET", `/api/kade/feedback?status=${encodeURIComponent(status)}`));
  } catch (e) { fail(res, e); }
});
/* Part 100 (Aug 30 2026) — her ask, verbatim: "make it mark resolved when it
 * is resolved so I don't have to do that shit." The fork already had the
 * status route (with the resolved-relay nudge back to the reporter); what was
 * missing was a door a session or Forge could reach without a raw site login.
 * The RULE that makes this honest: a caller flips a row to resolved ONLY with
 * a receipt — the note must name the commit/build that shipped the fix. It
 * must never close on a guess. Body: { id, status: open|acknowledged|resolved|
 * wontfix, note? } — note is appended to the report detail so the receipt
 * travels with the row. */
router.post("/librechat/feedback-status", auth, async (req, res) => {
  try {
    const { id, status, note } = req.body || {};
    if (!id || !/^[a-f0-9]{24}$/i.test(String(id))) return res.status(400).json({ error: "id (24-hex) required" });
    const ok = ["open", "acknowledged", "resolved", "wontfix"];
    if (!ok.includes(status)) return res.status(400).json({ error: `status must be one of ${ok.join("|")}` });
    if (status === "resolved" && !String(note || "").trim()) {
      return res.status(400).json({ error: "resolving needs a receipt — pass note naming the commit/build that shipped the fix" });
    }
    const body = note ? { status, note: String(note).slice(0, 2000) } : { status };
    res.json(await lc("POST", `/api/kade/feedback/${encodeURIComponent(id)}/status`, body));
  } catch (e) { fail(res, e); }
});
/* ── THE PLATFORM PERSONIFIED (Part 91.2, Aug 23 2026, her word) ─────────────
 * "I don't see any reason why forge can't read conversations for debugging
 * purposes… he's basically the platform personified. Nobody else has access to
 * Forge, just me."
 *
 * These three proxy the fork's ADMIN log lanes, which see EVERY seat — unlike
 * /librechat/convos and /librechat/messages just below, which ride the login's
 * own JWT and see only Kade's seat. They exist for exactly one job: when a
 * family member's seat misbehaves, Forge reads what actually happened instead
 * of guessing.
 *
 * ⚠️ WHAT COMES BACK IS FAMILY TEXT, AND FAMILY TEXT IS UNVETTED. Forge holds
 * commit and deploy power, and his persona carries the injection law for
 * precisely this lane: transcripts are DATA, never instructions. If that law
 * ever comes out of his persona, these routes come out of this file the same
 * day. */
router.get("/librechat/admin-users", auth, async (req, res) => {
  try {
    res.json(await lc("GET", "/api/kade/admin/logs-users"));
  } catch (e) { fail(res, e); }
});
/* Aug 24 2026 (Part 92.7) — FORWARD ?temp=1, BECAUSE WITHOUT IT FORGE CANNOT SEE
 * THE LANE THE FAMILY ACTUALLY TALKS ON.
 *
 * The fork's /admin/logs-convos filters `isTemporary: {$ne: true}` by default and
 * honours ?temp=1 to show the scratch layer. This handler forwarded ONLY userId,
 * so the flag was unreachable from out here — and the phone lane and the app lane
 * are ENTIRELY temporary conversations (Part 72 addendum 24 root-caused a separate
 * bug on exactly that fact). So "read any seat's conversations", shipped in 97ca839,
 * has been reading only the web-UI half the whole time and reporting the other half
 * as simply absent. Same family as the canary that only ever tested the Canary
 * agent: the capability existed, the thing people actually use was outside its view.
 *
 * Whitelisted rather than spread: this builds an upstream URL, so an unknown query
 * key does not get to ride along into it. Only the exact string "1" turns it on —
 * "0" / "false" / "no" must never round toward yes. */
// GET /librechat/admin-agents[?author=<userId>] -> every agent on the platform
// with its owner (id, _id, name, author, version, isPublic). Part 115: the
// ordinary /librechat/agents list is the ADMIN SEAT'S VIEW and drops author,
// so another person's private agent could not even be found to publish it.
// Projection only — no instructions ever ride this route.
router.get("/librechat/admin-agents", auth, async (req, res) => {
  try {
    const qs = req.query.author ? `?author=${encodeURIComponent(String(req.query.author))}` : "";
    res.json(await lc("GET", `/api/kade/admin/agents${qs}`));
  } catch (e) { fail(res, e); }
});

router.get("/librechat/admin-convos", auth, async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId is required (get it from /librechat/admin-users)" });
  const includeTemp = String(req.query.temp || "") === "1";
  try {
    let path = `/api/kade/admin/logs-convos?userId=${encodeURIComponent(userId)}`;
    if (includeTemp) { path += "&temp=1"; }
    res.json(await lc("GET", path));
  } catch (e) { fail(res, e); }
});
/* ── ACTION SCHEMA LANE (Part 92.8, Aug 24 2026) ─────────────────────────────
 * Why this exists: the proxy learned to forward ?temp=1 to admin-convos, and it
 * changed nothing for Forge — because an action's OpenAPI spec lives on the
 * AGENT RECORD, not in this repo. A parameter the schema does not declare is a
 * parameter the model cannot send, however well the route behind it works. Two
 * layers, and fixing one looks exactly like fixing both.
 *
 * READ is safe and general. WRITE carries both documented scars, so the notes
 * live here where the caller will read them:
 *
 *   ⚠️ THE STRIP SCAR (five occurrences: 63→56, 64→56, …). The POST REPLACES
 *   that action's function list, and the agent's `tools` array loses the entries
 *   for it. The repair is routine and known: snapshot `tools` BEFORE the POST,
 *   then PATCH the agent with the before-list (plus genuinely-new ops). Never
 *   assume the POST left tools alone — re-read and diff, every time.
 *
 *   ⚠️ THE DOMAIN-SUFFIX SCAR (earned twice). The POST APPENDS the encoded
 *   domain to whatever function name you send. Send BARE operationIds. Send
 *   `listUserConversations`, never `listUserConversations_action_aW53b3JsZC`,
 *   or you get doubled tools.
 *
 * ⚠️ AND THE ONE THING THIS LANE IS DELIBERATELY NOT: it is NOT wired to Forge
 * as a tool op. He holds commit-and-deploy power and reads unvetted family text;
 * an agent that can rewrite its own action schemas can grant itself routes. That
 * is Kade's call to make, not a convenience to hand out. Bearer-only, for a
 * human-driven session. */
router.get("/librechat/actions", auth, async (req, res) => {
  try {
    const all = await lc("GET", "/api/agents/actions");
    const list = Array.isArray(all) ? all : (all && all.data) || [];
    const agentId = req.query.agentId;
    const actionId = req.query.actionId;
    let out = list;
    if (agentId) out = out.filter((a) => a && a.agent_id === agentId);
    if (actionId) out = out.filter((a) => a && String(a.action_id || "").includes(actionId));
    res.json({ count: out.length, actions: out });
  } catch (e) { fail(res, e); }
});

/* POST /librechat/actions -> write an action's spec back.
 * body = { agentId, action_id, functions:[…bare names…], metadata:{ domain, raw_spec, … } }
 * Returns the agent as the server left it AND a tools diff against what the
 * caller says it saw before, so the strip is visible in the response instead of
 * being discovered later. */
router.post("/librechat/actions", auth, async (req, res) => {
  const b = req.body || {};
  if (!b.agentId || !Array.isArray(b.functions) || !b.functions.length || !b.metadata) {
    return res.status(400).json({ error: "agentId, functions[] and metadata are required" });
  }
  const doubled = b.functions.filter(
    (f) => f && f.function && /_action_/.test(String(f.function.name || "")),
  );
  if (doubled.length) {
    return res.status(400).json({
      error: "send BARE operationIds — the server appends the domain suffix itself",
      offending: doubled.map((f) => f.function.name),
    });
  }
  try {
    const before = Array.isArray(b.toolsBefore) ? b.toolsBefore : null;
    const result = await lc("POST", `/api/agents/actions/${encodeURIComponent(b.agentId)}`, {
      functions: b.functions,
      action_id: b.action_id,
      metadata: b.metadata,
    });
    const after = await lc("GET", `/api/agents/${encodeURIComponent(b.agentId)}`);
    const toolsAfter = (after && after.tools) || [];
    res.json({
      ok: true,
      toolsAfter: toolsAfter.length,
      toolsBefore: before ? before.length : null,
      lost: before ? before.filter((t) => !toolsAfter.includes(t)) : null,
      doubled: toolsAfter.filter((t) => (t.match(/_action_/g) || []).length > 1),
      result,
    });
  } catch (e) { fail(res, e); }
});

/* ⚠️ Part 111 (Aug 31 2026) — `?raw=1` NOW GETS THROUGH, and it is the same
 * shape of gap as `temp=1` was in Part 92.8: the fork has served a raw lane
 * since July 30 ("pull raw immediately", session 19's watch item) and this
 * passthrough dropped it, so from out here every message was four fields —
 * sender, isUser, text, createdAt. Debugging tonight's double-answer meant
 * asking whether the turn had an error, a finish reason, a model, an
 * unfinished flag or two content blocks, and NONE of that was reachable.
 * A projection that hides the fields a bug lives in is not a smaller answer,
 * it is a different one. Only the exact string "1" turns it on. */
router.get("/librechat/admin-messages", auth, async (req, res) => {
  const convoId = req.query.convoId;
  if (!convoId) return res.status(400).json({ error: "convoId is required (get it from /librechat/admin-convos)" });
  const raw = String(req.query.raw || "") === "1" ? "&raw=1" : "";
  try {
    res.json(await lc("GET", `/api/kade/admin/logs-messages?conversationId=${encodeURIComponent(convoId)}${raw}`));
  } catch (e) { fail(res, e); }
});

router.get("/librechat/convos", auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    res.json(await lc("GET", `/api/convos?pageNumber=${page}&isArchived=false`));
  } catch (e) { fail(res, e); }
});
router.get("/librechat/messages", auth, async (req, res) => {
  const convoId = req.query.convoId;
  if (!convoId) return res.status(400).json({ error: "convoId is required" });
  try {
    res.json(await lc("GET", `/api/messages/${encodeURIComponent(convoId)}`));
  } catch (e) { fail(res, e); }
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

// ADMIN: add credits to a user's balance (the Feed-the-Server top-up lane).
// Added Aug 21 2026 while refunding the $6/M default-rate hole (tx.ts had no
// glm-5.x keys, so the fleet billed families at fantasy rates for days).
// body = { userId, amountUSD } -> fork /api/kade/add-credits.
// GET /librechat/my-cost?userId=<id> -> fork /api/kade/my-cost (admin read of one
// person's month-to-date SERVER COST: charged model spend / multiplier + extras).
router.get("/librechat/my-cost", auth, async (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId is required" });
  try {
    res.json(await lc("GET", `/api/kade/my-cost?userId=${encodeURIComponent(userId)}`));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/librechat/add-credits", auth, express.json({ limit: "16kb" }), async (req, res) => {
  const { userId, amountUSD } = req.body || {};
  if (!userId || !(Number(amountUSD) > 0)) {
    return res.status(400).json({ error: "userId and a positive amountUSD are required" });
  }
  try {
    res.json(await lc("POST", "/api/kade/add-credits", { userId, amountUSD: Number(amountUSD) }));
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
// Part 116 (Sep 1 2026): admin reads/retires of ANOTHER seat's memory cards.
// Born for the nightly persona battery, which probes on the vischeck seat and
// must sweep the cards its invented probes leave behind so tonight's Kiana
// does not "remember" last night's fake cousin. Fork routes are admin-only
// (`requireAdminAccess`); this is a passthrough, projection unchanged.
router.get("/librechat/admin-memories", auth, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    res.json(await lc("GET", `/api/memories/admin-list?userId=${encodeURIComponent(userId)}`));
  } catch (e) { fail(res, e); }
});
router.post("/librechat/admin-memory-retire", auth, async (req, res) => {
  const { userId, key, agentId } = req.body || {};
  if (!userId || !key) return res.status(400).json({ error: "userId and key required" });
  try {
    res.json(await lc("POST", "/api/memories/admin-retire", { userId, key, agentId: agentId || undefined }));
  } catch (e) { fail(res, e); }
});

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

// POST /librechat/memory-admin-set -> Part 85.5: seed/repair ONE card in ANY
// seat's bucket (admin twin of the fork's /api/memories/admin-set).
// body = { userId, key, value, agentId? }
router.post("/librechat/memory-admin-set", auth, async (req, res) => {
  const { userId, key, value, agentId } = req.body || {};
  if (!userId || !key || !value) return res.status(400).json({ error: "userId, key, value are required" });
  try {
    res.json(await lc("POST", "/api/memories/admin-set", { userId, key, value, agentId }));
  } catch (e) {
    fail(res, e);
  }
});

/* GET /librechat/memory-admin-list -> Part 99.3: READ any seat's cards. The
 * twin that was missing while admin-set and admin-retire could both WRITE to
 * a family member's private memory with nothing able to look at the result.
 * Query: userId (required, from /librechat/admin-users), includeSuperseded=1
 * for the history.
 *
 * PRIVACY SURFACE, STATED RATHER THAN BURIED: this returns agent-scoped cards,
 * which by the writer's SENSITIVE rule include medical, money and private
 * struggles that the user told ONE character. Anything holding
 * LIBRECHAT_PROXY_SECRET can now read them. That bearer could already WRITE
 * into those same buckets, so this widens what it can see, not what it can
 * reach -- but it is a real widening and it belongs in the record, not in a
 * comment nobody reads. */
router.get("/librechat/memory-admin-list", auth, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!userId) return res.status(400).json({ error: "userId is required (get it from /librechat/admin-users)" });
  const sup = String(req.query.includeSuperseded || "") === "1" ? "&includeSuperseded=1" : "";
  try {
    res.json(await lc("GET", `/api/memories/admin-list?userId=${encodeURIComponent(userId)}${sup}`));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/memory-admin-retire -> Part 85.5: supersede one key in one
// bucket of any seat (no new row). body = { userId, key, agentId? } — omit
// agentId to target the SHARED bucket.
router.post("/librechat/memory-admin-retire", auth, async (req, res) => {
  const { userId, key, agentId } = req.body || {};
  if (!userId || !key) return res.status(400).json({ error: "userId and key are required" });
  try {
    res.json(await lc("POST", "/api/memories/admin-retire", { userId, key, agentId }));
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

// POST /librechat/memory/diary-voice-repair -> Part 70's one-time logbook
// retrofit (pre-taste-rules entries get the friend voice; facts sacred,
// originals kept on-doc). body = { dryRun?, before?, limit? } — dryRun
// DEFAULTS TRUE server-side (a census, zero writes); pass dryRun:false to
// actually run it. The real run can take a couple of minutes for a big census.
router.post("/librechat/memory/diary-voice-repair", auth, async (req, res) => {
  const { dryRun, before, limit } = req.body || {};
  const body = {};
  if (dryRun === false) body.dryRun = false;
  if (typeof before === "string" && before.trim()) body.before = before.trim();
  if (Number.isInteger(limit) && limit > 0) body.limit = limit;
  try {
    res.json(await lc("POST", "/api/memories/diary-voice-repair", body));
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================================
// THE LOGBOOK (diary) READ LANE — Part 111, Aug 31 2026.
//
// Why this exists: the fork has served /api/diary since Aug 7 and
// /api/admin/diary since the same evening, and this proxy had a passthrough
// for NEITHER. So no session could read the logbook it kept writing laws
// about: five sessions argued about `wrote24h` purely as a COUNT, and Part
// 110's probe cleanup could clean the CARDS and could not check the diary at
// all. Reading is the whole point — nothing here writes.
//
// ⚠️ SCOPE, STATED ON THE ROUTE BECAUSE THIS IS THE EXACT TRAP OF LAW 25:
// `lc()` authenticates as LIBRECHAT_USER = kademurdock@gmail.com. So
// /librechat/diary reads HER logbook and nobody else's, no matter what you
// pass it. A parameter named for a user is not a seat. To read another seat,
// use /librechat/diary-admin-list, which takes a real ?userId= and goes
// through the fork's owner-gated admin lane.
// ============================================================================

// GET /librechat/diary?limit=400 -> HER OWN logbook, newest first. Embeddings
// never ride the wire (the fork strips them). See the scope warning above.
router.get("/librechat/diary", auth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 400, 1), 1000);
  try {
    res.json(await lc("GET", `/api/diary?limit=${limit}`));
  } catch (e) {
    fail(res, e);
  }
});

// GET /librechat/diary-admin-list?userId=<id>[&agentId=<id>][&limit=200] -> ANY
// seat's logbook, newest first, through the fork's admin lane (ACCESS_ADMIN +
// READ_USERS, which LIBRECHAT_USER holds). Same privacy surface already stated
// on memory-admin-list: diary lines are what somebody told a companion, so
// anything holding LIBRECHAT_PROXY_SECRET can now read them. Read-only.
router.get("/librechat/diary-admin-list", auth, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!userId) return res.status(400).json({ error: "userId is required (get it from /librechat/admin-users)" });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  let path = `/api/admin/diary?userId=${encodeURIComponent(userId)}&limit=${limit}`;
  if (typeof req.query.agentId === "string" && req.query.agentId.trim()) {
    path += `&agentId=${encodeURIComponent(req.query.agentId.trim())}`;
  }
  try {
    res.json(await lc("GET", path));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/diary-admin-delete {userId, id} -> forget ONE logbook entry.
// The deleted entry rides back in the response (delete-with-receipt, the same
// manner as every other delete lane here) so the caller can archive it before
// it is gone. This exists because a write path without a delete path is how
// the hallucinated-cards problem happened, and because a probe that writes
// into somebody's logbook has to be able to clean up after itself.
router.post("/librechat/diary-admin-delete", auth, async (req, res) => {
  const { userId, id } = req.body || {};
  if (!userId || !id) return res.status(400).json({ error: "userId and id are required" });
  try {
    res.json(await lc("DELETE", `/api/admin/diary/${encodeURIComponent(String(id))}?userId=${encodeURIComponent(String(userId))}`));
  } catch (e) {
    fail(res, e);
  }
});

// GET /librechat/ledger-admin?userId=&limit=&sinceDays= -> the CONSOLIDATION
// ledger for ANY seat. Part 112: /librechat/memory/ledger rides lc()'s login,
// which is KADE — so every "the ledger is empty" reading this platform has ever
// made was about her seat alone. This is the cross-seat read. (readLedger caps
// at 40 rows internally whatever you ask for.)
router.get("/librechat/ledger-admin", auth, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!userId) return res.status(400).json({ error: "userId is required (get it from /librechat/admin-users)" });
  const q = ["userId=" + encodeURIComponent(userId)];
  if (req.query.limit) q.push("limit=" + encodeURIComponent(req.query.limit));
  if (req.query.sinceDays) q.push("sinceDays=" + encodeURIComponent(req.query.sinceDays));
  try {
    res.json(await lc("GET", "/api/admin/diary/ledger?" + q.join("&")));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/diary-admin-edit {userId, id, text?, salience?} -> rewrite ONE
// logbook entry in place (the fork's PATCH /api/admin/diary/:id — id, date,
// scope and source survive; a text change re-embeds). Part 112: added for the
// episode merge she approved — the list/delete pair existed, the edit half of
// the fork's own admin surface was simply never exposed out here.
router.post("/librechat/diary-admin-edit", auth, async (req, res) => {
  const { userId, id, text, salience } = req.body || {};
  if (!userId || !id) return res.status(400).json({ error: "userId and id are required" });
  try {
    res.json(await lc("PATCH", `/api/admin/diary/${encodeURIComponent(String(id))}?userId=${encodeURIComponent(String(userId))}`, { ...(text !== undefined ? { text } : {}), ...(salience !== undefined ? { salience } : {}) }));
  } catch (e) {
    fail(res, e);
  }
});

// POST /librechat/diary-admin-create {userId, text, agentId?, scope?, entryDate?,
// source?, salience?} -> WRITE one logbook entry onto any seat (the fork's
// POST /api/admin/diary backfill lane, which embeds like any other write).
// Part 122.3: admin had list/edit/delete for the logbook and NO create, while
// memory has list/set/retire — so a logbook could be read and deleted but never
// filled, and an agent-scoped logbook could not follow its person when they
// moved a subject to another companion. Her word: "admin needs access to the
// logs the same way they do the memory. They work together, one provides facts
// and the other context."
//
// ⚠️ PROVENANCE. Retrieval renders "a few dated entries from YOUR private
// logbook about this person" with no source line, so an entry copied in raw
// makes the receiving agent remember a scene it was never in. When copying
// between agents, say so in the text.
router.post("/librechat/diary-admin-create", auth, async (req, res) => {
  const { userId, text, agentId, scope, entryDate, source, salience } = req.body || {};
  if (!userId || !text) return res.status(400).json({ error: "userId and text are required" });
  try {
    res.json(await lc("POST", "/api/admin/diary", {
      userId,
      text,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(entryDate !== undefined ? { entryDate } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(salience !== undefined ? { salience } : {}),
    }));
  } catch (e) {
    fail(res, e);
  }
});

// HISTORY MINER passthrough (Part 122.3). The fork has had the miner since
// Aug 8 2026 — "retro-fill cards + logbook from every user's past chats" — and
// it had no door out here, so a retro-fill could only be started by someone
// sitting in the admin UI. Her ask, the night the memory cap was found full:
// "can we retroactively run conversations through to get back some of the
// memories they could have had?" That is exactly what /reset + /start do: the
// miner marks each day it walks with a run-once claim, so days it already
// walked WHILE THE CAP WAS FULL (every write refused) are claimed but empty.
// Clearing those claims lets it walk them again with headroom.
//
// ⚠️ COST-BEARING. /start runs a keeper model over history — it spends money
// per conversation. Standing rule: a real number in front of Kade first.
// /status and /reset with dry:true are free; use them to size a run.
router.get("/librechat/mining-status", auth, async (_req, res) => {
  try {
    res.json(await lc("GET", "/api/admin/mining/status"));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/librechat/mining-start", auth, async (req, res) => {
  const { scope, maxPerRun } = req.body || {};
  try {
    res.json(await lc("POST", "/api/admin/mining/start", {
      ...(scope !== undefined ? { scope } : {}),
      ...(maxPerRun !== undefined ? { maxPerRun } : {}),
    }));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/librechat/mining-stop", auth, async (_req, res) => {
  try {
    res.json(await lc("POST", "/api/admin/mining/stop", {}));
  } catch (e) {
    fail(res, e);
  }
});

// body = { from, to, scope?, dry? } — clears run-once CLAIM ROWS ONLY for a date
// window. Never a diary entry, card or message. dry:true counts first.
router.post("/librechat/mining-reset", auth, async (req, res) => {
  const { from, to, scope, dry } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
  try {
    res.json(await lc("POST", "/api/admin/mining/reset", {
      from, to,
      ...(scope !== undefined ? { scope } : {}),
      ...(dry !== undefined ? { dry } : {}),
    }));
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
// Aug 16 2026 (Part 70.8): the hardcoded default here is the OLD Capacitor
// shell -- a native build fired through this lane landed on the wrong app and
// failed instantly on a missing workflow (buildId 6a8148677a198c3f535a92c6,
// the receipt). Named ids so callers can say which app they mean; native is
// the default now because every build since 203 has been native.
const CM_APP_ID = process.env.CODEMAGIC_APP_ID || "6a5c05bc7ed64e858ce8a6d6"; // kade-ai-native
const CM_APP_IDS = {
  native: "6a5c05bc7ed64e858ce8a6d6", // kade-ai-native (SwiftUI)
  shell: "6a570159a79b1534242af0d9", // kade-ai-app (Capacitor)
};
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
  const { workflowId, branch, appId, app } = req.body || {};
  try {
    const d = await codemagic("/builds", {
      method: "POST",
      body: JSON.stringify({
        // app: "native"|"shell" by name, or appId raw; default native.
        appId: appId || CM_APP_IDS[app] || CM_APP_ID,
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

  const seat = seatByName(opts.seat);
  if (seat !== SEATS.admin) console.log(`[lcAsk] riding seat "${opts.seat}" (${seat.user()})`);
  return paced(async () => {
    if (!seatToken(seat)) await seatLogin(seat);

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

    let r = await doStart(seatToken(seat));
    if (r.status === 401) { seatClear(seat); await seatLogin(seat); r = await doStart(seatToken(seat)); }
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
      headers: { Authorization: `Bearer ${seatToken(seat)}`, "User-Agent": UA, Accept: "text/event-stream" },
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
      // The convo belongs to whichever seat asked, so the delete rides that
      // seat's token too (a vischeck probe deleted with the admin token 404s).
      (seat === SEATS.admin
        ? lc("DELETE", "/api/convos/", { arg: { conversationId: bornConversationId } })
        : paced(() => fetch(`${BASE}/api/convos/`, buildOpts("DELETE", { arg: { conversationId: bornConversationId } }, seatToken(seat)))
            .then((rr) => { if (!rr.ok) throw new Error(`HTTP ${rr.status}`); })))
        .then(() => console.log(`[lcAsk] probe convo deleted (${bornConversationId.slice(0, 8)}…) as ${seat === SEATS.admin ? "admin" : "vischeck"}`))
        .catch((e) => console.warn("[lcAsk] probe delete failed (harmless):", e.message));
    }
    return stripCitationAnchors(reply);
  });
}

// POST /librechat/ask  { agentId, messages[], seat?: "admin"|"vischeck", deleteAfter? } -> { text, seat }
// Part 116: seat:"vischeck" runs the probe on the regular-user TEST seat -- its convo, its memory, never hers.
router.post("/librechat/ask", auth, async (req, res) => {
  const { agentId, messages } = req.body;
  console.log("[lcAsk] hit, agentId=", agentId, "msgs=", Array.isArray(messages) ? messages.length : "not array");
  if (!agentId || !Array.isArray(messages)) {
    return res.status(400).json({ error: "agentId and messages[] required" });
  }
  try {
    const seatName = (req.body || {}).seat || "admin";
    const text = await lcAsk(agentId, messages, (req.body || {}).userEmail, {
      deleteAfter: (req.body || {}).deleteAfter === true,
      seat: seatName,
    });
    console.log("[lcAsk] success, reply length=", text.length, "seat=", seatName);
    res.json({ text, seat: seatName });
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
