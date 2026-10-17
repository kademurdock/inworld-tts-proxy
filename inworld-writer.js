'use strict';
/* Oct 17 2026 — THE INWORLD VOICE WRITER. Kade, after hearing the Fish voice director (director.js):
 * "I love the new delivery and it makes me wonder if we should have a writer that does the same
 * thing for inworld, like turns text into the documented inworld style."
 *
 * Inworld's own prompting guide for TTS-2 (docs.inworld.ai/tts/best-practices/prompting-for-tts-2)
 * opens a reply with one fuller direction that layers feeling, pitch and manner, writes the stressed
 * word in capitals "sparingly", and writes a new [direction] only where the delivery changes, since
 * a direction holds until the next one (VOICE_PROVIDER_GUIDE.md). Our chat pieces arrived with none
 * of it unless a character wrote a direction. This asks a fast model where that markup goes in one
 * Inworld chat piece: the opening direction rides the request's `instruction` field (not billed;
 * today's API reference no longer lists the field, but a duration test on Oct 17 showed it still
 * steers: 15 s against 5 s for "say extremely slowly"), the capitals and the one mid-line direction
 * go into the text. The model never returns the text itself, so no word can change, and the result
 * is kept only when every tag already there stays where it was. The direction is Kade's own
 * situation plus an everyday feeling ("an animated casual chat with your best friend after their
 * rough day with warm sympathy"), not Inworld's layered pitch-and-manner style, which slowed the
 * voice (SLOWING), and never bigger than the moment (DRAMATIC). Measured in Harley's voice, three
 * takes each, the same brief opening "an animated casual chat with your best friend" ran as long
 * as plain (19.9 s), "talking on the phone with a close friend" +1%, "chatting on the phone" +8%.
 *
 * No [pause] (on Inworld that would be a lasting instruction, not silence) and no <break>: Inworld
 * already stops at a sentence end (0.8-0.9 s in Harley's voice), and a 400 ms break there made it
 * 1.1 s, further from Kade's 0.3-0.5 s. No sounds (pace.js talkSounds places those), no speed words
 * (speed is the listener's), no whisper or shout (Kade, Sep 23: Lively "seems to go from yelling to
 * whispering too much").
 *
 * Only Inworld chat speech and conversation auditions (the caller decides: never reading, STABLE,
 * book scenes, previews of scripts, the phone). Pieces shorter than INWORLD_WRITER_MIN_CHARS are
 * spoken plain, like the Fish director: the iPhone's opening piece is short, and later pieces are
 * prepared while the one before plays. A failure, a host refusal or a slow answer speaks the piece
 * as before. INWORLD_WRITER=1 turns it on.
 *
 * The model is MiMo 2.6 Flash on OpenRouter (Kade prefers MiMo to Google Flash models), measured as
 * this writer on six replies, thinking off, zero retention: Flash on Io Net median 0.95 s (max
 * 1.3 s, 24/24 kept), Flash on Makora ~1.1 s with 6-18 s stalls, Pro on DeepInfra median 2.3 s.
 * INWORLD_WRITER_MODEL / INWORLD_WRITER_HOSTS change them. zdr + data_collection deny always. */

const crypto = require('crypto');
const { isNonVerbalSound, isResetTag } = require('./sounds');

/* The model never returns the message, only where to put markup: words cannot change by
 * construction, and the answer is a few dozen tokens. */
