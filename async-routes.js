"use strict";
/**
 * async-routes.js -- A REJECTED HANDLER ANSWERS ITS OWN REQUEST (Nov 7 2026)
 *
 * Express 4 never looks at what a route handler returns. An `async` handler that throws (a request body with a field
 * of the wrong type is enough: `{"branch":5}`, `{"input":{"toString":1}}`, a lone surrogate in a key) hands Express a
 * REJECTED PROMISE that nobody listens to, and Node ends the process on an unhandled rejection. Every listener's audio
 * stops, and Railway restarts the service only up to three times (railway.toml: restartPolicyType ON_FAILURE,
 * restartPolicyMaxRetries 3): a fourth crash leaves it down until someone deploys. An independent review on Nov 7 2026
 * found 25 such request shapes on 8 routes (all behind a secret) and about 90 async handlers with no guard of their own;
 * only the speech route had one (guardAsync in server.js).
 *
 * This is the express-async-errors technique, done once on the Layer prototype that every Express 4 route and every
 * middleware passes through. When a handler returns something with a `then`, a rejection of it goes to next(err), exactly
 * as a synchronous throw always did, and from there to the error middleware that server.js mounts after the last route
 * (finalErrorHandler), which writes the answer. A promise that resolves is left alone, and so is everything a handler
 * returns that is not a thenable (`return res.json(...)` is common and stays exactly as it was). A rejection that comes
 * after the answer is already out is handled on the spot (the same function, no next()): the router may have moved past
 * the error middleware by then, and Express's own handler would destroy the socket.
 *
 * Why not one process-level unhandledRejection handler INSTEAD: without a guard on each route it turns the crash into a
 * request that is NEVER answered (the socket stays open as long as the caller does, and a 10 MB body stays in memory with
 * it: 19 such requests took the process from 84 MB to 567 MB), and it lets a failing boot look healthy. Here every
 * request is answered. The net at the end of this file is the LAST layer, for rejections that belong to no request.
 *
 * What goes to next(): next() with a falsy value means "carry on to the next route" and the strings "route" and "router"
 * are Express control flow, so a handler that FAILS with `undefined`, `0`, "route" and so on must not be taken for a
 * success: those become an Error that says what happened. Every other thrown or rejected value is passed on untouched
 * (a Symbol, an object without a prototype), so the error middleware must be able to print anything.
 *
 * It is built for Express 4 (pnpm-lock.yaml pins 4.22.3). Express 5 handles rejected promises itself and has no
 * express/lib/router/layer: this file then stops the boot, loudly, and should be deleted.
 */

const http = require("http");

const FLAG = Symbol.for("inworld-tts-proxy.async-routes");
const CLIP = 300;
const noop = () => {};
// C0 and C1 control characters and DEL (built from code points: this file holds no escape sequences for them)
const CONTROLS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + "]", "g");

/** One short clean line: cut at CLIP characters, line breaks and other control characters (an ESC, a CR) become spaces. */
function clip(s) {
  const head = s.length > CLIP ? s.slice(0, CLIP) : s;
  return head.replace(CONTROLS, " ") + (s.length > CLIP ? "..." : "");
}

/**
 * What a thrown or rejected value looks like in a log line or an error message. Never throws and never returns
 * more than a short line: a Symbol, an object without a prototype, a toString that is not a function, a getter that
 * throws and an array nested 30,000 deep all have an answer.
 */
function describeCause(value) {
  try { return clip(String(value)); } catch (e) { /* no prototype, a throwing toString, a stack too deep */ }
  try { return clip(Object.prototype.toString.call(value)); } catch (e) { /* a Proxy that throws on everything */ }
  return "unprintable value";
}

/** The value that is safe to hand to next(): see the header. */
function asFailure(reason) {
  if (reason && reason !== "route" && reason !== "router") return reason;
  const what = typeof reason === "string" ? JSON.stringify(reason) : describeCause(reason);
  return new Error("handler failed with " + what);
}

