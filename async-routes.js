"use strict";
/**
 * async-routes.js -- A REJECTED HANDLER ANSWERS ITS OWN REQUEST (Nov 7 2026)
 *
 * Express 4 never looks at what a route handler returns. An `async` handler that throws (a request body with a field
 * of the wrong type is enough: `{"branch":5}`, `{"input":{"toString":1}}`, a lone surrogate in a key) hands Express a
 * REJECTED PROMISE that nobody listens to, and Node ends the process on an unhandled rejection. Every listener's audio
 * stops and Railway restarts the service a few seconds later. An independent review on Nov 7 2026 found 25 such request
 * shapes on 8 routes (all behind a secret) and about 90 async handlers with no guard of their own; only the speech route
 * had one (guardAsync in server.js).
 *
 * This is the express-async-errors technique, done once on the Layer prototype that every Express 4 route and every
 * middleware passes through. When a handler returns something with a `then`, a rejection of it goes to next(err), exactly
 * as a synchronous throw always did, and from there to the error middleware that server.js mounts after the last route
 * (finalErrorHandler), which writes the answer. A promise that resolves is left alone, and so is everything a handler
 * returns that is not a thenable (`return res.json(...)` is common and stays exactly as it was).
 *
 * Why not one process-level unhandledRejection handler instead: without a guard on each route it turns the crash into a
 * request that is NEVER answered (the socket stays open as long as the caller does, and a 10 MB body stays in memory with
 * it: 19 such requests took the process from 84 MB to 567 MB), and it lets a failing boot look healthy. Here every
 * request is answered. (A net for the rejections that belong to no request is a separate, later step.)
 *
 * What goes to next(): next() with a falsy value means "carry on to the next route" and the strings "route" and "router"
 * are Express control flow, so a handler that FAILS with `undefined`, `0`, "route" and so on must not be taken for a
 * success: those become an Error that says what happened. Every other thrown or rejected value is passed on untouched
 * (a Symbol, an object without a prototype), so the error middleware must be able to print anything.
 *
 * It is built for Express 4 (pnpm-lock.yaml pins 4.22.3). Express 5 handles rejected promises itself and has no
 * express/lib/router/layer: this file then stops the boot, loudly, and should be deleted.
 */

const FLAG = Symbol.for("inworld-tts-proxy.async-routes");
const CLIP = 300;

function clip(s) {
  return s.length > CLIP ? s.slice(0, CLIP) + "..." : s;
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

/**
 * If a handler returned a thenable, send its rejection to next(). Nothing here may throw or reject: an error thrown
 * inside a promise reaction would itself be an unhandled rejection, which is the very crash this file exists to stop.
 */
function follow(returned, res, next) {
  let then;
  try {
    then = returned === null || returned === undefined ? undefined : returned.then;
  } catch (e) {
    return; // a `then` that throws when read is not a promise anyone can follow
  }
  if (typeof then !== "function") return;
  const rejected = (reason) => {
    try {
      next(asFailure(reason));
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
  follow(returned, res, next);
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
  follow(returned, res, next);
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

module.exports = { install, describeCause, asFailure };
