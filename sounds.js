/* ── sounds.js — what Inworld actually treats as a SOUND, and lifting the
 *    steering direction out of the text into its own field ──────────────────
 * Part 92.14 (Aug 24 2026). Her word: "work on the thing that retires the whole
 * class instead of guarding it."
 *
 * THE CLASS BEING RETIRED. On build 241 two of twenty-nine synthesis calls for
 * one reply carried nothing but a steering direction, and Inworld hard-rejects
 * those — verified live against the real API:
 *     400 "text contains only a bracketed speaking-style instruction and no
 *          words to speak"
 * The app turned the empty result into an error tone and she heard it in the
 * middle of her reply. Build 242 stops the app EMITTING such a piece. This
 * makes the piece IMPOSSIBLE: a direction that is not in the text can never be
 * alone in the text.
 *
 * `POST /tts/v1/voice` — the endpoint this proxy already calls — takes a
 * request-level `instruction` field on inworld-tts-2. Verified live, same
 * sentence both ways:
 *     inline "[settling in…] Somebody born in…"  -> 200, billed 161 characters
 *     text + instruction field                   -> 200, billed  97 characters
 * And the failing case becomes harmless rather than fatal:
 *     text:"" + instruction                      -> 200, zero-byte audio, no 400
 *
 * ⭐ AND IT IS CHEAPER, WHICH NOBODY WAS COUNTING. Inworld bills PROCESSED
 * CHARACTERS, and an inline tag is processed characters. Her real build-241
 * reply sent 5,400 characters across 28 chunks, of which **1,642 — THIRTY
 * PERCENT — were steering tags**, because a direction is carried onto every
 * chunk of its paragraph. A third of the TTS bill on that message was spent on
 * text nobody ever hears.
 *
 * ⚠️⚠️ THE PREREQUISITE BUG, FOUND ON THE WAY AND WORSE THAN THE ONE I CAME
 * FOR. The old NONVERBAL_TAGS held SIX tags — laugh, breathe, clear throat,
 * sigh, cough, yawn — while Inworld recognizes about FIFTY. Everything outside
 * those six was classified as a DIRECTION by this proxy, and directions are
 * CARRIED FORWARD onto every following paragraph. So `%%%gasp%%%` did not gasp
 * once: it was pinned to the front of every remaining chunk. The code's own
 * comment warns about exactly this ("carrying 'laugh' would make her laugh
 * through the whole reply") — the list was just too short to keep the promise.
 * Kade named several of the missing ones from memory: "it can crack, it can
 * hock and spit and snort."
 *
 * Source: https://docs.inworld.ai/tts/capabilities/steering — "Which one a
 * bracket becomes is decided entirely by the list below: if the tag names a
 * recognized sound, it is a non-verbal; anything else in brackets is treated
 * as an instruction."
 */

/** Inworld's recognized non-verbal sounds, by category, verbatim from the docs. */
const CANONICAL_SOUNDS = [
  // Breath and effort
  'breathe', 'sigh', 'gasp', 'pant', 'huff', 'grunt', 'groan', 'moan',
  // Laughter
  'laugh', 'chuckle', 'giggle', 'cackle', 'snort', 'scoff',
  // Distress
  'cry', 'sob', 'wail', 'whimper', 'whine', 'sniffle', 'sniff', 'shriek', 'squeal', 'howl',
  // Throat and chest
  'clear throat', 'cough', 'sneeze', 'hiccup', 'yawn', 'burp', 'snore', 'choke', 'gag',
  'swallow', 'gulp', 'spit',
  // Mouth
  'tongue click', 'mouth click', 'mouth sound', 'lip smack', 'kiss', 'shush', 'raspberry',
  'whistle', 'bleh',
  // Eating and drinking
  'chew', 'slurp',
  // Other
  'babble', 'beatbox', 'growl',
];

/* ⚠️ NOT SOUNDS, AND THE DOCS CALL THIS OUT SPECIFICALLY: [shout], [scream],
 * [sing], [hum] and [mumble] describe HOW WORDS ARE SPOKEN, so Inworld treats
 * them as instructions — and an instruction PERSISTS until changed. They must
 * stay on the direction side of this fence or a single [shout] shouts the rest
 * of the reply. */
const NOT_SOUNDS = new Set(['shout', 'scream', 'sing', 'hum', 'mumble']);

