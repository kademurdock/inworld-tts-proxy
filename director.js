'use strict';
/* Oct 17 2026 — THE FISH VOICE DIRECTOR. Kade, after asking us to "really dive into how drama3 tags
 * text" and hearing a/b clips: "Build the voice director in for Fish voice messages."
 *
 * Fish's own Drama 3 examples are marked up like a script: a second direction where the mood
 * turns, one paired tag on the word a person leans on, a [pause] before a short payoff line, a
 * <soft> closing line. Our replies arrived with one fixed brief and emphasis only when a character
 * typed in capitals. This asks a fast model to add that markup to one Fish chat piece, and keeps
 * the result only when every word, every punctuation mark and every tag already there survives.
 * Anything else (a changed word, too many tags, a slow or failed call) speaks the piece as before.
 *
 * Only Fish chat speech (the caller decides: never reading, books, previews of scripts). Pieces
 * shorter than FISH_DIRECTOR_MIN_CHARS are spoken plain: the iPhone's opening piece is short and
 * nobody hears a later piece's extra second, because it is prepared while the one before plays.
 * Sounds stay with pace.js talkSounds (the director never adds one). FISH_DIRECTOR=1 turns it on.
 *
 * The model is MiMo 2.6 Pro on OpenRouter (Kade, the same night: "any time you feel like using a
 * flash model from google, you should consider using a pro or flash model from Mimo to match the
 * rest of the setup"). Measured as the director, thinking off, DeepInfra: Pro median ~1.1 s, 6/6
 * and 5/6 words intact (the miss repeated a sentence and was caught); Flash was slower there
 * (median 3.3 s, up to 8.4 s). Zero retention like every fleet adapter: zdr + data_collection deny.
 * FISH_DIRECTOR_MODEL=gemini-... with FISH_DIRECTOR_KEY rolls back to Google.
 *
 * Kade, after hearing auditions: "I've seen some voices screaming about stuff that wasn't a huge
 * deal ... it needs to be more like, an animated or expressive casual conversation between best
 * friends. Not a drama script being read by a voice actor." The brief (FISH_DEFAULT_DIRECTION) and
 * the opening of SYSTEM say so; directions stay the size of the moment. */

const crypto = require('crypto');

const SYSTEM = `You are a voice director preparing a friend's spoken voice message for the Fish Audio Drama 3 text-to-speech model. It is an animated, expressive, casual conversation between best friends, not a drama script read by a voice actor: every direction stays the size of the moment, small things stay small, and nothing becomes shouting, crying or a big performance unless the words themselves are that big. You add performance markup only. You never add, remove, reorder or change a single word or punctuation mark of the message, and every [bracket] or <tag> already in it stays exactly where it is.

Markup you may add (Drama 3 syntax):
- A mid-line direction in square brackets, placed right before the words where the feeling turns, e.g. [voice catching, relieved] or [grinning, can barely keep it in]. A short two-part brief: the feeling, plus how it shows. One or two per message, only where the mood actually changes. Never at the very start of the message; it already has an opening brief. Never about speed or pace.
- One paired scope around the payoff: <emphasis>word</emphasis> for the single word a friend would lean on, or <stress>word</stress> for a contrasting pronoun. Wrap one word or a very short phrase. Most messages have one word a friend would lean on: mark it. At most one per two sentences.
- [pause] between two sentences where a beat lands right before a short payoff sentence. At most one per message.
- <soft>...</soft> around a whole closing sentence when it should be said gently. At most one.
Do not add sounds such as laughs, sighs or breaths; another step handles those.

Keep it light: Fish's own examples use one to three bracket tags and at most one paired tag per line, and none tags every sentence. Plain sentences are fine. If the message is already marked up or needs nothing, return it unchanged. Return JSON {"marked": "<the message with markup>"}.`;

