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

/* A direction is worked one clause at a time (split on commas, semicolons, dashes, "and" and
 * "but"). A clause with no hit stays exactly as written. A clause that had a hit keeps what is
 * left only when that is a plain word or two ("hugely relieved" -> "relieved", "warm quieter" ->
 * "warm"); a leftover with a function word in it is a fragment and the whole clause goes ("not
 * excited" -> gone, never "not"; "full of excitement", "in a low voice", "a little emotional"). */
const FRAGMENT = /(?<![-\w])(?:not|no|never|without|too|less|barely|longer|trying|of|up|in|on|at|to|a|an|the|with|now|touch|hint|full|eyed|energy|speaking|sounding|sound|voice|tone|more|bit|little|slightly|very|really|so|super|getting|being|almost|somewhat|kind|sort|then|still|or|edge|key)(?![-\w])/i;
const CLAUSE_SPLIT = /(\s*[,;—–]\s*|\s+-\s+|\s+(?:and|but)\s+)/i;
// A calmed direction must not turn into a sound or a one-shot tag ("soft laugh" -> "laugh",
// "dramatic pause" -> "pause"): carried copies of it would repeat that on every later piece.
const ONE_SHOT = /^(?:(?:short|long|brief|little|small)\s+)?(?:pause|beat|emphasis|inhale|exhale|breath|breathe)s?$/i;

function calmOn(source = process.env) {
  return source.TTS_TALK_CALM === '1';
}

function calmClause(clause, engine) {
  let s = clause.replace(BIG, ' ');
  if (engine === 'inworld') s = s.replace(HUSH, ' ');
  if (s === clause) return clause;
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s.:-]+|[\s.:-]+$/g, '').trim();
  if (!/[a-zA-Z]/.test(s) || s.split(' ').length > 2 || FRAGMENT.test(s)) return '';
  return s;
}

/** One direction, conversation-sized. Returns '' when nothing worth saying is left. */
function calmDirection(direction, { engine = 'fish' } = {}) {
  const raw = String(direction ?? '');
  if (!raw.trim() || isResetTag(raw) || !isDirectionTag(raw)) return raw;
  const parts = raw.split(CLAUSE_SPLIT); // even indices are clauses, odd ones the separators
  let changed = false;
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const kept = calmClause(parts[i], engine);
    if (kept !== parts[i]) changed = true;
    if (!kept.trim()) continue;
    out += (out ? parts[i - 1] : '') + kept;
  }
  if (!changed) return raw;
  out = out.trim();
  if (!/[a-zA-Z]/.test(out) || !isDirectionTag(out) || ONE_SHOT.test(out)) return '';
  return out;
}

/** Every direction bracket in a piece of text, conversation-sized. Sounds and [reset] stay.
 *  Only a space or tab after an emptied bracket goes with it; a line break always stays. */
function calmTags(text, { engine = 'fish' } = {}) {
  return String(text ?? '').replace(/\[([^\]\n]{1,300})\]([ \t]?)/g, (whole, inner, gap) => {
    const calmed = calmDirection(inner, { engine });
    if (calmed === inner) return whole;
    return calmed ? `[${calmed}]${gap}` : '';
  });
}

module.exports = { calmOn, calmDirection, calmTags, BIG, HUSH };
