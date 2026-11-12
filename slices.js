"use strict";
/**
 * slices.js -- LONG AUDIO PASSES GIVE THE LOOP BACK (GW-13, Nov 12 2026)
 *
 * The output stage walks every sample of a reply about ten times (three tone
 * bands, two shelves, the level windows, the peak scan, the budget scans, the
 * limiter). On a phone sentence that is a fraction of a millisecond. On an
 * hour-long read-aloud it was seconds in one piece, and for those seconds no
 * other request on this process moved: every call's speech and every relayed
 * token waited behind one listener's article.
 *
 * inSlices runs step(from, to) over [0, total) a few seconds of audio at a
 * time and lets the event loop take a turn between slices. A clip shorter
 * than one slice never yields at all, so short clips (every call sentence)
 * run in one piece exactly as before. The arithmetic is the caller's own
 * range function, the same one the one-piece path runs over the whole clip,
 * so the samples that come out are the same bytes either way.
 */
const SLICE_SECONDS = 4;

/** Samples per slice: about SLICE_SECONDS of audio, a multiple of 4 (the budget scan strides by 4). */
function sliceSamplesFor(sampleRate) {
  return Math.max(4, Math.round(sampleRate * SLICE_SECONDS) & ~3);
}

const breathe = () => new Promise((resolve) => setImmediate(resolve));

async function inSlices(total, sliceSamples, step) {
  for (let from = 0; from < total; from += sliceSamples) {
    const to = Math.min(total, from + sliceSamples);
    step(from, to);
    if (to < total) await breathe();
  }
}

module.exports = { inSlices, sliceSamplesFor, breathe, SLICE_SECONDS };
