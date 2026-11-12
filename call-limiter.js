"use strict";
/**
 * call-limiter.js — the cap on simultaneous calls to a provider (moved out of server.js on Nov 8 2026 so it can be tested).
 *
 * createLimiter(n) returns limit(fn, opts): fn runs when fewer than n calls are running, calls start in the order they were asked, and
 * limit() answers with whatever fn answered. server.js has one for Inworld (6) and one for Fish (FISH_MAX_CONCURRENT, 6): without the cap
 * a burst of requests collides on the provider's own rate limit.
 *
 * Nov 8 2026 (route-guard review of Nov 7): whatever fn does is the caller's answer, the slot always comes back, and the chain ends in a
 * catch.
 *
 * Nov 12 2026 (gateway audit GW-9): a live call goes first, and a request nobody is waiting for gives its place up.
 *   opts.live    someone is on the line (a phone or app call). It starts ahead of every queued call that is not live; calls already
 *                running are never cut. reserve (createLimiter's second argument) keeps that many slots free of non-live work, so a
 *                200-chunk read-aloud fills at most n - reserve slots and a call's sentence never waits behind all of it.
 *   opts.signal  an AbortSignal for the request (the client hung up, barged in, or stopped). A queued call whose signal has fired is
 *                dropped with an AbortError (isAbandoned) before it costs a provider call; one already running is left to its own signal.
 * With no opts every caller gets exactly the old first-in, first-out behaviour. TTS_LIVE_FIRST=0 turns the live lane AND the reserve
 * off (all n slots are back for everyone). A reserve that is not a whole number of 0 or more counts as 0, and a limit that is not a
 * number is no limit, as before: a typo in a variable must never leave a queue that nothing leaves.
 */
function abortError() {
  const e = new Error("the request was abandoned before its turn");
  e.name = "AbortError";
  e.isAbandoned = true;
  return e;
}

function createLimiter(maxConcurrent, reserve = 0) {
  const max = Number.isFinite(maxConcurrent) ? Math.max(1, Math.floor(maxConcurrent)) : Infinity;
  const held = Number.isFinite(reserve) && reserve > 0 ? Math.floor(reserve) : 0;
  const liveFirst = () => process.env.TTS_LIVE_FIRST !== "0";
  const restCap = () => (liveFirst() ? Math.max(1, max - held) : max);
  let active = 0;
  let activeRest = 0;
  const live = [];
  const rest = [];

  function unhook(job) {
    if (job.signal && job.onAbort) job.signal.removeEventListener("abort", job.onAbort);
    job.onAbort = null;
  }

  function take() {
    if (live.length) return live.shift();
    if (rest.length && activeRest < restCap()) return rest.shift();
    return null;
  }

  function next() {
    while (active < max) {
      const job = take();
      if (!job) return;
      unhook(job);
      if (job.signal && job.signal.aborted) { // cannot happen while the listener is on; kept so a queue spot is never paid for by mistake
        job.reject(abortError());
        continue;
      }
      active++;
      if (!job.live) activeRest++;
      let running;
      try {
        running = Promise.resolve(job.fn());
      } catch (e) {
        running = Promise.reject(e);
      }
      running
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          if (!job.live) activeRest--;
          next();
        })
        .catch(() => {}); // nothing in the chain can throw now; this is the end of it, so that nothing ever can be unhandled
    }
  }

  return function limit(fn, opts) {
    return new Promise((resolve, reject) => {
      const signal = opts && opts.signal ? opts.signal : null;
      const job = { fn, resolve, reject, live: Boolean(opts && opts.live === true) && liveFirst(), signal, onAbort: null };
      if (signal) {
        if (signal.aborted) { reject(abortError()); return; }
        // Give the queue spot back the moment nobody is waiting. The listener comes off when the call starts (unhook).
        job.onAbort = () => {
          const q = job.live ? live : rest;
          const i = q.indexOf(job);
          if (i >= 0) q.splice(i, 1);
          job.onAbort = null;
          if (i >= 0) reject(abortError());
        };
        signal.addEventListener("abort", job.onAbort, { once: true });
      }
      (job.live ? live : rest).push(job);
      next();
    });
  };
}

module.exports = { createLimiter };
