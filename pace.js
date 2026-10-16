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
 * FISH_TALK_FILLERS=1 turns it on for Fish chat speech, INWORLD_TALK_FILLERS=1 for Inworld; a
 * request's own fillers: true/false (the listener's switch) wins over either. */
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
  // Lists, and anything in quotation marks (a character reading a passage or quoting
  // someone), are read, not chatted: Kade, "we definitely wouldn't want them while reading".
  if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(src) || /["“”]/.test(src)) return src;
  const tags = [];
  // Bracket cues may sit between sentences; a paired <scope> tag means the next words are
  // scoped, so a sentence that opens with one is not a filler spot.
  const masked = src.replace(/\[[^\]]*\]|<[^>]*>/g, tag =>
    (tag[0] === '[' ? '\uE000' : '\uE002') + (tags.push(tag) - 1) + (tag[0] === '[' ? '\uE001' : '\uE003'));
  const words = masked.replace(/[\uE000\uE002]\d+[\uE001\uE003]/g, ' ').split(/\s+/).filter(Boolean).length;
  const rng = seeded(src);
  if (words < 12 && rng() < 0.5) return src;
  // A sentence start: end punctuation, space, any tags (e.g. the added [short pause]), a word.
  const starts = [];
  const re = /([.!?]["'”’)]*)([ \t]+(?:\uE000\d+\uE001[ \t]*)*)(?=([A-Z][^\s]*))/g;
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
  return (masked.slice(0, pick.at) + filler + ' ' + rest).replace(/[\uE000\uE002](\d+)[\uE001\uE003]/g, (_, i) => tags[Number(i)]);
}

// Inworld requests can hold several paragraphs (up to 500 characters); each paragraph takes
// its own turn. INWORLD_TALK_FILLERS=1 turns fillers on for Inworld chat speech.
function talkFillersByParagraph(text, { turn = 0, seed } = {}) {
  let n = 0;
  return String(text).split(/(\n\s*\n)/)
    .map((part, i) => (i % 2 ? part : fishTalkFillers(part, { turn: turn + n++, seed }))).join('');
}

/* Oct 16 2026, Kade: "maybe even some throat clearing or just, whatever, human things ... These
 * are meant to be voice messages from a synthetic soul character to you, so they should sound
 * human. When reading books, they shouldn't." Spoken only, like the fillers, and only where the
 * fillers may go. Placement follows how people talk and avoids what sounds like a glitch:
 * - at most one sound per paragraph request, chosen from the words, seeded so a replay matches;
 * - a small laugh only right after a line that is plainly funny;
 * - a sigh only before a line about being tired, fed up or relieved;
 * - a breath at a paragraph's opening, or before a long sentence;
 * - a throat clear rarely, only at the opening of a reply's first paragraph;
 * - never in lists or quotes, never beside a sound the character already wrote.
 * Spellings are each engine's own: Inworld has a fixed sound list (anything else becomes a
 * lasting instruction there), Drama3 reads plain words. FISH_TALK_SOUNDS=1 and
 * INWORLD_TALK_SOUNDS=1 turn them on; the listener's switch (fillers false) turns them off. */
// Drama3 reads plain words, so its cues can be reworded without a deploy (FISH_SOUND_*). Paired
// judging Oct 16: "[clear throat]" came out as a cough and lost 2-4; "[quietly clears throat]" won 5-1;
// "[small laugh]" after a funny line won 5-1 both times.
// Inworld's must stay exact words from its sound list.
function soundSpelling(engine) {
  if (engine === 'inworld') return { breath: '[breathe]', laugh: '[chuckle]', sigh: '[sigh]', throat: '[clear throat]' };
  const env = process.env;
  return { breath: env.FISH_SOUND_BREATH || '[inhale]', laugh: env.FISH_SOUND_LAUGH || '[small laugh]', sigh: env.FISH_SOUND_SIGH || '[sigh]', throat: env.FISH_SOUND_THROAT || '[quietly clears throat]' };
}
const FUNNY = /\b(?:ha(?:ha)+|lol|hilarious|funny|joking|kidding|ridiculous|silly|goofy|cracks? me up|cracking up|can't stop laughing)\b/i;
const NOT_FUNNY = /\bnot (?:funny|joking|kidding)\b/i;
// Not "finally": it is mostly good news ("the tomatoes finally came in"), not a sigh.
const WEARY = /\b(?:ugh|tired|exhausted|exhausting|drained|long day|rough day|worn out|phew|whew|relieved|what a relief|so done)\b/i;
const SOUNDISH = /laugh|chuckl|giggl|sigh|breath|inhale|exhale|throat|cough|gasp|snicker|snort|scoff|yawn/i;

function sentencesOf(masked) {
  const out = [];
  const push = (from, to) => {
    const lead = masked.slice(from, to).match(/^(?:\s|\uE000\d+\uE001)*/)[0].length;
    const text = masked.slice(from + lead, to);
    if (text.trim()) out.push({ start: from + lead, end: to, text, words: text.replace(/[\uE000\uE002]\d+[\uE001\uE003]/g, ' ').split(/\s+/).filter(Boolean).length });
  };
  const re = /[.!?]+["'”’)]*(?=\s|$)/g;
  let from = 0;
  for (let m; (m = re.exec(masked));) {
    if (/\.$/.test(m[0]) && NOT_A_SENTENCE_END.test(masked.slice(0, m.index))) continue;
    push(from, m.index + m[0].length);
    from = m.index + m[0].length;
  }
  push(from, masked.length);
  return out;
}

function talkSounds(text, { engine = 'fish', turn = 0 } = {}) {
  const src = String(text);
  if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(src) || /["“”]/.test(src)) return src;
  const spell = soundSpelling(engine);
  const tags = [];
  const masked = src.replace(/\[[^\]]*\]|<[^>]*>/g, tag =>
    (tag[0] === '[' ? '\uE000' : '\uE002') + (tags.push(tag) - 1) + (tag[0] === '[' ? '\uE001' : '\uE003'));
  const sentences = sentencesOf(masked);
  const words = sentences.reduce((n, s) => n + s.words, 0);
  if (!sentences.length || words < 6) return src;
  // A spot is taken when a sound tag already sits beside it (the character wrote one).
  const soundNear = (at, after) => {
    const near = after ? masked.slice(at).match(/^\s*(?:\uE000(\d+)\uE001\s*)+/) : masked.slice(0, at).match(/(?:\uE000(\d+)\uE001\s*)+$/);
    return Boolean(near && [...near[0].matchAll(/\uE000(\d+)\uE001/g)].some(m => SOUNDISH.test(tags[Number(m[1])])));
  };
  const rng = seeded(src + '|sounds');
  const roll = rng();
  let place = null;
  const funny = sentences.find(s => FUNNY.test(s.text) && !NOT_FUNNY.test(s.text) && /[.!?]["'”’)]*$/.test(s.text));
  // A line that opens with its own sigh word (phew, ugh) already sighs; a tag on top doubles it.
  const weary = sentences.find(s => WEARY.test(s.text) && !/^(?:phew|whew|ugh)\b/i.test(s.text));
  const long = sentences.slice(1).find(s => s.words >= 20);
  if (funny && roll < 0.6 && !soundNear(funny.end, true)) place = { at: funny.end, sound: spell.laugh, before: false };
  else if (weary && roll < 0.5 && !soundNear(weary.start, false)) place = { at: weary.start, sound: spell.sigh, before: true };
  else if (turn === 0 && words >= 15 && roll < 0.04 && !soundNear(sentences[0].start, false)) place = { at: sentences[0].start, sound: spell.throat, before: true };
  else if (words >= 12 && roll < 0.22 && !soundNear(sentences[0].start, false)) place = { at: sentences[0].start, sound: spell.breath, before: true };
  else if (long && roll < 0.45 && !soundNear(long.start, false)) place = { at: long.start, sound: spell.breath, before: true };
  if (!place) return src;
  const out = place.before
    ? masked.slice(0, place.at) + place.sound + ' ' + masked.slice(place.at)
    : masked.slice(0, place.at) + ' ' + place.sound + masked.slice(place.at);
  return out.replace(/[\uE000\uE002](\d+)[\uE001\uE003]/g, (_, i) => tags[Number(i)]);
}

function talkSoundsByParagraph(text, { engine = 'fish', turn = 0 } = {}) {
  let n = 0;
  return String(text).split(/(\n\s*\n)/)
    .map((part, i) => (i % 2 ? part : talkSounds(part, { engine, turn: turn + n++ }))).join('');
}

// The listener's own switch (a request's fillers: true/false) wins over the server default.
function wantsFillers(talk, envName) {
  if (talk && typeof talk === 'object' && typeof talk.fillers === 'boolean') return talk.fillers;
  return process.env[envName] === '1';
}

// Little sounds ride the same listener switch: fillers false turns both off. A request's own
// sounds: true/false wins over that.
function wantsSounds(talk, envName) {
  if (talk && typeof talk === 'object') {
    if (typeof talk.sounds === 'boolean') return talk.sounds;
    if (talk.fillers === false) return false;
  }
  return process.env[envName] === '1';
}

// Runs at the provider boundary, after author-tempo cleanup and chunk shaping.
// This changes the actor's instruction, never the audio's playback rate.
// talk: true or { turn, seed, fillers } for chat speech; false for everything read aloud.
function fishPacedText(text, rate, { talk = false } = {}) {
  const { direction } = fishPace(rate);
  // The character's own direction may sit behind an opening sound ("[laughs] [amused] Hey").
  const opening = String(text).match(/^\s*(?:\[[^\]\n]+\]\s*)+/);
  const ownDirection = Boolean(opening && [...opening[0].matchAll(/\[([^\]\n]+)\]/g)].some(m => isDirectionTag(m[1])));
  const casual = talk && !ownDirection ? fishTalkDirection() : '';
  const opts = typeof talk === 'object' ? talk : {};
  const filled = talk && wantsFillers(talk, 'FISH_TALK_FILLERS') ? fishTalkFillers(text, opts) : text;
  const spoken = talk && wantsSounds(talk, 'FISH_TALK_SOUNDS') ? talkSounds(filled, { engine: 'fish', turn: opts.turn || 0 }) : filled;
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

module.exports = { FISH_PACES, fishPace, fishPacedText, fishTalkDirection, fishTalkFillers, fishTalkSeed, talkFillersByParagraph, talkSounds, talkSoundsByParagraph, soundSpelling, wantsFillers, wantsSounds, fishSentencePauses, capFishPauses };
