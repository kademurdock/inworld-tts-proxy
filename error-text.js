"use strict";
/**
 * error-text.js — WHAT AN ERROR ANSWER MAY SAY TO A CALLER WITH A SECRET (Nov 8 2026)
 *
 * The secret-gated routes (railway.js, github.js, librechat.js, and the approvals executor) put an error's own text in the answer:
 * `res.status(502).json({ error: e.message })`, `{ error: "GitHub commit failed", details: e.message }` and so on, about 85 places. The
 * text is what those routes are for. Their callers are Forge, an LLM that diagnoses from the words it gets back, and the bridge's nightly
 * battery, which matches /403|forbidden/ in the error of /librechat/ask to stop dead on a first 403. So the words stay. What does not
 * need to reach even them: a path inside the container ("open '/app/data/voices.json'"), a Bearer token, a key in a URL
 * ("?key=..."), a token someone put in a header. A provider's error can carry any of them, and so can ours.
 *
 * scrubText(text)   one string: container paths become <path>; Bearer tokens, well-known token shapes, JWTs, key=/token= parameters in a URL,
 *                   key fields in JSON and key headers become <hidden>; the rest is cut at 400 characters ("..."). Idempotent, and quick on any
 *                   input (it never looks at more than the first 2,000 characters, and no pattern backtracks).
 * scrubAnswer(body) a copy of an answer with those four text fields cleaned: error, details, detail, message. Other fields, nested objects
 *                   and everything that is not a plain object are left as they are.
 * scrubErrorAnswers(res)
 *                   makes res.json clean an answer whose status is 400 or more (and only then: a 200 carries data, such as the text of a file,
 *                   which is not an error text and may well hold a path or a key as part of its content). afterSecret() in body-limits.js
 *                   calls it for every secret-gated route, so a new route is covered without a line of its own.
 *
 * Not touched on purpose: the speech and transcription routes (they answer a plain error and log the cause: answer-text.test.js), a
 * Server-Sent-Events frame (librechat.js cleans the one it writes), and the log lines (they are for whoever debugs).
 */

const MAX_IN = 2000; // the longest stretch of a message that is looked at (a provider's error page can be megabytes)
const MAX_OUT = 400; // the longest message that goes out
const TEXT_KEYS = ["error", "details", "detail", "message"];
const ROOTS = "app|tmp|usr|opt|var|proc|etc|root|home|srv|mnt";

// Every pattern is linear: a literal start, then character classes with no nesting and no overlapping alternatives.
const RULES = [
  // a password in a URL: scheme://user:password@host (a Mongo or Postgres URI, a proxy URL)
  [/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/:@]{1,100}:[^\s/@]{1,200}@/gi, "$1<hidden>@"],
  // a JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<hidden>"],
  // well-known token shapes: GitHub, Google, Slack, OpenAI-style, Railway
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|rw_[A-Za-z0-9_-]{20,})/g, "<hidden>"],
  // Bearer <token>: a token has a digit or a punctuation mark in it ("Bearer authentication failed" is English)
  [/\bBearer\s+(?=[A-Za-z0-9._~+/=-]{0,200}[0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <hidden>"],
  // "api_key": "value" in JSON
  [/("(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|authorization|x-api-key|x-key)"\s*:\s*")[^"]{3,}(")/gi, "$1<hidden>$2"],
  // ?key=value and &token=value in a URL or a form
  [/([?&])(x-api-key|x-key|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|key|token|sig|signature)=[^&\s"'<>)]+/gi, "$1$2=<hidden>"],
  // x-key: value and the like, as a header line (not "Authorization: Bearer ...", which the rule above has handled)
  [/\b(x-api-key|x-key|api-key|authorization)(\s*[:=]\s*)(?!Bearer\b|<hidden>)[^\s,;"'<>]{6,}/gi, "$1$2<hidden>"],
  // a path inside the container (the root must end where a path ends, so /approvals/execute and /appsettings are not paths)
  [new RegExp("(?<![\\w./:~-])/(?:" + ROOTS + ")(?=[/\\s'\"`)\\]},;:<>]|$)[^\\s'\"`<>()\\[\\]{},;|]*", "g"), "<path>"],
  // a Windows path
  [/\b[A-Za-z]:\\[^\s'"<>|]*/g, "<path>"],
];

function scrubText(value) {
  if (typeof value !== "string") return value;
  let s = value.length > MAX_IN ? value.slice(0, MAX_IN) : value;
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "..." : s;
}

function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function scrubAnswer(body) {
  if (!isPlainObject(body)) return body;
  const out = { ...body };
  for (const key of TEXT_KEYS) {
    if (typeof out[key] === "string") out[key] = scrubText(out[key]);
  }
  return out;
}

function scrubErrorAnswers(res) {
  const json = res.json;
  if (json && json.scrubsErrorAnswers) return; // once is enough
  res.json = function scrubbedJson(body) {
    let answer = body;
    try {
      if (this.statusCode >= 400) answer = scrubAnswer(body);
    } catch (e) {
      answer = body; // cleaning must never decide whether an answer goes out
    }
    return json.call(this, answer);
  };
  res.json.scrubsErrorAnswers = true;
}

module.exports = { scrubText, scrubAnswer, scrubErrorAnswers, MAX_IN, MAX_OUT };
