'use strict';

/* Oct 17 2026 (Part 410): Kade's described-video preview opened with "Audio description by
 * Kade-AI" said about 15 times over 48 s. Measured through this proxy on her Fish voice (Drama3,
 * an inline cloned reference): the 5-word line ran on in 4 of 16 takes (18-48 s instead of about
 * 2.3 s), repeating itself or reading on into the reference recording's own words. Two-sentence
 * lines and real 5-25-word description lines never did (0 of 58). The describer guards its own
 * lines; chat voice messages ("Sure!") on reference voices went through here with no guard.
 *
 * This file measures every Fish chunk: the characters Fish is asked to SAY (the text sent, with
 * [bracket] directions and <tags> removed) against the seconds of audio it returned, and says
 * when a take ran far past its words. */

/* The limit, from logged data (Oct 18 2026; written up in the session notes of Part 411):
 * 1,021 single-chunk Fish requests from Oct 15-17 (582 voices, chat, auditions, described video)
 * plus 28 chunks from the per-chunk log line (four voices, Unhurried to Quick, short lines with
 * [small laugh] and [breathe]).
 * - Normal speech ran 0.070 s per spoken character at the median, 0.104 at the 99th percentile
 *   and 0.128 at the slowest (166 characters in 21.3 s). Short lines: "Sure!" 0.6-1.0 s; 13-21
 *   characters 1.6-2.8 s; a little sound or a pause tag added about 0.6-1.3 s.
 * - Run-ons: 32 characters in 8.4, 13.4, 18.8, 25.5-27.9 and 46.7-47.5 s; 26 in 9.2 s; 70 in
 *   25.7 s (the ~47.6 s ceiling looks like Fish's 1,024-token cap).
 * 3 s + 0.16 s per character + 1.5 s per sound or pause tag flagged none of the 1,036 normal clips
 * (the closest still had 1.39x headroom, short lines 1.89x) and all 13 run-ons. A line said
 * twice can still pass: by length alone that cannot be told from a slow read. From about 280
 * characters the limit is past that ceiling, so long chunks are never flagged (none of the 821
 * clips over 140 characters ran on). */
const LIMIT = { base: 3, perChar: 0.16, perTag: 1.5 };

const { fishPace, fishPacedText } = require('./pace');

// Little sounds and pauses take time but carry no characters.
const SOUND_TAG = /\[[^\]\n]*(?:laugh|chuckl|giggl|sigh|breath|inhale|exhale|throat|cough|gasp|snicker|snort|scoff|yawn)[^\]\n]*\]/gi;
const PAUSE_TAG = /\[(?:short |long )?pause\]/gi;

function spokenText(text) {
  return String(text || '').replace(/\[[^\]\n]*\]/g, ' ').replace(/<[^>\n]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function count(re, text) {
  return (String(text || '').match(re) || []).length;
}

// Seconds of 16-bit mono PCM, and how much of it is voiced: 10 ms windows louder than 4% of the
// clip's loud level (the same quiet test capFishPauses uses).
function pcmSeconds(pcm, sampleRate = 24000) {
  const n = Math.floor((pcm ? pcm.length : 0) / 2);
  const seconds = n / sampleRate;
  if (n < 3) return { seconds, voiced: 0 };
  const s = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + n * 2));
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const windows = Math.floor(n / win);
  if (windows < 3) return { seconds, voiced: seconds };
  const rms = new Array(windows);
  for (let w = 0; w < windows; w++) {
    let acc = 0;
    for (let i = w * win; i < (w + 1) * win; i++) acc += s[i] * s[i];
    rms[w] = Math.sqrt(acc / win);
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(windows * 0.95)] || 0;
  if (!loud) return { seconds, voiced: 0 };
  const voicedWindows = rms.filter(v => v >= loud * 0.04).length;
  return { seconds, voiced: (voicedWindows * win) / sampleRate };
}

// sentText: exactly what went to Fish (fishPacedText output). wav: the chunk's 44-byte-header WAV.
function measureFishChunk(sentText, wav, sampleRate = 24000) {
  const spoken = spokenText(sentText);
  const pcm = wav && wav.length > 44 ? wav.subarray(44) : Buffer.alloc(0);
  const { seconds, voiced } = pcmSeconds(pcm, sampleRate);
  return {
    chars: spoken.length,
    words: spoken ? spoken.split(' ').length : 0,
    sentences: count(/[.!?]+(?=\s|$)/g, spoken) || (spoken ? 1 : 0),
    sounds: count(SOUND_TAG, sentText),
    pauses: count(PAUSE_TAG, sentText),
    seconds,
    voiced,
  };
}

function runawayLimitSeconds(m) {
  return LIMIT.base + LIMIT.perChar * m.chars + LIMIT.perTag * (m.sounds + m.pauses);
}

/* FISH_RUNAWAY_GUARD: retry (the default) speaks a take that ran on once more with a fresh
 * request and fails the chunk if that one runs on too; log only measures and says so; off stops
 * the measuring entirely. */
function runawayMode() {
  const v = String(process.env.FISH_RUNAWAY_GUARD || '').trim().toLowerCase();
  return v === 'off' || v === 'log' ? v : 'retry';
}

function describeFishChunk(m, extra = {}) {
  const r = m.chars ? m.seconds / m.chars : 0;
  const parts = [`chars=${m.chars}`, `words=${m.words}`, `sentences=${m.sentences}`, `sounds=${m.sounds}`, `pauses=${m.pauses}`,
    `seconds=${m.seconds.toFixed(2)}`, `voiced=${m.voiced.toFixed(2)}`, `sPerChar=${r.toFixed(4)}`];
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  return `[TTS] fish chunk length: ${parts.join(' ')}`;
}

// One Fish take, as fishSynthesizeChunk got it back: measured against the text it was sent and
// logged. text/rate/talk are fishSynthesizeChunkOnce's own arguments (the paced text is rebuilt
// the same way; it is deterministic). Returns null when the switch is off; otherwise the
// measurement plus its limit, whether it ran on, and whether the guard wants a fresh take.
function checkTake(text, wav, { rate, talk = false, delivery, voice, sampleRate = 24000, log = console.log } = {}) {
  const mode = runawayMode();
  if (mode === 'off') return null;
  const m = measureFishChunk(fishPacedText(text, rate, { talk }), wav, sampleRate);
  const limit = runawayLimitSeconds(m);
  const ranOn = m.seconds > limit;
  log(describeFishChunk(m, { pace: fishPace(rate).name, talk: talk ? 'yes' : 'no', delivery: delivery || 'DEFAULT', voice,
    limit: limit.toFixed(2), ...(ranOn ? { ranOn: 'yes' } : {}) }));
  return { ...m, limit, ranOn, retry: ranOn && mode === 'retry' };
}

function runawayError(first, second) {
  const e = new Error(`Fish ran on twice for this chunk (${first.seconds.toFixed(1)} s, then ${second.seconds.toFixed(1)} s, ` +
    `for ${second.chars} spoken characters; the limit is ${second.limit.toFixed(1)} s), so it is not spoken`);
  e.isRunaway = true;
  return e;
}

function runawayHealth() {
  return { mode: runawayMode(), limit: `${LIMIT.base} s + ${LIMIT.perChar} s per spoken character + ${LIMIT.perTag} s per sound or pause tag` };
}

module.exports = { LIMIT, spokenText, pcmSeconds, measureFishChunk, runawayLimitSeconds, runawayMode, describeFishChunk, checkTake, runawayError, runawayHealth };
