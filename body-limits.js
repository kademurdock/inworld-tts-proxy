"use strict";
/**
 * body-limits.js — HOW MUCH JSON THIS SERVICE READS, AND FROM WHOM (Nov 8 2026)
 *
 * WHAT IT REPLACES. server.js began with `app.use(express.json({ limit: "10mb" }))`: the first layer of the app, ahead of
 * every route and every secret check. July 18 2026 raised it from the 100 KB default so /github/commit could carry whole
 * files (the bridge's voice-stream.js is ~140 KB raw); Aug 14 raised it again to 10 MB for the agent-avatar lane (base64 PNGs),
 * and said why it had to be global: the global parser runs before any route-level limit can raise it. The price, found by the
 * route-guard review of Nov 7: a STRANGER could make the service parse 10 MB of JSON. A 10 KB gzip body that inflates to a
 * 10 MB `[{},{},...]` held the event loop for 0.4 to 1.2 seconds per request on a fresh process (more on a busy one), cost
 * 175 to 435 MB of heap each (eight at once took a process with a 1 GB heap to 805 MB of RSS; the first design of the route guard, which let
 * them wait for the 404, ran out of memory with eight). body-parser counts the INFLATED bytes against the limit, so
 * the compression itself was never the hole: the limit was simply 10 MB for everyone.
 *
 * THE RULE NOW. Nobody's body is read until the service knows what it is dealing with, and nobody who is not trusted gets
 * a big one:
 *   - the secret-gated routes (every route of railway.js, github.js and librechat.js, and POST /approvals/execute) read their
 *     JSON body AFTER the secret check, up to the old 10 MB: that is where the big bodies are (avatars, whole files, the
 *     params of an approved commit), and the callers there are Forge, the bridge, the LibreChat fork and the apps. A wrong or
 *     missing secret is answered 401 or 403 without the body being read (it used to be answered after the 10 MB parse);
 *   - POST /v1/audio/speech reads its JSON AFTER the speech gate (SPEECH_GATE=enforce answers a stranger 401 first) and at
 *     most 256 KB. Real requests are small: the longest `input` in a day of live traffic (709 requests, Nov 6 and 7 2026) was
 *     1,587 characters, and the biggest request the LibreChat fork's MANUAL lane can make is one `input` of 32,767 characters (its
 *     TTSService cuts longer text into pieces of 4,000), which is 98 KB of JSON at three bytes a character; 256 KB leaves room
 *     for escapes. CORRECTION, Nov 10 2026: that is not the fork's biggest request. Its auto-play lane (streamAudio) sends a finished
 *     message as ONE `input` of up to 100,000 characters (speechCap.js there, which records a real one of 56,702). In plain English
 *     that is about 100 KB of JSON and fits; a text of more than about 85,000 characters written mostly in three-byte characters
 *     (Chinese, Japanese, Korean) does not fit 256 KB and has been answered 413 by this parser since Nov 8. The cap on `input`
 *     itself (server.js, SPEECH_MAX_INPUT_CHARS) is 100,000 for the same reason. Express's own default of 100 KB served this route until July 18. Worst case for JSON.parse at 256 KB is
 *     0.3 to 0.4 s of CPU (flat arrays and deep ones measured), and only for a caller the gate let through (or any caller in gate mode
 *     `log`). That is the PARSE. The work the route does for the text it is given (shaping and limiting the audio that comes back) grows with
 *     the length of `input`, not with the JSON, and this cap does not bound it: one 257 KB request held the loop 1.1 s in the black-box
 *     review of Nov 8 with an instant provider, and the same route holds it for as long as the audio is long (hand-over: a cap on `input`);
 *   - there is NO global parser: a path no route answers, a GET, an upload (the transcription route is multipart, read by busboy)
 *     parses no JSON at all (Express still reads an unwanted body off the wire, unparsed). A new route that needs a body says so itself: after a secret check (afterSecret) or with
 *     speechJson / its own express.json(). body-limits-wire.test.js asks the running server and fails for a route that has neither.
 *
 * WHAT DID NOT CHANGE. A request with the right secret gets the same limit (10 MB), the same parser and the same
 * answers as before. The route-level parsers in librechat.js (avatar-gen 64kb, agent-avatar 8mb, add-credits 16kb) were never
 * reached, because the global parser had already read the body; they still are not, for the same reason, one step later.
 * Only requests that were failing anyway are answered differently: a bad secret with a body that is not JSON is now 401 or
 * 403 (it was 400), and a body that is not JSON sent to a path no route answers is now 404 (it was 400).
 *
 * KNOWN RESIDUAL (black-box reviews of Nov 8, findings A3 and C3). A caller that asks for `Connection: close` (HTTP/1.0 clients, Python's
 * urllib, a Node client with agent: false) and sends a body of about 256 KB or more to a route that answers without needing it (a wrong or
 * missing secret on a gated route; a GET route that takes no body, such as /help) is answered before its body is read, and Node closes that
 * connection right after the answer with the rest of the body unread: the client's TCP stack can turn that into a reset, and a client
 * library may report ECONNRESET instead of the answer (wrong secret: 256 KB 1 try in 20, 512 KB to 1 MB 35 to 40 in 100, 4 MB all; GET /help
 * with a 3 MB body 13 of 40, with 10 MB 10 of 40; a raw socket still reads the answer). Keep-alive clients, every caller with the right
 * secret on a route that reads its body, and every unknown path are not affected (Express's final handler reads a body off the wire before it
 * answers 404). The body used to be read first, so those answers were clean. The remedy is to hold the answer until the body has been read
 * off the wire (not parsed), or a lingering close; neither is built, because the price of the residual is a confusing error for a
 * close-client that sends a big body where none is wanted, and the remedy is new code in the path of every route.
 *
 * ONE MORE DUTY OF THE GATE (also Nov 8 2026): afterSecret() makes every error answer sent with res.json (status 400 and up) of a route it guards
 * lose the paths and tokens in its text (error-text.js) and keep every other word. The text stays because its readers need it (Forge diagnoses
 * from it; the bridge's battery matches /403|forbidden/ in it). The data of a success answer is never touched. GET /approvals/:id checks its own
 * Bearer and uses error-text.js's middleware instead; body-limits-wire.test.js asks the running server for every route of the gated families.
 */
const express = require("express");
const { scrubErrorAnswers } = require("./error-text");

const GATED_LIMIT = "10mb";
const SPEECH_LIMIT = "256kb";

const gatedJson = express.json({ limit: GATED_LIMIT });
const speechJson = express.json({ limit: SPEECH_LIMIT });

/**
 * A secret check that reads the JSON body only for a caller it lets through.
 * `check(req, res, next)` is the module's own check, unchanged: it answers 401/403/500 itself, or calls next().
 * Anything the check passes to next (an error, "route") goes on exactly as it would have.
 */
function afterSecret(check) {
  function secretThenBody(req, res, next) {
    scrubErrorAnswers(res); // an error answer of a secret-gated route keeps its words and loses paths and tokens (error-text.js)
    // `return`: the route guard of Nov 7 (async-routes.js) follows what a handler hands back, so a check that is an async function and
    // rejects is answered 500 instead of leaving its request hanging for ever (all four checks today are synchronous)
    return check(req, res, (arg) => (arg ? next(arg) : gatedJson(req, res, next)));
  }
  secretThenBody.parsesJson = true; // the route table of body-limits-wire.test.js looks for these two
  secretThenBody.scrubsErrors = true;
  return secretThenBody;
}

module.exports = { afterSecret, speechJson, GATED_LIMIT, SPEECH_LIMIT };