const PAIRED = new Set(['emphasis', 'stress', 'soft']);
const TAG = /\[[^\]\n]*\]|<\/?[a-z]+>/gi;
const SOUND_TAG = /^(?:(?:small|soft|little|quiet|short|light|nervous|shaky|deep)\s+)?(?:laugh|laughs|laughing|chuckle|chuckles|giggle|giggles|sigh|sighs|breath|breathe|inhale|exhale|gasp|gasps|snort|sniff)$/i;
const TEMPO = /\b(?:slow(?:ly|er)?|fast(?:er)?|quick(?:ly|er)?|rapid(?:ly)?|hurr(?:ied|iedly|y)|rush(?:ed|ing)?|unhurried|pace|pacing|tempo|drawn[- ]out|speeding|breathless(?:ly)?)\b/i;

function env(name, fallback, source = process.env) {
  const v = source[name];
  return v === undefined || v === '' ? fallback : v;
}
const model = (source) => env('FISH_DIRECTOR_MODEL', 'xiaomi/mimo-v2.6-pro', source);
const viaGoogle = (source) => /^gemini-/.test(model(source));
const keyFor = (source) => (viaGoogle(source) ? source.FISH_DIRECTOR_KEY : source.OPENROUTER_KEY);
function directorOn(source = process.env) {
  return source.FISH_DIRECTOR === '1' && Boolean(keyFor(source));
}
const minChars = (source) => Number(env('FISH_DIRECTOR_MIN_CHARS', 140, source));
const timeoutMs = (source) => Number(env('FISH_DIRECTOR_TIMEOUT_MS', 3000, source));

// The words and punctuation, without tags or spacing: what must never change.
const bare = (t) => String(t).replace(TAG, '').replace(/\s+/g, '');
const tagsOf = (t) => String(t).match(TAG) || [];

/* Keep only markup we asked for. Sound and tempo directions the model added anyway are
 * dropped; a changed word, a lost tag or a broken scope rejects the whole piece. */
function vet(original, marked) {
  if (typeof marked !== 'string' || !marked.trim()) return { ok: false, reason: 'empty' };
  if (bare(marked) !== bare(original)) return { ok: false, reason: 'words changed' };
  const before = tagsOf(original);
  const after = tagsOf(marked);
  let i = 0;
  for (const tag of after) if (i < before.length && tag === before[i]) i++;
  if (i < before.length) return { ok: false, reason: 'a tag was lost' };
  // Walk the marked text, keeping the original's tags and vetting the added ones.
  const kept = [];
  let k = 0;
  let directions = 0, pauses = 0;
  const open = [];
  let text = String(marked).replace(TAG, (tag, offset) => {
    if (k < before.length && tag === before[k]) {
      k++;
      kept.push(tag);
      return tag;
    }
    if (tag[0] === '[') {
      const inner = tag.slice(1, -1).trim();
      if (SOUND_TAG.test(inner) || TEMPO.test(inner)) return ' ';
      if (/^pause$/i.test(inner)) { pauses++; return tag; }
      if (!inner || inner.length > 60 || /\d|[()<>]/.test(inner)) return 'REJECT';
      if (!String(marked).slice(0, offset).replace(TAG, '').trim()) return 'REJECT_START';
      directions++;
      return tag;
    }
    const m = tag.match(/^<(\/?)([a-z]+)>$/i);
    const name = m[2].toLowerCase();
    if (!PAIRED.has(name)) return 'REJECT';
    if (m[1]) {
      if (open.pop() !== name) return 'REJECT';
    } else {
      open.push(name);
    }
    return tag;
  });
  if (/REJECT_START/.test(text)) return { ok: false, reason: 'direction at the start' };
  if (/REJECT/.test(text) || open.length) return { ok: false, reason: 'markup outside the plan' };
  const scopes = (text.match(/<(?:emphasis|stress|soft)>/gi) || []).length - (String(original).match(/<(?:emphasis|stress|soft)>/gi) || []).length;
  if (directions > 2 || pauses > 1 || scopes > 3) return { ok: false, reason: 'too much markup' };
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').trim();
  if (bare(text) !== bare(original)) return { ok: false, reason: 'words changed' };
  return { ok: true, text, added: directions + pauses + scopes };
}

