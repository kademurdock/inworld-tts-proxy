'use strict';
/* Part 236 (Sep 20 2026). Jev is TypeSafe's decision model: it takes state
 * plus typed questions (choice / noul / score) and returns probabilities, no
 * prose. Same helper the reframe proxy shipped the same day, carried here for
 * the two judgments this service makes with word lists: is a loose "(span)" a
 * stage direction or words to say, and which picker section a reported voice
 * belongs in.
 *
 * The contract every caller keeps: Jev is a second opinion, never the only
 * road. ask() THROWS on any failure and the caller does exactly what it did
 * before Jev existed. With TYPESAFE_API_KEY unset nothing here is ever called.
 * The version is pinned; jev-latest moves under you.
 * Kill: KADE_JEV=0, or unset TYPESAFE_API_KEY. Per feature:
 * KADE_JEV_LOOSE=0 (stage directions), KADE_JEV_VOICEMOVE=0 (shadow log). */
const URL = process.env.KADE_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.KADE_JEV_MODEL || 'jev-1.13.0';
const counts = { ok: 0, failed: 0 };

/* The key is read at call time, not at require time, so a test (or a trial
 * script) can set or clear it without re-requiring the module. */
function enabled(flag) {
  return !!process.env.TYPESAFE_API_KEY && process.env.KADE_JEV !== '0' && (!flag || process.env[flag] !== '0');
}

async function ask(state, questions, timeoutMs = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(URL, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: MODEL, questions }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || typeof j.answers !== 'object' || !j.answers) throw new Error('no answers');
    counts.ok++;
    return { answers: j.answers, usage: j.usage || null, model: j.model || MODEL };
  } catch (e) {
    counts.failed++;
    throw new Error(e.name === 'AbortError' ? `timeout ${timeoutMs}ms` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

/* ── loose stage directions ──────────────────────────────────────────────────
 * One choice question per span, all in one request (they run in parallel, so
 * six spans cost the same wall time as one). The state carries the span AND
 * the line it sits in, because the line is the whole answer: "(warm)" after
 * "serve it" is a word to say, "(warm)" opening a line is how to say it.
 * Wording below is the wording the labelled trial was run against; change it
 * and the trial has to be run again (scratchpad jev_loose_trial.js). */
const LOOSE_LABELS = ['delivery', 'timing', 'physical', 'silent', 'spoken'];
function looseQuestion(i) {
  return { type: 'choice',
    instructions: 'A text-to-speech voice is about to read `items[' + i + '].line` aloud. Inside it, the bracketed fragment `items[' + i + '].span` is either a stage direction for the performer (which must NOT be read aloud) or part of the words the listener should hear. Which is it?',
    criteria: {
      delivery: 'A stage direction about HOW the speaker performs this line right now: their tone, emotion, mood, manner or a vocal sound they make. Examples: slightly amused, quietly furious, voice cracking, laughs softly, trying not to laugh.',
      timing: 'A stage direction that is only a pause, a beat, a silence or waiting.',
      physical: 'A stage direction describing a bodily action, gesture, movement or facial expression the SPEAKER makes while talking. Examples: rolls eyes, adjusts glasses, taps the table. Not an action of some other person, animal or object the sentence is about.',
      silent: 'A stage direction for a wordless moment that makes no sound at all: nods, shrugs, looks away.',
      spoken: 'Literal content the listener should hear as words: an aside, a clarification, an example, an abbreviation or acronym, a measurement or amount, a name or title, a relationship, an alternative, an instruction to the listener, an emphasised word, or a description of a person, animal or thing the sentence is ABOUT (its temperature, mood, state or what it was doing) rather than of the speaker.',
    } };
}

/* items: [{ span, line }]. Returns one { label, confidence, probabilities }
 * per item, same order. Throws if any answer is missing or malformed: a
 * half-read reply is a failed reply. */
async function looseDirections(items, timeoutMs = 600) {
  const questions = {};
  items.forEach((_, i) => { questions['s' + i] = looseQuestion(i); });
  const { answers } = await ask({ items }, questions, timeoutMs);
  return items.map((_, i) => {
    const a = answers['s' + i];
    if (!a || !LOOSE_LABELS.includes(a.choice) || typeof a.confidence !== 'number') throw new Error('bad loose answer');
    return { label: a.choice, confidence: a.confidence, probabilities: a.probabilities || {} };
  });
}

/* ── voice section (SHADOW ONLY, see voice-moves.js) ─────────────────────────
 * sections is the list of picker section names the regex cascade chooses
 * between; the names describe themselves ("Women, soft and breathy"), so they
 * ride as options with no description. */
async function voiceSection(input, sections, timeoutMs = 4000) {
  const criteria = {};
  for (const s of sections) criteria[s] = null;
  const q = { type: 'choice',
    instructions: 'A listener says the voice described by `label` (and `description`, when present) is filed in the wrong section of a voice picker; `report` is what they said it sounds like, and `filedUnder` is where it is now. Which section should this voice be filed under?',
    criteria };
  const { answers } = await ask(input, { section: q }, timeoutMs);
  const a = answers.section;
  if (!a || !sections.includes(a.choice)) throw new Error('bad section answer');
  return { section: a.choice, confidence: a.confidence };
}

module.exports = { enabled, ask, looseDirections, looseQuestion, voiceSection, counts, MODEL, LOOSE_LABELS };
