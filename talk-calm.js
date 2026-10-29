'use strict';
/* Oct 29 2026 — CONVERSATION-SIZED DIRECTIONS. Kade: Fish voices are "too over the top
 * expressive ... just getting too excited or emotional", Inworld is "pausing a lot more", and
 * "These are supposed to be chars having a live conversation with someone, not auditioning for a
 * drama."
 *
 * What the logs and a 156-clip measurement showed: the voice director and the Inworld writer
 * keep their own markup small, but the CHARACTERS write their own directions and those go to the
 * engines untouched ("fond and a little emotional", "soft and steady low"). The writer's brief is
 * already cleaned of big and slowing words (inworld-writer.js vetInstruction); a character's own
 * direction skipped that. On Inworld a hushed direction (soft, quiet, low, gentle) stretched
 * every stop: clips ran 20-70% longer, with 1.5-3 stops of 0.8 s or more each against none.
 *
 * So on the talk path only (chat replies and conversation auditions, never reading, STABLE,
 * described video or books), every direction tag keeps its feeling and loses the size:
 *   - both engines: big words go ("excited and emotional, a little teary" -> nothing left,
 *     "fond and a little emotional" -> "fond");
 *   - Inworld only: hush words go too ("warm quieter" -> "warm", "soft and steady low" ->
 *     "steady").
 * A direction with nothing left leaves no bracket, so the casual brief or the writer's brief
 * takes its place. Sounds ([laughs], [small laugh]) and [reset] are never touched.
 * Switch: TTS_TALK_CALM=1 turns it on; anything else leaves directions as they were. */
const { isDirectionTag, isResetTag } = require('./sounds');

// Hyphenated words keep their halves: "low-key" and "soft-spoken" are not hush words.
const BIG = new RegExp('(?<![-\\w])(?:' + [
  'excit\\w*', 'thrill\\w*', 'ecstatic\\w*', 'elat\\w*', 'overjoyed', 'euphoric', 'giddy',
  'hyped', 'fired up', 'pumped', 'bursting', 'burst\\w*', 'gush\\w*', 'squeal\\w*', 'exclaim\\w*',
  'emotional(?:ly)?', 'teary', 'tearful(?:ly)?', 'tearing up', 'in tears', 'crying', 'cries',
  'sob(?:s|bing|bed)?', 'weep\\w*', 'choked(?: up)?', 'choking up', 'voice (?:cracking|breaking)',
  'trembl\\w*', 'shaky', 'shaking', 'quivering',
  'shout\\w*', 'yell\\w*', 'scream\\w*', 'loud(?:ly|er)?', 'booming',
  'overwhelm\\w*', 'devastat\\w*', 'heartbroken', 'shattered', 'desperat\\w*', 'furious\\w*',
  'frantic\\w*', 'hysteric\\w*', 'intens\\w*', 'passionat\\w*', 'dramatic\\w*', 'theatrical\\w*',
  'explosive\\w*', 'wild\\w*', 'fierce\\w*', 'urgent\\w*', 'raw',
  'hugely', 'extremely', 'incredibly', 'utterly', 'absolutely', 'totally', 'completely',
  'beside (?:herself|himself|themselves|yourself)',
].join('|') + ')(?![-\\w])', 'gi');

const HUSH = new RegExp('(?<![-\\w])(?:' + [
  'soft(?:ly|er|en\\w*)?', 'quiet(?:ly|er)?', 'low(?:er)?', 'gentl[ey]', 'gentler',
  'hush\\w*', 'whisper\\w*', 'murmur\\w*', 'subdued', 'barely audible',
  'under (?:her|his|their|my|your) breath', 'tender(?:ly)?',
].join('|') + ')(?![-\\w])', 'gi');

// Words that mean nothing once the word they qualified is gone.
const LEFTOVER = /^(?:and|but|then|still|with|a|an|the|very|really|so|super|more|less|a little|a bit|slightly|kind of|sort of|somewhat|almost|getting|being|sounding|voice|tone)$/i;

function calmOn(source = process.env) {
  return source.TTS_TALK_CALM === '1';
}

function tidy(s) {
  let out = String(s)
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s*,\s*){2,}/g, ', ')
    .replace(/\b(?:and|but|or)\s*(?=,|$)/gi, '')
    .replace(/(?:^|,)\s*(?:and|but|or)\b/gi, m => (m.trim().startsWith(',') ? ',' : ''));
  // Qualifiers and connectives left hanging at either end, or alone between commas.
  for (let i = 0; i < 4; i++) {
    out = out
      .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, '')
      .replace(/^(?:and|but|then|still|with|or)\s+/i, '')
      .replace(/\s+(?:and|but|then|with|or|a|an|the|very|really|so|super|more|a little|a bit|slightly|kind of|sort of|somewhat|almost)$/i, '')
      .replace(/(^|,\s*)(?:a little|a bit|slightly|very|really|so|super|kind of|sort of|somewhat)\s*(?=,|$)/gi, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  out = out.split(/\s*,\s*/).filter(p => p && !LEFTOVER.test(p)).join(', ');
  if (!/[a-zA-Z]/.test(out) || LEFTOVER.test(out)) return '';
  return out;
}

/** One direction, conversation-sized. Returns '' when nothing worth saying is left. */
function calmDirection(direction, { engine = 'fish' } = {}) {
  const raw = String(direction ?? '');
  if (!raw.trim() || isResetTag(raw) || !isDirectionTag(raw)) return raw;
  let s = raw.replace(BIG, ' ');
  if (engine === 'inworld') s = s.replace(HUSH, ' ');
  if (s === raw) return raw;
  return tidy(s);
}

/** Every direction bracket in a piece of text, conversation-sized. Sounds and [reset] stay. */
function calmTags(text, { engine = 'fish' } = {}) {
  return String(text ?? '').replace(/\[([^\]\n]{1,300})\]\s?/g, (whole, inner) => {
    const calmed = calmDirection(inner, { engine });
    if (calmed === inner) return whole;
    return calmed ? `[${calmed}]${whole.endsWith(' ') ? ' ' : ''}` : '';
  });
}

module.exports = { calmOn, calmDirection, calmTags, BIG, HUSH };
