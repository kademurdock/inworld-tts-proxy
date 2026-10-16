"use strict";
/**
 * speech-gate.js — WHO MAY SPEND THE VOICE CREDIT (Oct 16 2026)
 *
 * Until today POST /v1/audio/speech and POST /v1/audio/transcriptions
 * answered anyone who knew this service's URL: a free probe with an empty
 * body came back 400 "Missing required field: input", so a full body would
 * have made paid Fish, Inworld or Deepgram audio on Kade's credit. CORS only
 * stops browsers on other sites, never a script.
 *
 * The fix is one shared secret, KADE_SPEECH_SECRET, held by this service and
 * by every server that speaks through it (the LibreChat fork and the bridge).
 * A caller proves it in one of two ways:
 *   - the `x-proxy-secret` header (the fork's own direct callers, the bridge);
 *   - `Authorization: Bearer <secret>`, because LibreChat's built-in OpenAI
 *     speech and transcription strategies already send their configured
 *     apiKey that way (kade-config.yaml `speech.*.openai.apiKey`).
 * The proxy's own LIBRECHAT_PROXY_SECRET is honoured too: whoever holds it can
 * already drive every /librechat route here, so refusing it speech protects
 * nothing.
 *
 * Browsers never hold the secret. The website's voice mode now goes through
 * the fork's signed-in /api/files/speech/tts/manual like the iPhone does.
 *
 * SPEECH_GATE picks the mode, so the rollout can be watched before it bites:
 *   off     — no checks, no logging (the old behaviour);
 *   log     — every request passes, and the ones that would be refused are
 *             logged with enough to name the caller (the default);
 *   enforce — requests without the secret get 401.
 * Enforce with no secret configured falls back to log and says so at boot:
 * a deleted variable must not silence the family's voices.
 *
 * Callers may name themselves with `x-kade-caller` (a short lane name such as
 * "fork-tts" or "bridge-phone"). It proves nothing; it only makes the
 * ten-minute summary say which lanes are sending the secret.
 */
const crypto = require("crypto");

const MODES = ["off", "log", "enforce"];
const SUMMARY_MS = 10 * 60 * 1000;
const LINES_PER_MINUTE = 20;

function parseSecrets(...values) {
  const out = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    for (const part of v.split(",")) {
      const s = part.trim();
      if (s.length >= 16) out.push(s);
    }
  }
  return out;
}

function digest(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

/** Constant-time match of one presented value against a list of secrets. */
function matchesAny(presented, secrets) {
  if (!presented || !secrets.length) return false;
  const p = digest(presented);
  let hit = false;
  for (const s of secrets) if (crypto.timingSafeEqual(p, digest(s))) hit = true;
  return hit;
}

function headerOf(req, name) {
  if (typeof req.get === "function") return req.get(name) || "";
  const v = req.headers && req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function presentedCredentials(req) {
  const header = String(headerOf(req, "x-proxy-secret")).trim();
  const auth = String(headerOf(req, "authorization")).trim();
  const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
  return { header, bearer };
}

/** Short, log-safe text: no newlines, no quotes, capped. */
function clip(s, n) {
  return String(s || "").replace(/[\r\n"]/g, " ").slice(0, n);
}

/** The first forwarded address, cut to its /24 (or the first four IPv6 groups). */
function callerNet(req) {
  const fwd = String(headerOf(req, "x-forwarded-for")).split(",")[0].trim() || String(req.ip || "");
  const v4 = fwd.match(/(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (fwd.includes(":")) return fwd.split(":").slice(0, 4).join(":") + ":x";
  return fwd ? "?" : "none";
}

function routeOf(req) {
  const url = String(req.originalUrl || req.url || "");
  return url.split("?")[0] || "?";
}

function createSpeechGate({ env = process.env, log = console, now = Date.now, summaryMs = SUMMARY_MS, timers = true } = {}) {
  const asked = String(env.SPEECH_GATE || "log").trim().toLowerCase();
  const secrets = parseSecrets(env.KADE_SPEECH_SECRET);
  const adminSecrets = parseSecrets(env.LIBRECHAT_PROXY_SECRET);
  let mode = MODES.includes(asked) ? asked : "log";
  let bootNote = `[speech-gate] mode=${mode}, ${secrets.length} speech secret(s) configured`;
  if (!MODES.includes(asked)) bootNote += ` (SPEECH_GATE="${clip(asked, 20)}" is not off/log/enforce, so log)`;
  if (mode === "enforce" && !secrets.length) {
    mode = "log";
    bootNote = "[speech-gate] SPEECH_GATE=enforce but KADE_SPEECH_SECRET is not set, so the gate only LOGS. Set the secret on this service and on every caller, then redeploy.";
  }
  log.log(bootNote);

  let allowed = new Map(); // "caller via" -> count
  let refused = new Map(); // "why route ua origin net" -> count
  let windowStart = now();
  let minuteStart = now();
  let linesThisMinute = 0;

  function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  function summary() {
    const ok = [...allowed.values()].reduce((a, b) => a + b, 0);
    const bad = [...refused.values()].reduce((a, b) => a + b, 0);
    if (!ok && !bad) return null;
    const mins = Math.max(1, Math.round((now() - windowStart) / 60000));
    const okParts = [...allowed.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    const badParts = [...refused.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} x${n}`).join("; ");
    const verb = mode === "enforce" ? "refused" : "would refuse";
    const line = `[speech-gate] mode=${mode}, last ${mins} min: allowed ${ok}${okParts ? ` (${okParts})` : ""}; ${verb} ${bad}${badParts ? ` (${badParts})` : ""}`;
    allowed = new Map();
    refused = new Map();
    windowStart = now();
    return line;
  }

  if (timers && mode !== "off") {
    const t = setInterval(() => {
      const line = summary();
      if (line) log.log(line);
    }, summaryMs);
    if (t.unref) t.unref();
  }

  function middleware(req, res, next) {
    if (mode === "off" || req.method === "OPTIONS") return next();
    const { header, bearer } = presentedCredentials(req);
    const caller = clip(headerOf(req, "x-kade-caller"), 40).replace(/\s+/g, "-") || "unnamed";
    let via = null;
    if (matchesAny(header, secrets)) via = "header";
    else if (matchesAny(bearer, secrets)) via = "bearer";
    else if (matchesAny(header, adminSecrets) || matchesAny(bearer, adminSecrets)) via = "admin";
    if (via) {
      bump(allowed, `${caller}/${via}`);
      return next();
    }
    const why = header ? "wrong-header" : bearer ? "wrong-bearer" : "missing";
    const route = routeOf(req);
    const ua = clip(headerOf(req, "user-agent"), 80) || "none";
    const origin = clip(headerOf(req, "origin"), 60) || "none";
    const net = callerNet(req);
    bump(refused, `${why} ${route} caller=${caller} origin=${origin} net=${net} ua="${ua}"`);
    if (now() - minuteStart >= 60000) {
      minuteStart = now();
      linesThisMinute = 0;
    }
    if (linesThisMinute < LINES_PER_MINUTE) {
      linesThisMinute += 1;
      const verb = mode === "enforce" ? "refused" : "would refuse";
      log.warn(`[speech-gate] ${verb}: ${why} ${req.method} ${route} caller=${caller} origin=${origin} net=${net} ua="${ua}"`);
    }
    if (mode === "enforce") {
      return res.status(401).json({ error: "This voice service only answers the Kade-AI platform." });
    }
    return next();
  }

  return { middleware, summary, mode: () => mode };
}

module.exports = { createSpeechGate, parseSecrets, matchesAny, callerNet, presentedCredentials, MODES };
