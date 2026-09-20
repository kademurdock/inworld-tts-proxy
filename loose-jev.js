'use strict';
/* loose-jev.js — Part 236 (Sep 20 2026). A second opinion for the loose
 * "(span)" and "*span*" stage directions the word list in server.js does not
 * recognise.
 *
 * WHY: the Aug 19 rescue is vocabulary-gated on purpose (a false positive eats
 * real speech), and the price of that gate was paid on Aug 20 when "(slightly
 * amused)" was spoken aloud because the phrase was in no list. The list grew,
 * but a list only ever knows yesterday's phrases: "(quietly furious)", "(mock
 * offended)", "*adjusts glasses*" are all still read out as words today. And
 * the words the list deliberately refuses (warm, dry, soft, quiet, flat, cold,
 * low) are refused because a list cannot see the sentence. Jev can: measured
 * this date on 66 labelled spans, "serve it (warm) with butter" came back
 * spoken at 0.90+ and "(warm) Oh honey, come here" came back delivery at 0.97+.
 *
 * THE ORDER NEVER CHANGES: the word list judges first, exactly as before, and
 * anything it recognises never reaches Jev. Jev is asked only about the spans
 * the list said "not a direction" to, which today are ALL spoken aloud. So the
 * worst a wrong or missing Jev answer can do is leave a span spoken, which is
 * today's behaviour, EXCEPT a wrong lift, which eats words. The gate below is
 * set against that one harm.
 *
 * THE GATE (trial, jev_loose_trial.js in the session scratchpad, 66 spans, 40
 * of them traps that must stay spoken): Jev's label must be a direction AND
 * its probability for "spoken" must be at or under 0.15. At that gate the
 * trial lifted 26 of 26 real directions and ate 0 of 40 spoken spans; the two
 * spans Jev got wrong ("(pause the video here)", "(out loud)") sat at 0.45 and
 * stay spoken. `confidence` is NOT the gate: it measures the spread across all
 * five labels, so "*winces*" split between delivery and physical reads 0.61
 * while its chance of being spoken words is 0.01.
 *
 * COST: one request per TTS call that has at least one unrecognised candidate
 * span, 160-410 ms measured, hard cap 600 ms, and it lands BEFORE first audio.
 * Most calls have no candidate and pay nothing; repeats are served from the
 * LRU below and pay nothing. On timeout or any failure: spoken, as today.
 * Kill: KADE_JEV_LOOSE=0, KADE_JEV=0, or unset TYPESAFE_API_KEY. */

const GATE_P_SPOKEN = 0.15;
const TIMEOUT_MS = 600;
const MAX_SPANS = 8;       // per TTS call; spans past this are spoken, as today
const CACHE_MAX = 500;
const LINE_MAX = 300;

/* Same two shapes rescueLooseDirections uses, so the pre-pass and the rescue
 * agree on what a span IS. */
const PAREN_RE = /\(([^()\n]{1,60})\)/g;
const STAR_RE = /(^|[^*\w])\*([^*\n]{1,60})\*(?!\*)/g;

/* Cheap pre-filters: what is never worth a network call. Each one names a
 * shape that is speech on its face. Jev is weak at numbers anyway. */
function isCandidate(inner, isStar) {
  const t = String(inner || '').trim();
  if (t.length < 3 || t.length > 60) return false;
  if (/\d/.test(t)) return false;                      // measurements, years, phone numbers
  if (!/^[A-Za-z]/.test(t)) return false;              // must open on a letter
  if (/[%\[\]{}<>@\/\\=_#|]/.test(t)) return false;    // tags, urls, code, a malformed %%% tag
  if (/[:;?!]$/.test(t)) return false;                 // "*Script:*" labels, asides that are questions
  if (t === t.toUpperCase()) return false;             // RSVP, ASAP, AKA
  const words = t.split(/\s+/);
  if (words.length > 6) return false;                  // a whole clause is an aside, not a direction
  /* A single *word* is markdown emphasis three times in four (the Aug 20
   * corpus count in server.js) and emphasisFromMarkdown owns those. Only a
   * verb-shaped one ("*winces*", "*fidgeting*") is worth asking about. */
  if (isStar && words.length === 1 && !/(?:s|ing)$/i.test(t)) return false;
  return true;
}

/* The line around a span, markers included, because the line is what decides
 * "(warm)". A very long line is cut to a window around the span. */
function lineAround(text, start, end) {
  let a = text.lastIndexOf('\n', start - 1) + 1;
  let b = text.indexOf('\n', end);
  if (b < 0) b = text.length;
  if (b - a > LINE_MAX) {
    a = Math.max(a, start - LINE_MAX / 2);
    b = Math.min(b, end + LINE_MAX / 2);
    while (a > 0 && a < start && /\S/.test(text[a - 1])) a++;   // do not open mid-word
    while (b < text.length && b > end && /\S/.test(text[b])) b--;
  }
  return text.slice(a, b).trim();
}

const keyOf = (inner) => String(inner || '').trim().toLowerCase();

/* Every span the word list does NOT recognise and the pre-filters let by.
 * looksLikeDirection is server.js's own function, passed in, never copied. */
function scanUnknownSpans(text, looksLikeDirection) {
  const out = [];
  const seen = new Set();
  /* Words that appear somewhere in this message in a shape we refuse to ask
   * about ("*real*" as emphasis). A verdict earned by the same words in
   * another shape ("(real)") must never reach them, so the words are blocked
   * for the whole message: spoken, as today. */
  const blocked = new Set();
  const take = (inner, start, end, isStar) => {
    if (looksLikeDirection(inner)) return;              // the word list owns it, as before
    if (!isCandidate(inner, isStar)) { blocked.add(keyOf(inner)); return; }
    const span = String(inner).trim();
    const line = lineAround(text, start, end);
    const id = keyOf(span) + ' | ' + line;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ span, line, id });
  };
  let m;
  PAREN_RE.lastIndex = 0;
  while ((m = PAREN_RE.exec(text))) take(m[1], m.index, m.index + m[0].length, false);
  STAR_RE.lastIndex = 0;
  while ((m = STAR_RE.exec(text))) take(m[2], m.index + m[1].length, m.index + m[0].length, true);
  /* Past MAX_SPANS nothing is judged, so those words are blocked too. */
  for (const s of out.slice(MAX_SPANS)) blocked.add(keyOf(s.span));
  return { spans: out.slice(0, MAX_SPANS), blocked };
}
function findUnknownSpans(text, looksLikeDirection) {
  return scanUnknownSpans(text, looksLikeDirection).spans;
}