/** The last thing to try when even next() threw: an empty 500, or an end to a response that already started. */
function lastResort(res) {
  try {
    if (res && !res.headersSent) res.statusCode = 500;
    if (res && typeof res.end === "function") res.end();
  } catch (e) { /* the connection is gone */ }
}

/** Has any part of the answer left already? (Never throws.) */
function answerIsOut(res) {
  try { return Boolean(res.headersSent); } catch (e) { return false; }
}

/**
 * If a handler returned a thenable, send its rejection to next(). Nothing here may throw or reject: an error thrown
 * inside a promise reaction would itself be an unhandled rejection, which is the very crash this file exists to stop.
 * A rejection that comes after the answer went out is not sent on: nothing downstream can add to that answer, and a
 * router whose request has already moved past the error middleware would hand it to Express's own handler, which
 * destroys the socket. It is handled right here, the way the error middleware handles it.
 */
function follow(returned, req, res, next) {
  let then;
  try {
    then = returned === null || returned === undefined ? undefined : returned.then;
  } catch (e) {
    return; // a `then` that throws when read is not a promise anyone can follow
  }
  if (typeof then !== "function") return;
  const rejected = (reason) => {
    try {
      const err = asFailure(reason);
      if (answerIsOut(res)) {
        finalErrorHandler(err, req, res, next);
        return;
      }
      next(err);
    } catch (e) {
      lastResort(res);
    }
  };
  try {
    then.call(returned, undefined, rejected);
  } catch (e) {
    rejected(e);
  }
}

// Same bodies as Express 4.22.3's Layer, plus the two lines that follow what a handler returned.
function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) {
    // not a standard request handler
    return next();
  }
  let returned;
  try {
    returned = fn(req, res, next);
  } catch (err) {
    return next(asFailure(err));
  }
  follow(returned, req, res, next);
}

function handle_error(error, req, res, next) {
  const fn = this.handle;
  if (fn.length !== 4) {
    // not a standard error handler
    return next(error);
  }
  let returned;
  try {
    returned = fn(error, req, res, next);
  } catch (err) {
    return next(asFailure(err));
  }
  follow(returned, req, res, next);
}

// ── the error middleware that answers ─────────────────────────────────────────────────────────────

/**
 * The status the caller gets. An HTTP library may have put a 4xx on the error (body-parser: 400 for a body that is not
 * JSON, 413 for one over the limit): that stays, as it did under Express's own handler. Anything else is the proxy's
 * fault, and is a 500.
 */
function statusOf(err) {
  try {
    for (const status of [err.status, err.statusCode]) {
      if (Number.isInteger(status) && status >= 400 && status <= 499) return status;
    }
  } catch (e) { /* null, undefined, or a getter that throws */ }
  return 500;
}

/** "POST /librechat/janitor": the method and the path, never the query string (it may carry a secret). */
function whereOf(req) {
  try {
    const path = req.path !== undefined ? req.path : String(req.url).split("?")[0];
    return String(req.method).slice(0, 16) + " " + String(path).slice(0, 200).replace(/[^ -~]/g, "?");
  } catch (e) {
    return "(request unknown)";
  }
}

/**
 * The first five stack frames ("    at ...") of a thrown Error, each on its own line after a line break; "" for anything
 * else. Only real frames count: a message with line breaks in it (a request body can put some there) continues the
 * stack text before the first frame and must not pass for log lines. Never throws.
 */
function framesOf(err) {
  try {
    if (typeof err.stack === "string") {
      const frames = err.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 5).map((line) => line.replace(CONTROLS, " "));
      if (frames.length) return "\n" + frames.join("\n");
    }
  } catch (e) { /* no stack to show */ }
  return "";
}

/**
 * One log line for a 4xx; a line and five stack frames for a 500 or for a failure after the answer went out.
 * Printing must never be the thing that fails.
 */
