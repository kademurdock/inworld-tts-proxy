'use strict';

const { isDirectionTag } = require('./sounds');

/* Oct 16 2026, Kade: Fish "still talking slow regardless" of Brisk and Fast, and Fish's
 * numeric prosody.speed "starts sounding robotic like when you change the formant", so it
 * stays at 1.0 (it is a time-stretch; Inworld renders its rate natively and sounds fine).
 * Measured on Drama3 (three voices, 51 words, two takes, words per minute against today's
 * Natural): the old Brisk/Quick sentences did 0 to +8%; a "25 percent faster" instruction
 * barely moved; the per-sentence [short pause] tags and Fish's own long gaps are most of
 * the slowness on slow voices. Brisk and Quick therefore (1) use wording that measured
 * faster, (2) skip the added sentence pauses, and (3) shorten any silence inside the clip
 * to a cap. The words themselves are never sped up: Brisk averaged about +11% (+19% on the
 * slowest voice) and Quick about +19% (+25%). */
const FISH_PACES = [
  { value: 0.75, name: 'Unhurried', direction: 'Speak unhurriedly, with relaxed phrasing and clear words.' },
  { value: 0.9, name: 'Easygoing', direction: 'Speak at an easygoing conversational pace, with natural expressive phrasing.' },
  { value: 1, name: 'Natural', direction: '' },
  { value: 1.2, name: 'Brisk', direction: 'speaking quickly, letting the sentences flow together with short pauses', sentencePauses: false, pauseCapMs: 300 },
  { value: 1.5, name: 'Quick', direction: 'fast-talking, rapid delivery with almost no pauses', sentencePauses: false, pauseCapMs: 200 },
];

function fishPace(rate) {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  return FISH_PACES.reduce((best, pace) => Math.abs(pace.value - value) < Math.abs(best.value - value) ? pace : best);
}

/* Oct 16 2026, a friend of Kade's: Fish voices "sound like they're reading a script", Inworld
 * voices like someone "talking naturally to whoever's on the other end of the phone". Drama3
 * takes a voice-actor brief in brackets, including who the character is talking to, and Fish
 * never got one, so untagged text rides each cloned reference's own habitual read. Inworld
 * gets an instruction field; this is Fish's equivalent. FISH_DEFAULT_DIRECTION holds the
 * brief (empty = off). It goes only on chat speech (the caller passes talk: true) and only
 * when the request does not already open with the character's own direction. */
function fishTalkDirection() {
  return String(process.env.FISH_DEFAULT_DIRECTION || '').replace(/[\[\]]/g, '').trim();
}

/* Oct 16 2026, Kade: "add the filler words for sure. But make little filler words like uh and
 * whatnot, not show up in the text output." Spoken only: this rewrites the words sent to Fish,
 * never the reply anyone reads (the proxy returns audio and nothing else). In the blind paired
 * test, the brief plus a filler or two beat today's delivery 26 to 3 (the brief alone 18 to 7).
 * At most one filler per request (one paragraph), at the start of a sentence that is not the
 * request's first, picked from the text itself so a replay sounds the same. Lists, sentences
 * that already open with a discourse word, and anything inside brackets are left alone.
 * FISH_TALK_FILLERS=1 turns it on, for chat speech only, like the brief. */
const FILLERS = {
  question: ['So,', 'So, um,', 'Um,'],
  statement: ['I mean,', 'Um,', 'Uh,', 'Well,', 'You know,'],
};
const OPENS_WITH_DISCOURSE = /^(?:oh|ah|well|so|anyway|but|and|or|okay|ok|yeah|yep|yes|no|nope|um+|uh+|hmm+|wait|honestly|actually|like|also|plus|because|then|hey|hi|hello|i mean|you know|right|sure)\b/i;
const NOT_A_SENTENCE_END = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|[A-Z]|\d+)$/i;

function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// One number per reply, so the paragraphs of one reply take turns through the filler list
// instead of each picking on its own (a three-paragraph test said "I mean" twice).
function fishTalkSeed(text) {
  return Math.floor(seeded(String(text))() * 1e6);
}

