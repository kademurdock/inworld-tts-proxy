'use strict';
/* Nov 5 2026 — TEMPO-NEUTRAL STEERING. Kade: Inworld voices keep "slowing down and speeding up".
 *
 * What the audio showed. Nearly every feeling word used as Inworld's `instruction` slows the voice, by
 * very different amounts. The same two sentences in three voices, BALANCED, one word as the direction
 * against none, six clips per word (clip length with the word / length without; Praat intensity, no
 * transcript needed):
 *     bright .97 · upbeat 1.00 · encouraging 1.01 · excited 1.03 · amused 1.07 · pleased 1.08 · curious 1.11
 *     calm 1.13 · fond 1.17 · delighted 1.22 · thoughtful 1.25 · nostalgic 1.31 · uneasy 1.50 · uncertain 1.56
 *     hesitant 1.61 · sleepy 1.69
 * and the slow ones bring long stops with them (sleepy: 15 stops of 600 ms or more in six clips, against
 * 4 with no direction). Characters write a direction on three messages in four, so a 'hesitant' paragraph
 * beside an 'encouraging' one runs half again as long. That swing, between paragraphs and between
 * messages, is the speeding up and slowing down. It costs nothing in expression that could be measured
 * (pitch spread 4.6 vs 4.7 semitones, loudness spread 6.6 vs 6.7 dB, direction vs none).
 *
 * The fix keeps the feeling and cancels the clock. `speakingRate` (0.5 to 1.5) is Inworld's own pace
 * control, rendered natively, not a stretch. A direction's request is sent at the listener's rate times
 * the direction's measured cost, capped at MAX_BOOST (x1.25) so no voice is asked to race. Twenty
 * sentences, four voices, the character's own direction on BALANCED: 180 words a minute alone, 201 with
 * the lift, against 206 with no direction at all; blind judged against today's CREATIVE delivery the
 * lift won 19 to 1, BALANCED alone 12 to 2.
 *
 * A direction's cost: a phrase measured as a whole, else the blend of the largest and the average cost
 * of its known words (measured on 33 held-out real phrases: within 0.09, no bias); a direction with no
 * known word costs FALLBACK (x1.12, the average of real use); modifiers ('a little', 'mildly') are
 * ignored. The listener's own speed is never touched when nothing is steered.
 *
 * Chat speech only (server.js decides). INWORLD_STEER_RATE=1 turns it on; INWORLD_STEER_MAX_BOOST and
 * INWORLD_STEER_DEFAULT move the cap and the fallback without a deploy. The table is a measurement:
 * to add a word, render it against none (survey method above) and add its ratio. */
const { isDirectionTag, isResetTag } = require('./sounds');

// Clip length with this one word as the direction / without any, BALANCED (Nov 5 2026 survey).
const WORDS = {
  affectionate: 1.18, alert: 1.2, amazed: 1.27, amused: 1.07, angry: 1.1, annoyed: 1.1, anxious: 1.17,
  apologetic: 1.1, attentive: 1.25, baffled: 1.36, bored: 1.45, bright: 1.0, calm: 1.13, careful: 1.65,
  cautious: 1.27, chatty: 1.0, cheerful: 1.04, concerned: 1.12, confused: 1.45, conspiratorial: 1.16, content: 1.09,
  curious: 1.11, deadpan: 1.65, delighted: 1.22, determined: 1.07, disappointed: 1.28, distracted: 1.49,
  dreamy: 1.29, dry: 1.23, eager: 1.03, earnest: 1.1, embarrassed: 1.18, encouraged: 1.09, encouraging: 1.01,
  enthusiastic: 1.04, exasperated: 1.17, excited: 1.03, expectant: 1.17, firm: 1.1, flat: 1.36, flustered: 1.06,
  focused: 1.16, fond: 1.17, friendly: 1.0, frustrated: 1.08, gentle: 1.33, grateful: 1.22, happy: 1.03,
  harried: 1.03, hesitant: 1.61, hopeful: 1.15, impatient: 1.34, impressed: 1.13, indignant: 1.11, interested: 1.17,
  intrigued: 1.1, lighthearted: 1.06, mellow: 1.36, mischievous: 1.11, nervous: 1.23, nostalgic: 1.31,
  observant: 1.22, overjoyed: 1.28, patient: 1.87, pensive: 1.4, playful: 1.14, pleased: 1.08, polite: 1.04,
  practical: 1.05, preoccupied: 1.17, proud: 1.11, puzzled: 1.35, quiet: 1.3, reassuring: 1.21, reflective: 1.16,
  regretful: 1.24, relieved: 1.1, resigned: 1.2, restless: 1.37, rueful: 1.51, sad: 1.48, sarcastic: 1.21,
  serious: 1.2, settled: 1.21, sheepish: 1.25, sincere: 1.26, skeptical: 1.17, sleepy: 1.69, smug: 1.12, soft: 1.3,
  startled: 1.18, steady: 1.22, stern: 1.21, surprised: 1.26, suspicious: 1.22, sympathetic: 1.22, teasing: 1.12,
  tender: 1.22, tentative: 1.4, thinking: 1.3, thoughtful: 1.25, tired: 1.42, touched: 1.2, unbothered: 1.33,
  uncertain: 1.56, uncomfortable: 1.23, uneasy: 1.5, unsettled: 1.57, upbeat: 1.0, warm: 1.08, wary: 1.49,
  weary: 1.28, wistful: 1.24, worried: 1.36
};