function report(req, err, status, late) {
  try {
    const where = whereOf(req);
    const cause = describeCause(err);
    if (late || status >= 500) {
      console.error("[proxy] " + where + (late ? " failed after its answer went out: " : " failed with " + status + ": ") + cause + framesOf(err));
    } else {
      console.warn("[proxy] " + where + " refused with " + status + ": " + cause);
    }
  } catch (e) { /* a log line is not worth a second failure */ }
}

/**
 * What a handler may have put on the response before it failed that must not describe the error answer: its content
 * type, length, encoding, range, validators and a download's Content-Disposition (res.json would keep an existing
 * Content-Type, and a failed APK download would answer as an attachment). Headers other middleware set (CORS and so on) stay.
 */
const STALE_HEADERS = ["Content-Type", "Content-Length", "Content-Disposition", "Content-Encoding", "Content-Language", "Content-Range", "ETag", "Last-Modified", "Accept-Ranges"];

function clearStaleHeaders(res) {
  for (const name of STALE_HEADERS) {
    try { res.removeHeader(name); } catch (e) { /* not a response that can */ }
  }
}

/**
 * The answer (or part of it) is already out, so nothing can be added to it. Three cases:
 *   - it is finished: nothing to do (and the socket must be left alone, other requests may ride it);
 *   - it announced a Content-Length and has not sent that much: ending it would leave the client waiting for bytes
 *     that never come, so the connection is destroyed (what Express's own handler does), and the client hears at once;
 *   - otherwise (a chunked answer cut short): ending it gives the client a well-formed, short body.
 * An 'error' listener goes on first: a writer elsewhere that writes once more after this ends the response gets
 * ERR_STREAM_WRITE_AFTER_END on the response, and with nobody listening that would be an uncaught exception.
 */
function closeStarted(res) {
  try {
    if (res.listenerCount("error") === 0) res.on("error", noop);
    if (!res.writableEnded && res.hasHeader("content-length")) res.destroy();
    else res.end();
  } catch (e) {
    lastResort(res);
  }
}

/**
 * The last error middleware; server.js mounts it after every route (and the patch above also calls it for a handler
 * that rejects once its answer is out). Whatever reached it (a rejected handler through the patch above, a
 * synchronous throw, an error body-parser raised) is logged with its cause and answered:
 *   - a 4xx that an HTTP library attached keeps its status (any err.status or err.statusCode from 400 to 499: body-parser's
 *     400 and 413, Express's 400 for a bad percent-escape, a missing sendFile target's 404), with the standard reason as the text;
 *   - anything else, including a 5xx status on the error, is 500 {"error":"Proxy internal error"}: no stack, no message,
 *     nothing about the inside. err.headers and a status the handler had already set on the response are not used;
 *   - when the answer (or part of it) is already out, closeStarted decides how it ends.
 * The cause may be anything that was thrown (a Symbol, an object without a prototype): describeCause copes.
 */
function finalErrorHandler(err, req, res, next) {
  const status = statusOf(err);
  const late = answerIsOut(res);
  report(req, err, status, late);
  if (late) {
    closeStarted(res);
    return;
  }
  try {
    clearStaleHeaders(res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(status).json({ error: status === 500 ? "Proxy internal error" : http.STATUS_CODES[status] || "Bad Request" });
  } catch (e) {
    lastResort(res);
  }
}

/** Patch Express's Layer once. Returns true when it patched, false when it already had. */
function install() {
  const Layer = require("express/lib/router/layer");
  const proto = Layer.prototype;
  if (typeof proto.handle_request !== "function" || typeof proto.handle_error !== "function") {
    throw new Error("async-routes: this Express has no Layer.handle_request / handle_error; the patch is built for Express 4");
  }
  if (proto.handle_request[FLAG]) return false;
  handle[FLAG] = true;
  proto.handle_request = handle;
  proto.handle_error = handle_error;
  return true;
}

module.exports = { install, describeCause, asFailure, framesOf, finalErrorHandler };
