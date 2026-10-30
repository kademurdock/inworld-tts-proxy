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
/* Oct 17 2026, Kade: on Fish "there aren't really pauses after thoughts or sentences ... there are
 * pauses, but not silences, just inflectional ones." Measured on the live proxy (Kiana's voice and
 * Molasses Dusk): inside one request Drama3 leaves 0.75-1.15 s between sentences, but a request
 * ends with only 0.07-0.35 s of tail and starts with 0.03-0.2 s of head. The iPhone plays one clip
 * per 160-320-character piece and the proxy joined paragraphs with its 340 ms Inworld seam, so the
 * places where a thought ended got the SHORTEST stop. Brisk and Quick also cut every silence to
 * 0.3 / 0.2 s, which measured as their whole speed gain (the words themselves were not faster).
 * thoughtGapMs: the silence after a chat clip and at a paragraph seam, per pace. pauseCapMs now
 * keeps a real, shorter stop at Brisk and Quick instead of an inflection. */
// Kade, the same night after hearing it: "the pauses should be just a tiiiiny bit shorter, like
// between .3 and .5 seconds at most." Every pace now caps a silence inside a clip at 0.5 s or less
// and ends a clip on 0.35-0.5 s.
/* Oct 30 2026, Kade, after hearing the same take stretched by every amount: "All the prat clips
 * sounded completely natural. Even the one going upwards of 150. So I'm thinking ... we need Prat as
 * the fish speed controler in all methods that use fish ... The brisk and all that, that wasn't
 * original, that was just because we couldn't get fish api to sound right." With FISH_SPEED_EXACT=1
 * (fishExactOn) this table stops mattering: every request is the Natural take, Praat stretches it by
 * the listener's own number, and the functions below take { exact: true } for it. The table and the
 * rest of this file's pace rules remain for the switch being off and for a request that says
 * fishSpeed: "legacy" (only the describer, for jobs it started before this change). */
const FISH_PACES = [
  { value: 0.75, name: 'Unhurried', direction: 'Speak unhurriedly, with relaxed phrasing and clear words.', pauseCapMs: 500, thoughtGapMs: 500 },
  { value: 0.9, name: 'Easygoing', direction: 'Speak at an easygoing conversational pace, with natural expressive phrasing.', pauseCapMs: 500, thoughtGapMs: 500 },
  { value: 1, name: 'Natural', direction: '', pauseCapMs: 500, thoughtGapMs: 450 },
  { value: 1.2, name: 'Brisk', direction: 'speaking quickly, letting the sentences flow together with short pauses', sentencePauses: false, pauseCapMs: 450, thoughtGapMs: 400, apiSpeed: 1.05, stretch: 1.05 },
  { value: 1.5, name: 'Quick', direction: 'fast-talking, rapid delivery with almost no pauses', sentencePauses: false, pauseCapMs: 350, thoughtGapMs: 350, apiSpeed: 1.1, stretch: 1.1 },
];

function fishPace(rate) {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  return FISH_PACES.reduce((best, pace) => Math.abs(pace.value - value) < Math.abs(best.value - value) ? pace : best);
}

/* Oct 30 2026, Kade, after hearing Fish's speed at 1.05-1.20 next to clones of sped-up references:
 * the lowest setting "is still grossly not natural, but yes I think it's better than our stretch",
 * so "we'll have to make due wit the lowest speed settings on api." Only someone who chose Brisk or
 * Quick hears it, only on chat speech. Natural, the slower paces and every reading path stay at 1.0.
 * Switch: FISH_PACE_SPEED=1 turns it on; anything else leaves prosody.speed at 1.0. */
function fishApiSpeed(rate, { talk = false, liveCall = false, exact = false, source = process.env } = {}) {
  if (exact) return 1; // a line is never sped up twice
  if (!talk || (fishStretchOn(source) && !liveCall) || source.FISH_PACE_SPEED !== '1') return 1; // never both stretches
  return fishPace(rate).apiSpeed || 1;
}

/* Oct 30 2026, Kade, later the same day, the same take through several methods: "Grat is my favorite
 * ... Grat actually sounded really naturally." Praat's overlap-add (fish-stretch.js) replaces Fish's
 * own speed, with the same reach and the amounts she has heard. The stretch column in FISH_PACES is
 * the one line to change to widen them. Switch: FISH_PACE_STRETCH=1 turns it on; anything else leaves
 * FISH_PACE_SPEED in charge, as before. A live call stays out and sounds as it did with the switch off:
 * the listener is on the line and a stuck worker costs up to 2 s. */
function fishStretchOn(source = process.env) {
  return source.FISH_PACE_STRETCH === '1';
}

function fishExactOn(source = process.env) {
  return source.FISH_SPEED_EXACT === '1';
}

