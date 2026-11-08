"use strict";
/**
 * error-text.js — WHAT AN ERROR ANSWER MAY SAY TO A CALLER WITH A SECRET (Nov 8 2026)
 *
 * The secret-gated routes (railway.js, github.js, librechat.js, and the approvals executor) put an error's own text in the answer:
 * `res.status(502).json({ error: e.message })`, `{ error: "GitHub commit failed", details: e.message }` and so on, about 90 places. The
 * text is what those routes are for. Their callers are Forge, an LLM that diagnoses from the words it gets back, and the bridge's nightly
 * battery, which matches /403|forbidden/ in the error of /librechat/ask to stop dead on a first 403. So the words stay. What does not
 * need to reach even them: a path inside the container ("open '/app/data/voices.json'"), a Bearer token, a key in a URL
 * ("?key=..."), a token someone put in a header. A provider's error can carry any of them, and so can ours.
 *
 * scrubText(text)   one string: container paths become <path>; Bearer tokens, well-known token shapes, JWTs, the password of
 *                   scheme://user:password@host, key=/token= parameters in a URL, key fields in JSON and key headers become <hidden>; the rest
 *                   is cut at 400 characters (and "..." added). Cleaning an already cleaned text changes nothing (pinned for ordinary text).
 *                   Quick on any input: it never looks at more than the first 2,000 characters, and no pattern is superlinear (the
 *                   Bearer lookahead goes back at most 200 characters).
 * scrubAnswer(body) a copy of an answer with those four text fields cleaned: error, details, detail, message. Other fields, nested objects
 *                   (a provider's own JSON under `detail` is data) and everything that is not a plain object are left as they are.
 * scrubErrorAnswers(res)
 *                   makes res.json clean an answer whose status is 400 or more, in all three forms Express 4 takes (res.json(body),
 *                   res.json(status, body), res.json(body, status)); res.send(object) goes through res.json and is covered. A 200 carries
 *                   data, such as the text of a file, which is not an error text and may well hold a path or a key as part of its content.
 *                   NOT covered: res.jsonp, res.send(string), res.end, a body that is not a plain object. No route of the gated modules
 *                   writes an error that way (grep before adding one).
 * scrubbingErrors   the same as an Express middleware, for a gated route that does not go through afterSecret() (GET /approvals/:id checks
 *                   its own Bearer).
 *
 * Who calls it: afterSecret() in body-limits.js installs the hook for every route it guards (all of railway.js, github.js, librechat.js and
 * POST /approvals/execute), GET /approvals/:id uses the middleware; by hand: the one Server-Sent-Events error frame of ask-stream, the
 * per-source errors in the 200 answer of /balances and the site's replies in the 200 answer of /librechat/seat-speech. body-limits-wire.test.js
 * asks the running server and fails for a gated route that has neither (first handler marked parsesJson or scrubsErrors).
 *
 * Not touched on purpose: the speech and transcription routes (they answer a plain error and log the cause: answer-text.test.js), and the logs
 * (they are for whoever debugs).
 */

const MAX_IN = 2000; // the longest stretch of a message that is looked at (a provider's error page can be megabytes)
const MAX_OUT = 400; // the longest message that goes out (before the "...")
const TEXT_KEYS = ["error", "details", "detail", "message"];
const ROOTS = "app|tmp|usr|opt|var|proc|etc|root|home|srv|mnt|lib|lib64|bin|sbin|dev|sys|run";
const SECRET_FIELDS = "api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|secret|password|passwd|pass|token|authorization|x-api-key|x-key|x-auth-token|x-kade-secret|x-proxy-secret|x-kade-approval-secret";
const PATH_END = "[/\\s'\"`)\\]},;:<>|]"; // what may follow the root of a path: more path, or the end of one
const PATH_BODY = "[^\\s'\"`<>()\\[\\]{},;|]*";

// Every pattern is linear: a literal start, then character classes with no nesting and no overlapping alternatives.
const RULES = [
  // a password in a URL: scheme://user:password@host (a Mongo or Postgres URI, a proxy URL)
  [/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/:@]{0,100}:[^\s/@]{1,200}@/gi, "$1<hidden>@"],
  // a JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<hidden>"],
  // well-known token shapes: GitHub, Google, Slack, OpenAI-style, Railway
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|rw_[A-Za-z0-9_-]{20,})/g, "<hidden>"],
  // Bearer <token>: a token has a digit or a punctuation mark in it ("Bearer authentication failed" is English)
  [/\bBearer\s+(?=[A-Za-z0-9._~+/=-]{0,200}[0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <hidden>"],
  // "api_key": "value" in JSON
  [new RegExp("(\"(?:" + SECRET_FIELDS + ")\"\\s*:\\s*\")[^\"]{3,}(\")", "gi"), "$1<hidden>$2"],
  // ?key=value and &token=value in a URL or a form
  [/([?&])(x-api-key|x-key|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|key|token|sig|signature)=[^&\s"'<>)]+/gi, "$1$2=<hidden>"],
  // x-key: value and the like, as a header line (not "Authorization: Bearer ...", which the rule above has handled; and a value is a key only
  // when it has a digit or one of _=+/ in it: "Authorization: failed" is English)
  [/\b(x-api-key|x-key|api-key|authorization|proxy-authorization|x-auth-token|x-kade-secret|x-proxy-secret|x-kade-approval-secret)(\s*[:=]\s*)(?!Bearer\b|<hidden>)(?=[^\s,;"'<>]{0,64}[0-9_=+/])[^\s,;"'<>]{6,}/gi, "$1$2<hidden>"],
  // a file:// URL to a path inside the container
  [new RegExp("\\bfile://(?=/(?:" + ROOTS + ")(?=" + PATH_END + "|$))" + PATH_BODY, "gi"), "<path>"],
  // a path inside the container (the root must end where a path ends, so /approvals/execute and /appsettings are not paths)
  [new RegExp("(?<![\\w./~-])/(?:" + ROOTS + ")(?=" + PATH_END + "|$)" + PATH_BODY, "g"), "<path>"],
  // a Windows path
  [/\b[A-Za-z]:[\\/][^\s'"<>|]*/g, "<path>"],
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
  res.json = function scrubbedJson(...args) {
    try {
      // Express 4 still takes res.json(body, status) and res.json(status, body) when there are two arguments
      let status = this.statusCode;
      let at = 0;
      if (args.length === 2) {
        if (typeof args[1] === "number") status = args[1];
        else { status = args[0]; at = 1; }
      }
      if (status >= 400) args[at] = scrubAnswer(args[at]);
    } catch (e) {
      // cleaning must never decide whether an answer goes out
    }
    return json.apply(this, args);
  };
  res.json.scrubsErrorAnswers = true;
}

function scrubbingErrors(req, res, next) {
  scrubErrorAnswers(res);
  next();
}
scrubbingErrors.scrubsErrors = true; // the route table of body-limits-wire.test.js looks for this

module.exports = { scrubText, scrubAnswer, scrubErrorAnswers, scrubbingErrors, MAX_IN, MAX_OUT };
