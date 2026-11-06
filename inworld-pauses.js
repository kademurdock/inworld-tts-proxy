'use strict';
/* Nov 5 2026 — INWORLD PAUSE LIMITER. Kade: "my inworld voices ... keep pausing and putting emphasis
 * on weird words and slowing down and speeding up. They need to sound like they're talking to a person
 * on the phone or face to face casually ... not like they're stopping to read stuff on paper every so
 * often." Fish has had a cap on silences inside a clip since Oct 17 (pace.js capFishPauses, her rule:
 * "between .3 and .5 seconds at most"); Inworld had nothing.
 *
 * What the audio showed (24 production-shaped messages through the real server, then 20 sentences x 4
 * voices with the character's own one-word direction against none, Praat intensity + Deepgram word
 * times): a direction or a brief makes Inworld stop longer, not just talk slower. Quiet runs inside a
 * clip (10 ms windows under -50 dBFS): no direction on BALANCED, median 330 ms and p90 593 ms; the
 * character's own direction on CREATIVE, median 495 ms, p90 870 ms, longest 1,390 ms. A stop of 600 ms
 * or more came every 20 words or so (4.1 per 100 words against 1.0 with no direction).
 *
 * So long silences are brought in the way a person's are: whole up to KNEE_MS, thinned at SLOPE beyond
 * it, never longer than MAX_MS. Stops therefore keep their order (a sentence end still outlasts a
 * comma) and their shape, they just stop being silences. Speech windows pass through untouched, so no
 * word is ever shortened, and 'silent' is an absolute level far under any breath, so a breath or a
 * word's tail is kept. There is no lookahead: each window is judged from what has already played, so
 * the same logic runs on a stream (the iPhone's lane) and on a whole clip (the website and Android).
 *
 * Chat speech only (server.js decides): never reading, STABLE, books, previews of book scenes.
 * INWORLD_PAUSE_CAP=1 turns it on; anything else leaves the audio exactly as Inworld sent it.
 * INWORLD_PAUSE_KNEE_MS, INWORLD_PAUSE_SLOPE, INWORLD_PAUSE_MAX_MS and INWORLD_PAUSE_THRESHOLD_DB
 * change the shape without a deploy. */

const WIN_MS = 10;

function env(name, fallback, source) {
  const v = Number(source[name]);
  return source[name] !== undefined && source[name] !== '' && Number.isFinite(v) ? v : fallback;
}

function pauseSettings(source = process.env) {
  const kneeMs = Math.max(0, env('INWORLD_PAUSE_KNEE_MS', 350, source));
  return {
    on: source.INWORLD_PAUSE_CAP === '1',
    kneeMs,
    slope: Math.min(1, Math.max(0, env('INWORLD_PAUSE_SLOPE', 0.5, source))),
    maxMs: Math.max(kneeMs, env('INWORLD_PAUSE_MAX_MS', 500, source)),
    thresholdDb: env('INWORLD_PAUSE_THRESHOLD_DB', -50, source),
  };
}

/** Streaming limiter over 16-bit little-endian mono PCM. push() takes any byte count and returns the
 *  bytes to play; flush() returns the last partial window (under 10 ms) untouched. */
function createPauseLimiter({ sampleRate = 24000, kneeMs = 350, slope = 0.5, maxMs = 500, thresholdDb = -50 } = {}) {
  const win = Math.max(1, Math.round((sampleRate * WIN_MS) / 1000));
  const winBytes = win * 2;
  const limit = Math.pow(32768 * Math.pow(10, thresholdDb / 20), 2); // compared with the window's mean square
  const target = (runMs) => (runMs <= kneeMs ? runMs : Math.min(maxMs, kneeMs + (runMs - kneeMs) * slope));
  const fadeSamples = Math.min(win, Math.max(8, Math.round(sampleRate * 0.003))); // 3 ms
  let carry = Buffer.alloc(0);
  let run = 0; // ms of silence seen in the current silent run
  let kept = 0; // ms of that run already let through
  const stats = { silentMs: 0, droppedMs: 0, runsShortened: 0, longestRunMs: 0 };
  let shortened = false;
  // A kept silent window waits one window to learn whether a cut follows it (then its tail fades out),
  // and the first silent window kept after a cut fades in: a join never steps. Speech is never faded.
  let held = null;
  let afterCut = false;

  const faded = (windowBuf, inward) => {
    const copy = Buffer.from(windowBuf);
    for (let i = 0; i < fadeSamples; i++) {
      const g = (i + 1) / (fadeSamples + 1);
      const at = (inward ? i : win - fadeSamples + i) * 2;
      copy.writeInt16LE(Math.round(copy.readInt16LE(at) * (inward ? g : 1 - g)), at);
    }
    return copy;
  };

  function push(bytes) {
    const data = carry.length ? Buffer.concat([carry, bytes]) : Buffer.from(bytes);
    const windows = Math.floor(data.length / winBytes);
    const out = [];
    for (let w = 0; w < windows; w++) {
      const at = w * winBytes;
      const piece = data.subarray(at, at + winBytes);
      let sum = 0;
      for (let i = 0; i < win; i++) {
        const v = data.readInt16LE(at + i * 2);
        sum += v * v;
      }
      if (sum / win < limit) {
        run += WIN_MS;
        stats.silentMs += WIN_MS;
        if (run > stats.longestRunMs) stats.longestRunMs = run;
        if (kept + WIN_MS <= target(run) + 1e-9) {
          if (held) out.push(held);
          held = afterCut ? faded(piece, true) : Buffer.from(piece);
          afterCut = false;
          kept += WIN_MS;
        } else {
          if (held) { out.push(faded(held, false)); held = null; }
          afterCut = true;
          stats.droppedMs += WIN_MS;
          if (!shortened) { shortened = true; stats.runsShortened++; }
        }
      } else {
        if (held) { out.push(held); held = null; }
        afterCut = false;
        run = 0;
        kept = 0;
        shortened = false;
        out.push(piece);
      }
    }
    carry = Buffer.from(data.subarray(windows * winBytes));
    return out.length ? Buffer.concat(out) : Buffer.alloc(0);
  }

  function flush() {
    const rest = held ? Buffer.concat([held, carry]) : carry;
    held = null;
    carry = Buffer.alloc(0);
    return rest;
  }

  return { push, flush, stats, get windowBytes() { return winBytes; } };
}

/** A whole clip's PCM bytes in, the limited PCM bytes out (same limiter, one push). */
function limitPauses(pcm, sampleRate, settings = pauseSettings()) {
  if (!pcm || pcm.length < 4) return { pcm, stats: null };
  const lim = createPauseLimiter({ sampleRate, kneeMs: settings.kneeMs, slope: settings.slope, maxMs: settings.maxMs, thresholdDb: settings.thresholdDb });
  const body = lim.push(pcm);
  const tail = lim.flush();
  return { pcm: tail.length ? Buffer.concat([body, tail]) : body, stats: lim.stats };
}

module.exports = { pauseSettings, createPauseLimiter, limitPauses, WIN_MS };