const SYSTEM = `You are a voice writer preparing a friend's spoken voice message for Inworld's TTS-2 text-to-speech model, in the style of Inworld's own prompting guide. You never rewrite the message; you say where its performance markup goes.

Return JSON {"instruction": "...", "stress": ["..."], "turn": "..."}.

"instruction": the opening direction for the whole message, as a natural-language direction in plain lowercase words with no punctuation. This is a casual conversation between best friends, animated and expressive the way friends really talk, never a drama script read by a voice actor. Always begin with "an animated casual chat with your best friend" and add the everyday feeling these exact words carry, in proportion to the moment: a small thing gets a small feeling, and only real news gets real excitement. E.g. "an animated casual chat with your best friend happy to share some good news" or "an animated casual chat with your best friend after their rough day with warm sympathy" or "an animated casual chat with your best friend dry and amused about it". Under eighteen words. No big dramatic words (bursting, flooded, overwhelmed, thrilled, ecstatic, devastated, desperate, furious); nothing that slows or hushes the voice (no slow, calm, soothing, gentle, soft, low, measured, deliberate, quiet, whisper or pauses; warmth and sympathy need none of them); nothing loud or shouted; no laughing, sighing or other sounds. If the message says it already has a direction, return "".

"stress": Inworld stresses a word written in capital letters ("I told you NOT to do that"), used sparingly. Give the word a friend would lean on as a snippet copied exactly from the message, three to five words long, with only that word in capitals, e.g. "is going to be a WHOLE thing". Most messages have one such word: give it. At most one per two sentences and two in all. Never a short common word (is, it, my, me, be, do, go, so, to, no, yes, not, the, this, that, you, your, are, was, were): pick the word that carries the meaning.

"turn": only where the feeling changes for the rest of the message, a new direction in square brackets, a few plain words about the new feeling, just as casual and in proportion, followed by the first three to five words it applies to, copied exactly, e.g. "[a little lighter and curious now] Anyway, how did your" or "[teasing a bit now] but I'm not". A direction stays in force until the end, so a message that keeps one feeling has none: return "". Never at the very start (the instruction covers that).

No sounds, pauses or other markup; other steps handle those.`;

const TAG = /\[[^\]\n]*\]/g;
// The same short words speech-prosody.js normalizeInworldCaps turns back to lower case.
const SHORT_WORDS = new Set(['IS', 'IT', 'MY', 'ME', 'BE', 'DO', 'GO', 'SO', 'TO', 'NO', 'YES', 'NOT', 'THE', 'THIS', 'THAT', 'YOU', 'YOUR', 'ARE', 'WAS', 'WERE']);
const TEMPO = /\b(?:slow(?:ly|er)?|fast(?:er)?|quick(?:ly|er)?|rapid(?:ly)?|brisk(?:ly)?|hurr(?:ied|iedly|y)|rush(?:ed|ing)?|unhurried|leisurely|pace|pacing|paused?|pauses|tempo|drawn[- ]out|speeding|breathless(?:ly)?)\b/i;
// Kade, Sep 23: Lively Inworld "seems to go from yelling to whispering too much".
const VOLUME = /\b(?:whisper\w*|shout\w*|yell\w*|scream\w*|loud\w*|quiet(?:ly|er)|hush\w*|murmur\w*|mumbl\w*|under (?:her|his|their|your) breath|(?:quiet|soft|low|small) voice)\b/i;
const SOUNDS = /\b(?:laugh\w*|giggl\w*|chuckl\w*|sigh\w*|sob\w*|cry\w*|crying|gasp\w*|sniff\w*|breath\w*)\b/i;
/* Measured Oct 17 in Harley's voice: "say gently ... warm and low with quiet comfort" stretched
 * the stops between sentences to 1.0-1.2 s (0.6-0.8 s plain) and an excited "say with ..." brief
 * slowed the words ~10%; a situation ("talking on the phone with a close friend ...") stayed closer.
 * These words are taken out of a brief, and a turn that uses one is dropped. */
const SLOWING = /\b(?:calm\w*|sooth\w*|gentl[ey]|soft(?:ly|er|en\w*)?|low(?:er)?|measured|deliberate\w*|tender\w*|settl\w*|hushed|quiet|subdued|steady|steadier|relaxed|easygoing|lazy|lazily|drawl\w*)\b/i;
/* Kade, Oct 17, on yes: "I've seen some voices screaming about stuff that wasn't a huge deal in the
 * auditions, so I'm thinking it needs to be more like, an animated or expressive casual conversation
 * between best friends. Not a drama script being read by a voice actor." Big words are taken out
 * of a brief ("hugely relieved" keeps "relieved"), and a turn that uses one is dropped. */