// turn: the paragraph's place in its reply; seed: fishTalkSeed of the whole reply.
function fishTalkFillers(text, { turn = 0, seed } = {}) {
  const src = String(text);
  if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(src)) return src;
  const tags = [];
  // Bracket cues may sit between sentences; a paired <scope> tag means the next words are
  // scoped, so a sentence that opens with one is not a filler spot.
  const masked = src.replace(/\[[^\]]*\]|<[^>]*>/g, tag =>
    (tag[0] === '[' ? '' : '') + (tags.push(tag) - 1) + (tag[0] === '[' ? '' : ''));
  const words = masked.replace(/[]\d+[]/g, ' ').split(/\s+/).filter(Boolean).length;
  const rng = seeded(src);
  if (words < 12 && rng() < 0.5) return src;
  // A sentence start: end punctuation, space, any tags (e.g. the added [short pause]), a word.
  const starts = [];
  const re = /([.!?]["'”’)]*)([ \t]+(?:\d+[ \t]*)*)(?=([A-Z][^\s]*))/g;
  for (let m; (m = re.exec(masked));) {
    const before = masked.slice(0, m.index);
    if (/\.$/.test(before) || NOT_A_SENTENCE_END.test(before)) continue;
    const at = m.index + m[0].length;
    const rest = masked.slice(at);
    const sentence = rest.split(/(?<=[.!?])\s/)[0];
    if (OPENS_WITH_DISCOURSE.test(rest) || sentence.split(/\s+/).length < 4) continue;
    starts.push({ at, question: /\?["'”’)]*$/.test(sentence.trim()) });
  }
  if (!starts.length) return src;
  const pick = starts[Math.floor(rng() * starts.length)];
  const list = pick.question ? FILLERS.question : FILLERS.statement;
  const base = Number.isInteger(seed) ? seed : Math.floor(rng() * 1e6);
  const filler = list[(base + turn) % list.length];
  const rest = masked.slice(pick.at).replace(/^([A-Z])([a-z'’]*\b)/, (w, first, tail) =>
    /^I(?:['’](?:m|ll|ve|d))?$/.test(w) ? w : first.toLowerCase() + tail);
  return (masked.slice(0, pick.at) + filler + ' ' + rest).replace(/[](\d+)[]/g, (_, i) => tags[Number(i)]);
}

// Runs at the provider boundary, after author-tempo cleanup and chunk shaping.
// This changes the actor's instruction, never the audio's playback rate.
function fishPacedText(text, rate, { talk = false } = {}) {
  const { direction } = fishPace(rate);
  const opening = String(text).match(/^\s*\[([^\]\n]+)\]/);
  const ownDirection = Boolean(opening && isDirectionTag(opening[1]));
  const casual = talk && !ownDirection ? fishTalkDirection() : '';
  const spoken = talk && process.env.FISH_TALK_FILLERS === '1' ? fishTalkFillers(text, typeof talk === 'object' ? talk : {}) : text;
  const briefs = [direction, casual].filter(Boolean);
  return briefs.length ? `${briefs.map(d => `[${d}]`).join(' ')} ${spoken}` : spoken;
}

// Whether the proxy adds its [short pause] after sentences for this pace.
// FISH_SENTENCE_PAUSES=0 turns the added pause off at every pace.
function fishSentencePauses(rate) {
  if (process.env.FISH_SENTENCE_PAUSES === '0') return false;
  return fishPace(rate).sentencePauses !== false;
}

/* Shorten silences INSIDE a Fish clip (16-bit mono PCM) to the pace's cap. Speech is
 * never touched: a 10 ms window counts as silence below 4% of the clip's loud level, the
 * first and last half-cap of each long silent run are kept (word tails and breaths in),
 * the middle is dropped, and 5 ms fades meet at the join. Leading and trailing silence
 * stay as they are. Returns the same buffer when there is nothing to do. */
function capFishPauses(pcm, rate, sampleRate = 24000) {
  // FISH_NATURAL_PAUSE_CAP_MS (empty = off) gives Natural a cap too; slower paces keep their gaps.
  const pace = fishPace(rate);
  const cap = pace.pauseCapMs || (pace.value === 1 ? Number(process.env.FISH_NATURAL_PAUSE_CAP_MS) || 0 : 0);
  if (!cap || !pcm || pcm.length < 4) return pcm;
  const s = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const windows = Math.floor(s.length / win);
  if (windows < 3) return pcm;
  const rms = new Array(windows);
  for (let w = 0; w < windows; w++) {
    let acc = 0;
    for (let i = w * win; i < (w + 1) * win; i++) acc += s[i] * s[i];
    rms[w] = Math.sqrt(acc / win);
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(windows * 0.95)] || 0;
  if (!loud) return pcm;
  const quiet = rms.map(v => v < loud * 0.04);
  const keepWindows = Math.max(2, Math.round(cap / 10));
  const half = Math.floor(keepWindows / 2);
  const cuts = []; // [startSample, endSample) to drop
  let w = 0;
  while (w < windows) {
    if (!quiet[w]) { w++; continue; }
    let end = w;
    while (end < windows && quiet[end]) end++;
    const inside = w > 0 && end < windows;
    if (inside && end - w > keepWindows) cuts.push([(w + half) * win, (end - (keepWindows - half)) * win]);
    w = end;
  }
  if (!cuts.length) return pcm;
  const fade = Math.min(Math.round(sampleRate * 0.005), half * win);
  const out = new Int16Array(s.length - cuts.reduce((n, [a, b]) => n + (b - a), 0));
  let from = 0;
  let to = 0;
  for (const [a, b] of cuts) {
    out.set(s.subarray(from, a), to);
    to += a - from;
    for (let k = 0; k < fade; k++) out[to - fade + k] = Math.round(out[to - fade + k] * (1 - (k + 1) / fade));
    for (let k = 0; k < fade && b + k < s.length; k++) s[b + k] = Math.round(s[b + k] * ((k + 1) / fade));
    from = b;
  }
  out.set(s.subarray(from), to);
  return Buffer.from(out.buffer);
}

module.exports = { FISH_PACES, fishPace, fishPacedText, fishTalkDirection, fishTalkFillers, fishTalkSeed, fishSentencePauses, capFishPauses };