// Whole phrases measured as written, the way characters write them (they beat the word rule).
const PHRASES = {
  "a little concerned": 1.19, "a little wary": 1.27, "amused and a little embarrassed": 1.14,
  "bright and interested": 1.0, "calm and matter of fact": 1.15, "curious and a little in historian mode": 1.11,
  "delighted and surprised": 1.25, "fond and exasperated": 1.24, "fond and tired": 1.29, "gentle and sincere": 1.32,
  "gentle and steady": 1.33, "grateful and a little shy about it": 1.28, "grinning audibly": 1.14,
  "grudgingly amused": 1.35, "happy and a little unsure": 1.11,
  "interested like she's leaning into a good question": 1.13, "matter of fact": 1.11,
  "matter of fact with a little caution": 1.13, "mildly annoyed": 1.25, "mock exasperated": 1.26,
  "mock outraged": 1.34, "nervous and hopeful": 1.14, "reading it over dry": 1.41,
  "relieved and a little shaky": 1.28, "resigned and amused": 1.22, "sharp and interested": 1.01,
  "sheepish and friendly": 1.17, "steady and direct": 1.12, "steady and straight with him": 1.13,
  "straight up a little regretful": 1.06, "straightforward and honest": 1.0, "straightforward and ready": 1.01,
  "thinking out loud": 1.54, "thoughtful not panicking": 1.26, "unsettled and amused": 1.49, "warm and easy": 1.05,
  "warm and friendly": 1.11, "warm and unbothered": 1.1, "warm thinking with her": 1.15,
  "worried and trying not to be": 1.41, "wry a little grim": 1.14
};

const STOP = new Set(('a an the and or but with of in on at to like not no little bit slightly somewhat very really kind sort just out up '
  + 'her his their my your she he they it is as for from by him them us we me so too trying be get got into leaning good question mode '
  + 'historian straight mildly almost still quite pretty rather also then now more less about how what that this').split(' '));

function num(v, fallback) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

function steerSettings(source = process.env) {
  return {
    on: source.INWORLD_STEER_RATE === '1',
    maxBoost: Math.min(1.5, Math.max(1, num(source.INWORLD_STEER_MAX_BOOST, 1.25))),
    fallback: Math.min(1.5, Math.max(1, num(source.INWORLD_STEER_DEFAULT, 1.12))),
  };
}

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Expected clip length with this direction over the length without it (1 or more). */
function directionCost(direction, settings = steerSettings()) {
  const d = norm(direction);
  if (!d) return 1;
  if (Object.prototype.hasOwnProperty.call(PHRASES, d)) return PHRASES[d];
  const words = (d.match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return 1;
  const known = words.filter((w) => Object.prototype.hasOwnProperty.call(WORDS, w)).map((w) => WORDS[w]);
  if (!known.length) return settings.fallback;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  return (Math.max(...known) + mean) / 2;
}

/** Every direction a request carries: its instruction, and any [direction] left inline in the words. */
function directionsOf(instruction, text) {
  const out = [];
  if (instruction) out.push(String(instruction));
  for (const m of String(text == null ? '' : text).matchAll(/\[([^\]\n]{1,300})\]/g)) {
    if (isDirectionTag(m[1]) && !isResetTag(m[1])) out.push(m[1]);
  }
  return out;
}

/** The factor to raise the speaking rate by (1 when nothing is steered, never over maxBoost). */
function steerFactor(instruction, text, settings = steerSettings()) {
  const dirs = directionsOf(instruction, text);
  if (!dirs.length) return 1;
  return Math.min(settings.maxBoost, Math.max(1, ...dirs.map((d) => directionCost(d, settings))));
}

/** The speaking rate to send: the listener's, raised by what the steering costs. Inworld's limit is 1.5. */
function steeredRate(rate, instruction, text, settings = steerSettings()) {
  if (!settings.on) return rate;
  const f = steerFactor(instruction, text, settings);
  return f > 1.005 ? Math.min(1.5, Math.round(rate * f * 1000) / 1000) : rate;
}

module.exports = { steerSettings, directionCost, directionsOf, steerFactor, steeredRate, WORDS, PHRASES };