// The listener's number as it is; absent means 1, which never reaches the worker.
function fishExactRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function fishStretchRatio(rate, { talk = false, liveCall = false, exact = false, source = process.env } = {}) {
  if (exact) return fishExactRate(rate); // every path; a live call only waits less (fish-stretch.js)
  if (!talk || liveCall || !fishStretchOn(source)) return 1;
  return fishPace(rate).stretch || 1;
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
// Kade, judging auditions on her iPhone the same night: "Well", "you know", "I mean" came out
// "weirdly stiff and robotic ... like they aren't a slip of the tongue", while um and the
// laughing were fine. Only hesitation sounds stay; a placed discourse word reads as scripted.
const FILLERS = {
  question: ['Um,', 'Uh,'],
  statement: ['Um,', 'Uh,'],
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

/* Oct 17 2026, Kade: the um and uh "don't sound natural ... like, um, pause, whatever they were
 * saying ... It sounds like it's scripted." The filler sat at the START of a sentence with a comma
 * ("Um, the store closed early"), so the voice said um, paused, then read on. People slip it in
 * mid-thought ("I was, uh, gonna say") or just trail off. TALK_FILLER_STYLE picks how, for Fish
 * and Inworld alike; the listener's switch still means "allowed", and the little sounds are not
 * touched by it:
 *   none   no filler words at all (sounds only)
 *   lead   the Oct 16 version: "Um," opening a later sentence
 *   mid    "uh" inside a sentence, after "and/but/so/because" or after "I was / it's / that's ..."
 *   pause  the same mid-phrase spot, a trail-off ("...") and no word
 *   run    the same mid-phrase spot, the word run together with no commas ("I was uh thinking");
 *          Kade's pick after the listening set, on Fish and Inworld both (pause was runner-up)
 * Unset = lead, exactly as before this change. */
function fillerStyle() {
  const s = String(process.env.TALK_FILLER_STYLE || 'lead').trim().toLowerCase();
  return ['none', 'lead', 'mid', 'pause', 'run'].includes(s) ? s : 'lead';
}

// A spot inside a sentence where people hesitate: right after a joining word (and, but, so,
// because) or right after an opening subject and its verb (I was, it's, that's, we were...).
const JOIN_SPOT = /(?<=\S[ \t]+)(?:and|but|so|because|then)(?=[ \t]+[a-zA-Z])/g;
const SUBJECT_SPOT = /^(?:I(?:['’]m|['’]ve|['’]d| was| think| guess| just| really| kind of)?|it(?:['’]s| was)|that(?:['’]s| was)|there(?:['’]s| was)|we(?:['’]re| were)?|you(?:['’]re| were)?|they(?:['’]re| were)?|he(?:['’]s| was)|she(?:['’]s| was))(?=[ \t]+[a-zA-Z])/i;

function midFiller(src, { turn = 0, seed, style }) {
  if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(src) || /["“”]/.test(src)) return src;
  const tags = [];
  const masked = src.replace(/\[[^\]]*\]|<[^>]*>/g, tag =>
    (tag[0] === '[' ? '' : '') + (tags.push(tag) - 1) + (tag[0] === '[' ? '' : ''));
  const rng = seeded(src + '|mid');
  const words = masked.replace(/[]\d+[]/g, ' ').split(/\s+/).filter(Boolean).length;
  if (words < 12 && rng() < 0.5) return src;
  const spots = [];
  for (const s of sentencesOf(masked)) {
    if (s.words < 6 || /[]/.test(s.text.slice(0, 12))) continue;
    const subject = s.text.match(SUBJECT_SPOT);
    if (subject) spots.push(s.start + subject[0].length);
    for (const m of s.text.matchAll(JOIN_SPOT)) {
      const before = s.text.slice(0, m.index).split(/\s+/).filter(Boolean).length;
      if (before >= 3 && s.words - before >= 3) spots.push(s.start + m.index + m[0].length);
    }
  }
  if (!spots.length) return src;
  const at = spots[Math.floor(rng() * spots.length)];
  const base = Number.isInteger(seed) ? seed : Math.floor(rng() * 1e6);
  const word = ['uh', 'um'][(base + turn) % 2];
  const insert = style === 'pause' ? '...' : style === 'run' ? ` ${word}` : `, ${word},`;
  return (masked.slice(0, at) + insert + masked.slice(at)).replace(/[](\d+)[]/g, (_, i) => tags[Number(i)]);
}

// turn: the paragraph's place in its reply; seed: fishTalkSeed of the whole reply.
function fishTalkFillers(text, { turn = 0, seed } = {}) {
  const style = fillerStyle();
  if (style === 'none') return String(text);
  if (style === 'mid' || style === 'pause' || style === 'run') return midFiller(String(text), { turn, seed, style });
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

// seedText: the words before the Inworld writer marked them up (inworld-writer.js), so its
// capitals and direction never change which sound a piece gets, or where.
function talkSounds(text, { engine = 'fish', turn = 0, seedText = null } = {}) {
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
  const rng = seeded((seedText == null ? src : String(seedText)) + '|sounds');
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

function talkSoundsByParagraph(text, { engine = 'fish', turn = 0, seedText = null } = {}) {
  let n = 0;
  const seeds = seedText == null ? null : String(seedText).split(/(\n\s*\n)/);
  return String(text).split(/(\n\s*\n)/)
    .map((part, i) => (i % 2 ? part : talkSounds(part, { engine, turn: turn + n++, seedText: seeds ? seeds[i] : null }))).join('');
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
// The pace direction changes the actor's instruction, never the audio's playback rate; with
// exact there is none, so the text sent to Fish is the Natural text at every speed.
// talk: true or { turn, seed, fillers } for chat speech; false for everything read aloud.
function fishPacedText(text, rate, { talk = false, exact = false } = {}) {
  const direction = exact ? '' : fishPace(rate).direction;
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
function fishSentencePauses(rate, { exact = false } = {}) {
  if (process.env.FISH_SENTENCE_PAUSES === '0') return false;
  if (exact) return true; // the Natural take, whatever the speed
  return fishPace(rate).sentencePauses !== false;
}

/* Shorten silences INSIDE a Fish clip (16-bit mono PCM) to the pace's cap. Speech is
 * never touched: a 10 ms window counts as silence below 4% of the clip's loud level, the
 * first and last half-cap of each long silent run are kept (word tails and breaths in),
 * the middle is dropped, and 5 ms fades meet at the join. Leading and trailing silence
 * stay as they are. Returns the same buffer when there is nothing to do. */
function fishPauseCapMs(rate, { exact = false } = {}) {
  // FISH_NATURAL_PAUSE_CAP_MS overrides Natural's cap ('0' = no cap at Natural).
  const pace = fishPace(rate);
  const natural = process.env.FISH_NATURAL_PAUSE_CAP_MS;
  const set = natural !== undefined && natural !== '';
  if (exact) {
    // What she called natural was the whole clip scaled, stops included: 500 ms is 333 ms at 1.5x.
    // Slower than 1x the cap holds still (Oct 17: "between .3 and .5 seconds at most").
    const whole = set ? Number(natural) || 0 : fishPace(1).pauseCapMs;
    const speed = fishExactRate(rate);
    return speed >= 1 ? whole / speed : whole;
  }
  return pace.value === 1 && set ? Number(natural) || 0 : pace.pauseCapMs || 0;
}

function capFishPauses(pcm, rate, sampleRate = 24000, { exact = false } = {}) {
  const cap = fishPauseCapMs(rate, { exact });
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

// The silence after a Fish chat clip and between its paragraphs. FISH_THOUGHT_GAPS=0 turns it
// off (the 340 ms seam and the bare clip tail come back).
function fishThoughtGapMs(rate, { exact = false } = {}) {
  if (process.env.FISH_THOUGHT_GAPS === '0') return 0;
  if (exact) return Math.min(500, Math.max(300, 450 / fishExactRate(rate))); // 500, 450, 375, 300 from 0.9x up
  return fishPace(rate).thoughtGapMs || 0;
}

/* Let a Fish chat clip (16-bit mono PCM) end on a real stop: append silence until the quiet at its
 * end reaches the pace's thought gap, less the head the next clip brings (~80 ms). Speech and any
 * silence already there are untouched; a clip that already ends long enough is returned as is. */
function padFishTail(pcm, rate, sampleRate = 24000, { exact = false } = {}) {
  const target = fishThoughtGapMs(rate, { exact }) - 80;
  if (target <= 0 || !pcm || pcm.length < 4) return pcm;
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
  if (loud < 200) return pcm; // no speech in it: nothing to end
  let quietEnd = 0;
  for (let w = windows - 1; w >= 0 && rms[w] < loud * 0.04; w--) quietEnd++;
  const haveMs = quietEnd * 10 + ((s.length - windows * win) / sampleRate) * 1000;
  const addSamples = Math.round(((target - haveMs) / 1000) * sampleRate);
  if (addSamples <= 0) return pcm;
  return Buffer.concat([pcm.subarray(0, s.length * 2), Buffer.alloc(addSamples * 2)]);
}

// The real overall speed of a response, from the audio bytes of its Fish chunks before and after
// Praat (x-kade-tts-speed-applied): before / after to 3 decimals, 1 when nothing was stretched.
function fishSpeedApplied({ before = 0, after = 0 } = {}) {
  return before > 0 && after > 0 && before !== after ? (before / after).toFixed(3) : '1';
}

module.exports = { FISH_PACES, fishPace, fishApiSpeed, fishExactOn, fishExactRate, fishSpeedApplied, fishStretchOn, fishStretchRatio, fishPacedText, fishTalkDirection, fishTalkFillers, fillerStyle, fishTalkSeed, talkFillersByParagraph, talkSounds, talkSoundsByParagraph, soundSpelling, wantsFillers, wantsSounds, fishSentencePauses, fishPauseCapMs, capFishPauses, fishThoughtGapMs, padFishTail };
