'use strict';
/* Nov 12 2026 — TALKING, NOT AUDITIONING. Kade: the Inworld voices "constantly sound like they're acting up a voiceover
 * audition ... I want them to sound like an unscripted person having a conversation with a friend, no matter what voice
 * it is." Speed and stops were already right (inworld-steer.js, inworld-pauses.js); this is the delivery itself.
 *
 * What the audio showed (her own recent Kiana and Lilly replies cut into the pieces her phone sends, rendered through
 * this server with the production settings and real Inworld; blind paired judging by xiaomi/mimo-v2.6-pro, both orders,
 * with MiMo Flash as a second ear; both judges first passed a planted voiceover read and a planted monotone):
 *   - the live delivery (Lively, the character's own direction or none) was heard as "projected", "announcer-like",
 *     "like a voice actor reading a script" next to the same words framed as a conversation;
 *   - calm conversational wordings ("relaxed", "casually") and Inworld's own Reasoning sounded more unscripted but
 *     flatter: the same trade as Balanced, which Kade called too flat on Nov 6;
 *   - FRAME below was the one wording ahead of live on both counts in every round and with both judges: more unscripted
 *     (58% and 54% of pairs, 53% with Flash) and more alive (62%, 61%, Flash 62%); on pieces with no direction of their
 *     own 61% and 86%. It costs no speed and no billed characters (the instruction field is not billed), and in 144
 *     transcribed clips no word of it was ever spoken.
 *   - Balanced with the frame, the frame put first, and the frame instead of the character's direction did no better.
 *
 * Chat speech only (server.js decides what talks: never reading, STABLE, books, scenes, described video). Switches:
 *   INWORLD_TALK_DELIVERY=frame  turns it on; unset, anything else, or KADE_TTS_INSTRUCTION_FIELD=0 = off, exactly as
 *                                before (the frame rides the instruction field, so it goes when the field goes).
 *   INWORLD_TALK_FRAME           the wording (brackets, percent signs and control characters are cleaned out).
 *   INWORLD_TALK_FRAME_MERGE     merge (default): "<character's direction>, <frame>"; after: frame first; replace: the
 *                                frame instead of the character's direction; bare: the frame only when there is none.
 *   INWORLD_TALK_LIFT            multiplies the speaking rate of a framed piece (0.8 to 1.3; default 1, measured).
 * A [reset] that opens a piece (the proxy's carry ending) is dropped: the frame in the instruction field already is the
 * "back to normal" state, and Inworld's [reset] would clear it before the first word. Directions later in a piece are
 * left as the character wrote them.
 * A refused framed request is asked once more exactly as before (server.js); five refusals in ten minutes turn the frame
 * off for thirty, so a change on Inworld's side costs one extra call a piece for minutes, not for days (/health shows it).
 */
const { isResetTag } = require('./sounds');

const DEFAULT_FRAME = 'talking with a close friend on the phone, animated and natural, just chatting, not performing';
const FRAME_MAX = 200;
const BREAKER = { refusals: 5, windowMs: 10 * 60 * 1000, offMs: 30 * 60 * 1000 };

const stats = { shaped: 0, refused: 0 };
let refusals = [];
let offUntil = 0;

function num(v, fallback) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

/** One clean line: no brackets (a ']' would end an inline tag and the rest would be spoken), no %, no controls. */
function cleanFrame(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f[\]%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FRAME_MAX).trim();
  return /\p{L}/u.test(s) ? s : '';
}

function talkSettings(env = process.env, now = Date.now()) {
  const merge = String(env.INWORLD_TALK_FRAME_MERGE || '').trim().toLowerCase();
  const on = String(env.INWORLD_TALK_DELIVERY || '').trim().toLowerCase() === 'frame' && env.KADE_TTS_INSTRUCTION_FIELD !== '0';
  return {
    mode: on && now >= offUntil ? 'frame' : 'off',
    frame: cleanFrame(env.INWORLD_TALK_FRAME) || DEFAULT_FRAME,
    frameMerge: ['merge', 'after', 'replace', 'bare'].includes(merge) ? merge : 'merge',
    lift: Math.min(1.3, Math.max(0.8, num(env.INWORLD_TALK_LIFT, 1))),
  };
}

/**
 * The instruction for one chat piece. `direction` is the character's own (after talk-calm and the steering drop), or null.
 * Returns { instruction, shaped }: shaped means this module changed what is sent.
 */
function shapeTalk(direction, settings = talkSettings()) {
  const dir = String(direction == null ? '' : direction).replace(/\s+/g, ' ').trim() || null;
  if (settings.mode !== 'frame') return { instruction: dir, shaped: false };
  const frame = settings.frame;
  if (!dir) return { instruction: frame, shaped: true };
  if (settings.frameMerge === 'bare' || dir.toLowerCase().includes(frame.toLowerCase())) return { instruction: dir, shaped: false };
  if (settings.frameMerge === 'replace') return { instruction: frame, shaped: true };
  return { instruction: settings.frameMerge === 'after' ? `${frame}, ${dir}` : `${dir}, ${frame}`, shaped: true };
}

/** The words as Inworld should get them: only a [reset] that opens the piece goes (frame on); nothing else moves. */
function talkText(text, settings = talkSettings()) {
  const s = String(text == null ? '' : text);
  if (settings.mode !== 'frame' || settings.frameMerge === 'bare' || !s.includes('[')) return s;
  return s.replace(/^(\s*)\[([^\]\n]{1,300})\][ \t]*/, (whole, lead, inner) => (isResetTag(inner) ? lead : whole));
}

/**
 * The direction whose measured cost (inworld-steer.js) a framed piece's speaking rate carries: the character's own only
 * while it still leads the instruction (merge). Measured on 64 tagged pieces in four voices: with the direction first the
 * lift kept pace within 5% of live; with the frame first or the direction left out, the same lift ran 10% fast.
 */
function liftDirection(direction, settings = talkSettings()) {
  return settings.mode === 'frame' && settings.frameMerge === 'merge' ? (String(direction == null ? '' : direction).trim() || null) : null;
}

function noteShaped() { stats.shaped++; }

/** A framed request Inworld refused. Returns true when this refusal turned the frame off for a while. */
function noteRefused(now = Date.now()) {
  stats.refused++;
  refusals = refusals.filter((t) => now - t < BREAKER.windowMs).concat(now);
  if (refusals.length >= BREAKER.refusals && now >= offUntil) {
    offUntil = now + BREAKER.offMs;
    refusals = [];
    return true;
  }
  return false;
}

function talkHealth(env = process.env, now = Date.now()) {
  const s = talkSettings(env, now);
  const asked = String(env.INWORLD_TALK_DELIVERY || '').trim().toLowerCase() === 'frame';
  return { mode: s.mode, asked: asked ? 'frame' : 'off', frame: s.frame, frameMerge: s.frameMerge, lift: s.lift, ...stats,
    offForMinutes: now < offUntil ? Math.ceil((offUntil - now) / 60000) : 0 };
}

function _resetForTests() { stats.shaped = 0; stats.refused = 0; refusals = []; offUntil = 0; }

module.exports = { talkSettings, shapeTalk, talkText, liftDirection, noteShaped, noteRefused, talkHealth, cleanFrame,
  DEFAULT_FRAME, FRAME_MAX, BREAKER, _resetForTests };
