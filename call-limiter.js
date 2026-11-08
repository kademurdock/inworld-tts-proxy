"use strict";
/**
 * call-limiter.js — the cap on simultaneous calls to a provider (moved out of server.js on Nov 8 2026 so it can be tested).
 *
 * createLimiter(n) returns limit(fn): fn runs when fewer than n calls are running, calls start in the order they were asked, and
 * limit() answers with whatever fn answered. server.js has one for Inworld (6) and one for Fish (FISH_MAX_CONCURRENT, 6): without the cap
 * a burst of requests collides on the provider's own rate limit.
 *
 * Nov 8 2026 (route-guard review of Nov 7): the chain `fn().then(resolve, reject).finally(...)` had no end of its own and assumed fn
 * returns a promise. A function that threw before returning one left its slot taken for good (when it was first in line) or, when
 * it was started from inside the `.finally`, made that promise reject with nobody listening (an unhandled rejection), left its caller
 * waiting forever and lost the slot. It was unreachable only because every caller passes an async function. Now whatever fn does is
 * the caller's answer, the slot always comes back, and the chain ends in a catch.
 */
function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    let running;
    try {
      running = Promise.resolve(fn());
    } catch (e) {
      running = Promise.reject(e);
    }
    running
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      })
      .catch(() => {}); // nothing in the chain can throw now; this is the end of it, so that nothing ever can be unhandled
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

module.exports = { createLimiter };