/* ⭐ [reset] — Aug 25 2026, Kade's "it read the whole voice clip in a really
 * fast, rushed tone and pace... it seemed to make it follow through the whole
 * message." Inworld's own tag for ENDING a styled passage, and the one piece of
 * the steering vocabulary this platform has never used:
 *
 *   "[reset] removes the active instruction for the rest of the text... It
 *    removes the instruction, not the voice... which is exactly why it is not
 *    called [neutral]."   — docs.inworld.ai/tts/capabilities/steering
 *
 * It is NOT a sound and it must NOT be treated as an ordinary direction, and
 * the difference is load-bearing. An ordinary leading direction is LIFTED out
 * of the text into the request-level `instruction` field by liftInstruction
 * below. Lifting [reset] would send the literal string "reset" as a delivery
 * instruction — a nonsense direction handed to the synthesizer at the exact
 * moment the author asked for the direction to STOP. The docs are explicit
 * that clearing the field is an INLINE act: "[reset] — Normal — clears an
 * instruction set by the instruction request field."
 *
 * So reset stays in the text. Always. */
const RESET_TAG = 'reset';

/** True when this bracket is Inworld's [reset] — end the active instruction. */
function isResetTag(inner) {
  return normalizeTag(inner) === RESET_TAG;
}

/** Docs: "Matching ignores case, spacing, and punctuation, and accepts common
 *  inflections, so [Clear Throat], [clear_throat], [clears throat] and
 *  [throat clearing] all resolve to the same sound." Variants are enumerated
 *  rather than stemmed — a crude stemmer turns "whistle" into "whist". */
function variantsOf(tag) {
  const words = tag.split(' ');
  const out = new Set();
  const infl = (w) => {
    const v = [w];
    v.push(w.endsWith('s') ? w : w + 's');
    v.push(w.endsWith('e') ? w.slice(0, -1) + 'ing' : w + 'ing');
    v.push(w.endsWith('e') ? w + 'd' : w + 'ed');
    return v;
  };
  if (words.length === 1) {
    for (const v of infl(words[0])) out.add(v);
  } else {
    const [a, b] = words;
    for (const v of infl(a)) out.add(`${v} ${b}`);
    // reversed: "clear throat" -> "throat clearing"
    for (const v of infl(a)) out.add(`${b} ${v}`);
  }
  return out;
}

const SOUND_SET = new Set();
for (const t of CANONICAL_SOUNDS) for (const v of variantsOf(t)) SOUND_SET.add(v);

/** Case, spacing and punctuation are all ignored. */
function normalizeTag(inner) {
  return String(inner == null ? '' : inner).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/** True when this bracket names a sound Inworld will perform at that point. */
function isNonVerbalSound(inner) {
  const n = normalizeTag(inner);
  if (!n || NOT_SOUNDS.has(n)) return false;
  return SOUND_SET.has(n);
}

/** True when this bracket is a speaking-style instruction (anything else). */
function isDirectionTag(inner) {
  return !isNonVerbalSound(inner);
}

const LEADING_TAG = /^\s*\[([^\]]{1,300})\]\s*/;

/**
 * Lift a chunk's LEADING steering direction out of the text and into the value
 * for Inworld's request-level `instruction` field.
 *
 * Only the leading one, and only when it is a direction — a SOUND stays exactly
 * where it was written, because a non-verbal is an event at a point in the text
 * and moving it would move the sound.
 *
 * Mid-text directions are also left alone on purpose: per the docs an inline
 * tag overrides the field from where it appears, so leaving them inline is
 * correct and needs no special handling.
 *
 * @returns {{text: string, instruction: string|null}}
 */
function liftInstruction(chunk) {
  const s = String(chunk == null ? '' : chunk);
  const m = LEADING_TAG.exec(s);
  if (!m) return { text: s, instruction: null };
  const inner = m[1].trim();
  if (!isDirectionTag(inner)) return { text: s, instruction: null };
  /* [reset] is a direction by the docs' fence, but it is the one direction that
   * must never leave the text — see RESET_TAG above. Lifting it would set the
   * instruction to "reset" instead of clearing it. */
  if (isResetTag(inner)) return { text: s, instruction: null };
  const rest = s.slice(m[0].length);
  // Never hand back text with nothing in it while claiming success — the caller
  // decides what to do with a wordless chunk, and it already has a rule for it.
  return { text: rest, instruction: inner };
}

module.exports = {
  CANONICAL_SOUNDS, NOT_SOUNDS, SOUND_SET, RESET_TAG,
  normalizeTag, isNonVerbalSound, isDirectionTag, isResetTag, liftInstruction, LEADING_TAG,
};