function createDirector({ fetcher = (...a) => fetch(...a), source = process.env, now = () => Date.now(), log = console.log } = {}) {
  const cache = new Map();
  const CACHE_MAX = 400;
  let pausedUntil = 0;
  let failuresInARow = 0;

  async function ask(text, previous) {
    const context = previous && previous.length ? `Said just before (context only, do not return it): ${previous.slice(-2).join(' ').slice(-400)}\n\n` : '';
    const user = `${context}Message:\n${text}`;
    const google = viaGoogle(source);
    const url = google
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model(source)}:generateContent`
      : 'https://openrouter.ai/api/v1/chat/completions';
    const body = google ? {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { marked: { type: 'STRING' } }, required: ['marked'] },
        temperature: 0.3, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 },
      },
    } : {
      model: model(source),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 0.3, max_tokens: 800,
      // MiMo's thinking must be switched off explicitly; its 'low' effort is not short.
      reasoning: { enabled: false },
      // Novita rejects a strict json_schema; json_object works on every MiMo host.
      response_format: { type: 'json_object' },
      provider: { zdr: true, data_collection: 'deny', order: ['DeepInfra'], allow_fallbacks: true },
    };
    const headers = google
      ? { 'Content-Type': 'application/json', 'x-goog-api-key': source.FISH_DIRECTOR_KEY }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${source.OPENROUTER_KEY}`, 'X-Title': 'Kade voice director' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs(source));
    try {
      const r = await fetcher(url, { method: 'POST', signal: ac.signal, headers, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = new Error(`director HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      const j = await r.json();
      if (google) return JSON.parse(j.candidates[0].content.parts[0].text).marked;
      const choice = j.choices && j.choices[0];
      // A host refusal (Novita answers 200 with content_filter) is no answer, never markup.
      if (!choice || choice.finish_reason === 'content_filter' || !choice.message || !choice.message.content) {
        throw new Error('director: no answer');
      }
      return JSON.parse(choice.message.content).marked;
    } finally {
      clearTimeout(timer);
    }
  }

  // One piece -> { text, status }. Never throws.
  async function directPiece(text, { previous } = {}) {
    const src = String(text || '');
    if (!directorOn(source)) return { text: src, status: 'off' };
    if (src.length < minChars(source)) return { text: src, status: 'short' };
    if (/["“”]/.test(src) || /^\s*(?:[-*•]|\d+[.)])\s/m.test(src)) return { text: src, status: 'read' };
    const key = crypto.createHash('sha1').update(model(source) + '\n' + src).digest('hex');
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return { text: hit, status: 'cached' };
    }
    if (now() < pausedUntil) return { text: src, status: 'paused' };
    const t0 = now();
    try {
      const verdict = vet(src, await ask(src, previous));
      failuresInARow = 0;
      if (!verdict.ok) return { text: src, status: `kept plain (${verdict.reason})`, ms: now() - t0 };
      cache.set(key, verdict.text);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return { text: verdict.text, status: verdict.added ? 'directed' : 'nothing to add', ms: now() - t0 };
    } catch (e) {
      failuresInARow++;
      // Out of credit or refused: stop asking for a while. Repeated timeouts: a short rest.
      if ([401, 402, 403, 429].includes(e.status)) pausedUntil = now() + 10 * 60 * 1000;
      else if (failuresInARow >= 3) pausedUntil = now() + 2 * 60 * 1000;
      const why = e.name === 'AbortError' ? 'timed out' : e.status ? `HTTP ${e.status}` : 'failed';
      return { text: src, status: `kept plain (${why})`, ms: now() - t0 };
    }
  }

  async function directPieces(pieces, opts = {}) {
    if (!directorOn(source)) return pieces;
    const results = await Promise.all(pieces.map(p => directPiece(p, opts)));
    const told = results.filter(r => r.status !== 'short').map(r => `${r.status}${r.ms != null ? ` ${r.ms}ms` : ''}`);
    if (told.length) log(`[TTS] director: ${told.join(', ')}`);
    return results.map(r => r.text);
  }

  return { directPiece, directPieces, cacheSize: () => cache.size };
}

module.exports = { createDirector, directorOn, vet, SYSTEM };
