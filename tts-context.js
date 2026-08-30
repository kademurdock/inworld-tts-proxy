/* tts-context.js — Aug 30 2026 (Part 99): the speech-context budget, pure half.
 *
 * WHY THIS EXISTS, and it is a live defect not a precaution. Part 92.15 gave
 * every chunk the text of the pieces spoken before it
 * (synthesisContext.previousRequests), and 92.16 extended that ACROSS calls so
 * the app's one-sentence-per-request lane stopped resetting its intonation at
 * every boundary. Both capped the context by COUNT — three prior pieces,
 * KADE_TTS_CONTEXT_MAX — and neither capped it by LENGTH.
 *
 * Inworld caps it by length: `context.previous_requests total length should
 * not exceed 2000 characters`, and an over-budget request is answered with a
 * 400 that kills the WHOLE synthesis, not just the context. Three prior pieces
 * of ~700 characters each clears 2,000 easily, so the failure lands exactly on
 * the long, flowing replies the context feature was built to improve.
 *
 * THE RECEIPT: four of those 400s in the inworld-tts-proxy log at 23:23:28-30Z
 * on Aug 29 2026, and `chunksToday` reading 256 ok / 12 FAILED (4.5%) on a
 * platform whose normal failed count is zero. Part 98.3 measured that same
 * window and reported "0 failed, 0 retried" — the proxy's own counter and the
 * provider's 400 were never read side by side.
 *
 * THE SHAPE OF THE FIX, and why it drops instead of truncating: context is for
 * INTONATION, and the piece nearest in time is the one that shapes it. So the
 * budget is spent NEWEST FIRST and the OLDEST pieces fall off the back —
 * losing the sentence from three pieces ago costs almost nothing, while
 * losing the one immediately before costs the whole feature. Only when a
 * SINGLE newest piece is itself over budget does anything get cut mid-text,
 * and then it keeps its TAIL for the same reason.
 *
 * Budget defaults to 1,900 rather than 2,000: the provider's error names a
 * total but not what it counts, and a synthesis that dies costs more than a
 * hundred characters of context is worth. KADE_TTS_CONTEXT_MAX_CHARS overrides.
 */

const DEFAULT_BUDGET = 1900;

/* texts: prior spoken pieces, OLDEST FIRST, newest last (contextFor's order).
 * Returns the same order, trimmed to fit `budget` total characters. */
function fitContextBudget(texts, budget = DEFAULT_BUDGET) {
  const list = Array.isArray(texts) ? texts : [];
  const cap = Number(budget) > 0 ? Number(budget) : DEFAULT_BUDGET;
  const out = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = String(list[i] == null ? "" : list[i]);
    if (!t) continue;
    const room = cap - used;
    if (room <= 0) break;
    if (t.length <= room) {
      out.unshift(t);
      used += t.length;
      continue;
    }
    /* Only reachable for the NEWEST piece (nothing has been kept yet, so room
     * is the whole budget). Keep the tail — the words spoken immediately
     * before this chunk. An older piece that does not fit is dropped whole:
     * a fragment torn off the middle of a sentence from two pieces back is
     * noise, and noise is worse context than no context. */
    if (out.length === 0) {
      out.unshift(t.slice(-room));
      used += room;
    }
    break;
  }
  return out;
}

function totalChars(texts) {
  return (Array.isArray(texts) ? texts : []).reduce(
    (n, t) => n + String(t == null ? "" : t).length, 0);
}

module.exports = { fitContextBudget, totalChars, DEFAULT_BUDGET };
