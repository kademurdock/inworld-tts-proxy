"use strict";
/**
 * rejection-net.js -- THE LAST NET (Nov 7 2026)
 *
 * async-routes.js makes every route answer its own failure, so a promise that is rejected with nobody listening is, by now,
 * one that belongs to no request: a timer, a background job, code added later. Node ends the process on it. Railway restarts
 * the service at most three times (railway.toml: restartPolicyMaxRetries 3) and then leaves it down. This net logs such a
 * rejection and lets the proxy go on, under three rules that keep it honest (the first try at a net, branch
 * claude/proxy-residuals-first-try, had neither of the first two and was rejected for it):
 *
 *   1. STARTING UP IS FATAL. In the first 30 seconds of the process (module load, the first listens) a rejection ends the
 *      process, as before: a deploy that cannot start must fail its health check, not look healthy.
 *   2. IT IS COUNTED AND SHOWN. /health carries unhandledRejections { total, recent, windowSeconds }, and every rejection
 *      logs one [proc] line with its cause and five stack frames.
 *   3. A STORM ENDS THE PROCESS. More than 20 in a minute and the process ends (exit 1), so a bug that keeps firing still
 *      looks like a crash to Railway and to whoever watches.
 *
 * What it does not do: it does not answer a request. A rejection that belongs to a request would leave that request open
 * (and its body in memory). Nothing in the proxy does that today (async-routes.js covers every handler; the one async event
 * callback, the transcription route's, answers before it can reject), and new code should follow that pattern instead of
 * leaning on this net. It is not an uncaughtException handler either: after one of those nothing says what state the
 * process is in.
 */
const { describeCause, framesOf } = require("./async-routes");

const DEFAULTS = { graceMs: 30000, windowMs: 60000, limit: 20 };
const SLOT = Symbol.for("inworld-tts-proxy.rejection-net");

/**
 * The net itself, with everything it touches passed in so it can be tested: uptimeMs() (milliseconds since the process
 * started), now() (a clock), exit(code) and log(line). onRejection(reason) is what 'unhandledRejection' calls.
 */
function createRejectionNet(options = {}) {
  const graceMs = options.graceMs === undefined ? DEFAULTS.graceMs : options.graceMs;
  const windowMs = options.windowMs === undefined ? DEFAULTS.windowMs : options.windowMs;
  const limit = options.limit === undefined ? DEFAULTS.limit : options.limit;
  const uptimeMs = options.uptimeMs || (() => process.uptime() * 1000);
  const now = options.now || Date.now;
  const exit = options.exit || ((code) => process.exit(code));
  const log = options.log || ((line) => console.error(line));
  const seconds = windowMs / 1000;
  let total = 0;
  let times = [];

  function recentCount(t) {
    times = times.filter((x) => t - x < windowMs);
    return times.length;
  }

  function say(line) {
    try { log(line); } catch (e) { /* a log line is not worth a second failure */ }
  }

  function onRejection(reason) {
    try {
      total += 1;
      const t = now();
      times.push(t);
      const recent = recentCount(t);
      const what = describeCause(reason) + framesOf(reason);
      if (uptimeMs() < graceMs) {
        say("[proc] unhandled rejection while starting up, ending the process so the deploy fails its health check: " + what);
        exit(1);
        return;
      }
      if (recent > limit) {
        say("[proc] " + recent + " unhandled rejections in the last " + seconds + " seconds, ending the process so the platform restarts it; the last one: " + what);
        exit(1);
        return;
      }
      say("[proc] unhandled rejection #" + total + " (" + recent + " in the last " + seconds + " seconds): it belongs to no request and the proxy stays up: " + what);
    } catch (e) {
      say("[proc] the rejection net failed while handling a rejection");
    }
  }

  function stats() {
    return { total, recent: recentCount(now()), windowSeconds: seconds };
  }

  return { onRejection, stats };
}

function numberFrom(value, fallback, min) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Put the net on the process, once (a second call returns the first one). PROXY_BOOT_GRACE_MS, PROXY_REJECTION_WINDOW_MS
 * and PROXY_REJECTION_LIMIT change the three numbers; they exist for the tests and are not set on Railway.
 */
function install(env = process.env) {
  if (process[SLOT]) return process[SLOT];
  const net = createRejectionNet({
    graceMs: numberFrom(env.PROXY_BOOT_GRACE_MS, DEFAULTS.graceMs, 0),
    windowMs: numberFrom(env.PROXY_REJECTION_WINDOW_MS, DEFAULTS.windowMs, 1),
    limit: numberFrom(env.PROXY_REJECTION_LIMIT, DEFAULTS.limit, 1),
  });
  process.on("unhandledRejection", net.onRejection);
  process[SLOT] = net;
  return net;
}

module.exports = { createRejectionNet, install, DEFAULTS };