const DRAMATIC = /\b(?:burst\w*|flood\w*|overwhelm\w*|thrill\w*|ecstatic\w*|elat\w*|devastat\w*|desperat\w*|furious\w*|frantic\w*|hysteric\w*|intens\w*|passionat\w*|dramatic\w*|explosive\w*|wild\w*|hugely|extremely|incredibly|utterly|absolutely|totally|completely|overjoyed|euphoric|heartbroken|shattered|beside (?:herself|himself|themselves|yourself))\b/i;

/* Apply the answer's snippets to the original. A snippet that is not found exactly once is
 * skipped; vet() then checks the result like any marked text. */
function applyEdits(original, answer) {
  let text = String(original);
  const find = (snippet) => {
    const lower = text.toLowerCase();
    const s = String(snippet || '').trim().toLowerCase();
    if (s.length < 3) return -1;
    // Whole words only: "how did you" must not land inside "how did your".
    const hits = [];
    for (let at = lower.indexOf(s); at >= 0; at = lower.indexOf(s, at + 1)) {
      if (!/[a-z0-9']/.test(lower[at - 1] || '') && !/[a-z0-9']/.test(lower[at + s.length] || '')) hits.push(at);
    }
    return hits.length === 1 ? hits[0] : -1;
  };
  for (const snippet of (Array.isArray(answer.stress) ? answer.stress : []).slice(0, 3)) {
    const s = String(snippet || '').trim();
    const at = find(s);
    if (at >= 0) text = text.slice(0, at) + s + text.slice(at + s.length);
  }
  const turn = String(answer.turn || '').trim().match(/^\[([^\]\n]{1,200})\]\s*(\S.*)$/);
  if (turn) {
    const at = find(turn[2]);
    if (at > 0) text = `${text.slice(0, at)}[${turn[1]}] ${text.slice(at)}`;
  }
  return text;
}

function env(name, fallback, source = process.env) {
  const v = source[name];
  return v === undefined || v === '' ? fallback : v;
}
const model = (source) => env('INWORLD_WRITER_MODEL', 'xiaomi/mimo-v2.6-flash', source);
// Zero-retention hosts, fastest first (Pro is served with zdr by DeepInfra and Novita only).
const hosts = (source) => env('INWORLD_WRITER_HOSTS', /flash/.test(model(source)) ? 'Io Net,Makora,DeepInfra' : 'DeepInfra', source)
  .split(',').map(h => h.trim()).filter(Boolean);
function writerOn(source = process.env) {
  return source.INWORLD_WRITER === '1' && Boolean(source.OPENROUTER_KEY);
}
const minChars = (source) => Number(env('INWORLD_WRITER_MIN_CHARS', 140, source));
const timeoutMs = (source) => Number(env('INWORLD_WRITER_TIMEOUT_MS', 3000, source));

const wordsOf = (t) => String(t).replace(TAG, ' ').trim().split(/\s+/).filter(Boolean);
const tagsOf = (t) => String(t).match(TAG) || [];
const letters = (w) => w.replace(/[^A-Za-z]/g, '');

