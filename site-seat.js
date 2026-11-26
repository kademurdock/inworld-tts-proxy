"use strict";
/* site-seat.js -- Nov 26 2026 (Part 461). The service seat for calls to the site.
 *
 * Once the site runs with TRUST_PROXY=2 it counts sign-ins and turns by the
 * real caller's address. Everything this proxy sends to the site (Forge's
 * calls, the bridge's agent lookups and call turns, the Canary probe, the
 * battery's App Review seat) comes from one Railway address, so it would trip
 * the site's per-address limits. The site lets a request skip only those
 * per-address limits (never sign-in, never per-account limits) when it carries
 * the header X-Kade-Service with the value of KADE_SERVICE_LIMIT_SECRET.
 *
 * installFetchSeat() wraps the global fetch once. A request to the site
 * (LIBRECHAT_BASE, LIBRECHAT_URL, or kademurdock.com) gets the header; nothing
 * else does. A redirect from the site is followed by hand: to the site again,
 * with the header; anywhere else, without it. The value is never logged.
 * Unset KADE_SERVICE_LIMIT_SECRET = fetch behaves exactly as before.
 */
const HEADER = "X-Kade-Service";
const DEFAULT_SITE = "https://kademurdock.com";
const MAX_HOPS = 5;

function originOf(value) {
  try { return new URL(String(value)).origin; } catch (_) { return ""; }
}

/** The site's origins, read fresh each time. */
function siteOrigins(env = process.env) {
  const out = new Set([originOf(DEFAULT_SITE)]);
  for (const v of [env.LIBRECHAT_BASE, env.LIBRECHAT_URL]) {
    const o = v ? originOf(v) : "";
    if (o) out.add(o);
  }
  out.delete("");
  return out;
}

function seatSecret(env = process.env) {
  return typeof env.KADE_SERVICE_LIMIT_SECRET === "string" ? env.KADE_SERVICE_LIMIT_SECRET.trim() : "";
}

function isSiteUrl(url, env = process.env) {
  const o = originOf(url);
  return !!o && siteOrigins(env).has(o);
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.href === "string") return input.href; // URL
  if (input && typeof input.url === "string") return input.url; // Request
  return "";
}

const isRequest = (input) => typeof Request === "function" && input instanceof Request;

/** A body that can be sent a second time after a redirect. */
function replayable(body) {
  return body === undefined || body === null || typeof body === "string" ||
    body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

async function seatFetch(realFetch, input, init, env, hops = 0) {
  const secret = seatSecret(env);
  const url = urlOf(input);
  if (!secret || !isSiteUrl(url, env)) return realFetch(input, init);

  const base = init || {};
  const headers = new Headers(base.headers !== undefined ? base.headers : (isRequest(input) ? input.headers : undefined));
  headers.set(HEADER, secret);
  const wanted = base.redirect || (isRequest(input) ? input.redirect : "follow");
  const res = await realFetch(input, { ...base, headers, redirect: "manual" });

  if (res.status < 300 || res.status > 399 || wanted === "manual") return res;
  if (wanted === "error") throw new TypeError("fetch failed: redirect not allowed");
  const location = res.headers.get("location");
  if (!location || hops >= MAX_HOPS) return res;

  let method = String(base.method || (isRequest(input) ? input.method : "GET")).toUpperCase();
  let body = base.body;
  if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
    method = method === "HEAD" ? "HEAD" : "GET";
    body = undefined;
  } else if (!replayable(body) || isRequest(input)) {
    return res; // cannot send this body twice; hand back the redirect as it is
  }
  try { if (res.body) await res.body.cancel(); } catch (_) { /* nothing to free */ }

  const next = new URL(location, url).href;
  const nextInit = { ...base, method, body, redirect: wanted };
  if (body === undefined) {
    delete nextInit.body;
    const h = new Headers(base.headers);
    h.delete("content-type");
    h.delete("content-length");
    nextInit.headers = h;
  }
  if (isSiteUrl(next, env)) return seatFetch(realFetch, next, nextInit, env, hops + 1);
  return realFetch(next, nextInit); // off the site: the caller's own headers, never the seat
}

let installed = false;
/** Wrap the global fetch once. Every module that calls fetch() picks it up at call time. */
function installFetchSeat(env = process.env) {
  if (installed || typeof globalThis.fetch !== "function") return false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = function kadeSeatFetch(input, init) {
    return seatFetch(realFetch, input, init, env);
  };
  installed = true;
  return true;
}

module.exports = { HEADER, siteOrigins, isSiteUrl, seatFetch, installFetchSeat };