/* opts.looksLikeDirection  server.js's word-list judge (required)
 * opts.jev                 { enabled(flag), looseDirections(items, ms) }; injected so tests never touch the network
 * Returns resolve(text) -> Promise<Map(lowercased span -> label) | null>.
 * resolve NEVER throws and NEVER takes longer than timeoutMs. null and an
 * empty Map both mean "do exactly what you did before". */
function createLooseResolver(opts) {
  const { looksLikeDirection, jev } = opts;
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  const gate = typeof opts.gate === 'number' ? opts.gate : GATE_P_SPOKEN;
  const log = opts.log || (() => {});
  const cache = new Map();                              // id -> label ('spoken' included); Map order is the LRU
  const remember = (id, label) => {
    cache.delete(id);
    cache.set(id, label);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  };

  async function resolve(text) {
    try {
      if (!jev || !jev.enabled('KADE_JEV_LOOSE')) return null;
      if (typeof text !== 'string' || (text.indexOf('(') < 0 && text.indexOf('*') < 0)) return null;
      const { spans, blocked } = scanUnknownSpans(text, looksLikeDirection);
      if (!spans.length) return null;

      const labels = new Map();                         // id -> label
      const need = [];
      for (const s of spans) {
        if (cache.has(s.id)) { const v = cache.get(s.id); remember(s.id, v); labels.set(s.id, v); }
        else need.push(s);
      }
      if (need.length) {
        const t0 = Date.now();
        let timer;
        const cap = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs); });
        let answers;
        try {
          answers = await Promise.race([jev.looseDirections(need.map(({ span, line }) => ({ span, line })), timeoutMs), cap]);
        } finally { clearTimeout(timer); }
        if (!Array.isArray(answers) || answers.length !== need.length) throw new Error('bad loose answer');
        need.forEach((s, i) => {
          const a = answers[i] || {};
          const pSpoken = a.probabilities && typeof a.probabilities.spoken === 'number' ? a.probabilities.spoken : 1;
          const lift = a.label && a.label !== 'spoken' && pSpoken <= gate;
          const label = lift ? a.label : 'spoken';
          remember(s.id, label);
          labels.set(s.id, label);
          log(`[TTS][jev] loose (${s.span}) -> ${a.label} pSpoken=${pSpoken.toFixed(2)} ${lift ? 'LIFTED' : 'spoken as before'}`);
        });
        log(`[TTS][jev] loose: ${need.length} asked, ${spans.length - need.length} cached, ${Date.now() - t0}ms`);
      }

      /* The rescue looks a verdict up by the span's own words. If the same
       * words appear twice in one message and the two lines disagree ("(warm)"
       * as a direction AND in a recipe), neither is lifted: spoken, as today. */
      const bySpan = new Map();
      for (const s of spans) {
        const k = keyOf(s.span);
        const label = labels.get(s.id);
        if (!bySpan.has(k)) bySpan.set(k, label);
        else if (bySpan.get(k) !== label) bySpan.set(k, 'spoken');
      }
      const verdicts = new Map();
      for (const [k, label] of bySpan) if (label !== 'spoken' && !blocked.has(k)) verdicts.set(k, label);
      return verdicts;
    } catch (e) {
      log(`[TTS][jev] loose skipped (${e.message}); spans spoken as before`);
      return null;
    }
  }

  return { resolve, cache };
}

module.exports = { createLooseResolver, findUnknownSpans, isCandidate, lineAround, keyOf, GATE_P_SPOKEN, TIMEOUT_MS, MAX_SPANS };