// A direction or brief as Inworld's docs write one: lower case, words, no punctuation.
function cleanDirection(d) {
  return String(d || '').toLowerCase().replace(/\s*,\s*(?:and\s+)?/g, ' and ').replace(/[^a-z' ]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/* The brief: speed and hush words are taken out ("say softly with warm sympathy" keeps "say with
 * warm sympathy"); anything else outside the plan drops the brief, never the piece. */
function vetInstruction(instruction) {
  const s = cleanDirection(instruction)
    .replace(/\b(?:with|at|in)\s+(?:a\s+|an\s+)?(?:[a-z']+\s+){0,2}(?:pace|tempo|pauses?)\b/g, ' ')
    .replace(/\b(?:softly|quietly|slowly|quickly|unhurriedly)\b(?:\s+and\b)?/g, ' ')
    .replace(new RegExp(`${SLOWING.source}(?:\\s+and\\b)?`, 'gi'), ' ')
    .replace(new RegExp(`${DRAMATIC.source}(?:\\s+and\\b)?`, 'gi'), ' ')
    .replace(/\b(?:in|with)\s+(?:a\s+|an\s+)?(?:tone|voice|manner)\b/g, ' ')
    .replace(/\s{2,}/g, ' ').replace(/\band(?:\s+and)+\b/g, 'and').replace(/\band\s+(?=(?:with|like|to|in|and)\b)/g, '')
    .replace(/^(?:and|with)\s+|\s+(?:and|with|in|like)$/g, '').trim();
  const words = s ? s.split(' ').length : 0;
  if (words < 2 || words > 24 || TEMPO.test(s) || VOLUME.test(s) || SOUNDS.test(s)) return null;
  return s;
}

/* Keep only markup we asked for. Sounds, resets, tempo and volume directions the model added
 * anyway are dropped; a changed word, a lost or moved tag or too much markup rejects the whole
 * piece. The kept text is rebuilt from the original, so its spacing and paragraphs never change. */
function vet(original, marked) {
  if (typeof marked !== 'string' || !marked.trim()) return { ok: false, reason: 'empty' };
  const before = wordsOf(original);
  const after = wordsOf(marked);
  if (before.length !== after.length) return { ok: false, reason: 'words changed' };
  // Each tag with the number of words before it.
  const placed = (t) => {
    const out = [];
    let n = 0;
    for (const piece of String(t).split(/(\[[^\]\n]*\])/)) {
      if (piece[0] === '[' && piece.endsWith(']')) out.push({ tag: piece, at: n });
      else n += wordsOf(piece).length;
    }
    return out;
  };
  const own = placed(original);
  const added = [];
  let k = 0;
  for (const t of placed(marked)) {
    if (k < own.length && t.tag === own[k].tag) {
      if (t.at !== own[k].at) return { ok: false, reason: 'a tag was moved' };
      k++;
      continue;
    }
    const inner = t.tag.slice(1, -1);
    if (isNonVerbalSound(inner) || isResetTag(inner) || TEMPO.test(inner) || VOLUME.test(inner) || SOUNDS.test(inner) || SLOWING.test(inner) || DRAMATIC.test(inner)) continue;
    const clean = cleanDirection(inner);
    if (!clean || clean.length > 60 || /\d/.test(inner)) return { ok: false, reason: 'markup outside the plan' };
    if (t.at === 0) return { ok: false, reason: 'direction at the start' };
    if (t.at < before.length) added.push({ tag: `[${clean}]`, at: t.at });
  }
  if (k < own.length) return { ok: false, reason: 'a tag was lost' };
  // Capitals: a word may only change by being written in capitals. A short or common word in
  // capitals keeps its own spelling (Inworld would read it as letters, or normalizeInworldCaps
  // would undo it).
  const stressed = new Map();
  for (let w = 0; w < before.length; w++) {
    if (after[w] === before[w]) continue;
    const upper = before[w].toUpperCase();
    if (after[w] !== upper) return { ok: false, reason: 'words changed' };
    if (letters(upper).length >= 3 && !SHORT_WORDS.has(letters(upper))) stressed.set(w, upper);
  }
  if (added.length > 1) return { ok: false, reason: 'too much markup' };
  if (stressed.size > 2 || stressed.size > Math.ceil(sentences(original) / 2)) return { ok: false, reason: 'too much markup' };
  let w = 0;
  const text = String(original).split(/(\s+|\[[^\]\n]*\])/).map((piece) => {
    if (!piece || /^\s+$/.test(piece) || (piece[0] === '[' && piece.endsWith(']'))) return piece;
    const lead = added.filter(a => a.at === w).map(a => a.tag + ' ').join('');
    return lead + (stressed.get(w++) || piece);
  }).join('');
  if (wordsOf(text).join(' ').toLowerCase() !== before.join(' ').toLowerCase()) return { ok: false, reason: 'words changed' };
  return { ok: true, text, added: added.length + stressed.size };
}

function sentences(t) {
  return Math.max(1, (String(t).replace(TAG, ' ').match(/[.!?]+(?=\s|$)/g) || []).length);
}

function createWriter({ fetcher = (...a) => fetch(...a), source = process.env, now = () => Date.now(), log = console.log } = {}) {
  const cache = new Map();
  const CACHE_MAX = 400;
  let pausedUntil = 0;
  let failuresInARow = 0;

  async function ask(text, { previous, hasDirection }) {
    const context = previous && previous.length ? `Said just before (context only, do not return it): ${previous.slice(-2).join(' ').slice(-400)}\n\n` : '';
    const own = hasDirection ? 'This message already has its own direction: return "" for instruction.\n\n' : '';
    const body = {
      model: model(source),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${context}${own}Message:\n${text}` }],
      temperature: 0.3, max_tokens: 300,
      // MiMo's thinking must be switched off explicitly; its 'low' effort is not short.
      reasoning: { enabled: false },
      // Novita rejects a strict json_schema; json_object works on every MiMo host.
      response_format: { type: 'json_object' },
      provider: { zdr: true, data_collection: 'deny', order: hosts(source), allow_fallbacks: true },
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs(source));
    try {
      const r = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ac.signal, body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${source.OPENROUTER_KEY}`, 'X-Title': 'Kade voice writer' },
      });
      if (!r.ok) {
        const e = new Error(`writer HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      const j = await r.json();
      const choice = j.choices && j.choices[0];
      // A host refusal (Novita answers 200 with content_filter) is no answer, never markup.
      if (!choice || choice.finish_reason === 'content_filter' || !choice.message || !choice.message.content) {
        throw new Error('writer: no answer');
      }
      return JSON.parse(choice.message.content);
    } finally {
      clearTimeout(timer);
    }
  }

  // One lifted piece { text, instruction } -> { text, instruction, status }. Never throws.
  async function writePiece(piece, { previous } = {}) {
    const src = String((piece && piece.text) || '');
    const own = (piece && piece.instruction) || null;
    const plain = (status, extra = {}) => ({ text: src, instruction: own, status, ...extra });
    if (!writerOn(source)) return plain('off');
    if (src.length < minChars(source)) return plain('short');
    if (/["“”]/.test(src) || /^\s*(?:[-*•]|\d+[.)])\s/m.test(src)) return plain('read');
    const key = crypto.createHash('sha1').update(model(source) + '\n' + (own ? 'own' : '') + '\n' + src).digest('hex');
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return { ...hit, status: 'cached' };
    }
    if (now() < pausedUntil) return plain('paused');
    const t0 = now();
    try {
      const answer = await ask(src, { previous, hasDirection: Boolean(own) });
      failuresInARow = 0;
      const verdict = vet(src, applyEdits(src, answer || {}));
      if (!verdict.ok) return plain(`kept plain (${verdict.reason})`, { ms: now() - t0 });
      // The character's own opening direction always wins over the brief.
      const instruction = own || vetInstruction(answer.instruction);
      const out = { text: verdict.text, instruction };
      cache.set(key, out);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      const added = verdict.added + (instruction && !own ? 1 : 0);
      return { ...out, status: added ? 'written' : 'nothing to add', ms: now() - t0 };
    } catch (e) {
      failuresInARow++;
      // Out of credit or refused: stop asking for a while. Repeated timeouts: a short rest.
      if ([401, 402, 403, 429].includes(e.status)) pausedUntil = now() + 10 * 60 * 1000;
      else if (failuresInARow >= 3) pausedUntil = now() + 2 * 60 * 1000;
      const why = e.name === 'AbortError' ? 'timed out' : e.status ? `HTTP ${e.status}` : 'failed';
      return plain(`kept plain (${why})`, { ms: now() - t0 });
    }
  }

  async function writePieces(pieces, opts = {}) {
    if (!writerOn(source)) return pieces;
    const results = await Promise.all(pieces.map(p => writePiece(p, opts)));
    const told = results.filter(r => r.status !== 'short').map(r => `${r.status}${r.ms != null ? ` ${r.ms}ms` : ''}`);
    if (told.length) log(`[TTS] inworld writer: ${told.join(', ')}`);
    return results.map(({ text, instruction }) => ({ text, instruction }));
  }

  return { writePiece, writePieces, cacheSize: () => cache.size };
}

module.exports = { createWriter, writerOn, vet, vetInstruction, applyEdits, SYSTEM };
