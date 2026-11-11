'use strict';
/* Nov 11 2026 — THE TIMING TRACK. Inworld TTS-2 can say, for free, which mouth shape shows at every
 * moment of a clip (lipsyncConfig: {}, the 15 OpenXR visemes) and when each word starts and ends
 * (timestampType: "WORD"). Measured Nov 11: the billed characters did not change (102 = 102) and on
 * this buffered lane the extra time was inside the noise (median of 5: 1.601 s plain, 1.611 s with
 * both). The website's talking faces guessed mouths from loudness; this gives them the real shapes.
 *
 * The times Inworld sends are seconds from the first sample of THAT response's audio. This service
 * then edits the audio: the pause limiter drops silent windows (inworld-pauses.js), the inner seam
 * edges are trimmed, and a seam silence joins the pieces. Every time is carried through those edits
 * here, so the track lines up with the bytes the listener actually plays.
 *
 * The track travels INSIDE the WAV as a `kdtm` chunk between `fmt ` and `data` (see
 * writeWavWithTrack), so it can never be separated from the take it describes (a CREATIVE take of
 * the same text runs 6.42, 6.73 or 7.08 s). It is written only when the caller asked
 * (x-kade-tts-timing: 1); every other caller gets byte-identical audio.
 *
 * Track, version 1 (integer ms from the first sample of the `data` chunk):
 *   { v: 1, src: 'inworld', set: 'oxr' | 'iw11', dur, vis: [[start, end, shape]], w?: [[start, end, text]],
 *     cov: [[start, end]] }
 * `vis` sorted and non-overlapping. `cov` is where the data speaks for the clip; outside it a client
 * uses its own loudness method, and covered time with no span is a closed mouth (`sil`).
 * The iPhone and Android ports read the same JSON unchanged. Pure: no I/O, no clock, no env. */

const TRACK_VERSION = 1;
const OXR = new Set(['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou']);
const IW11 = new Set(['aei', 'o', 'ee', 'bmp', 'fv', 'l', 'r', 'th', 'qw', 'u', 'chjsh', 'cdgknstxyz']);
const SPOKEN = /[\p{L}\p{N}]/u;
const BRACKETED = /^\[[^\]\n]{1,40}\]$/;

/** The switches, read per request so Railway can change them without a deploy. The size cap stops at
 *  512 KB because every reader (the website, readTrack) throws away a bigger track. */
function timingSettings(source = process.env) {
  const kb = Number(source.INWORLD_TIMINGS_MAX_KB);
  return {
    on: source.INWORLD_TIMINGS !== '0',
    words: source.INWORLD_TIMINGS_WORDS !== '0',
    maxBytes: Math.round((Number.isFinite(kb) && kb > 0 ? Math.min(kb, 512) : 256) * 1024),
  };
}

/** Did this request ask for a track? The header is the fork's and the bridge's way; the body field is for tools. */
function timingAsked(headerValue, bodyValue) {
  return headerValue === '1' || bodyValue === true || bodyValue === 'true' || bodyValue === '1';
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const sameLength = (...lists) => lists.every((l) => Array.isArray(l) && l.length === lists[0].length);

/** Inworld's lip-sync visemes as [startMs, endMs, shape], or null when they are missing or malformed
 *  (the docs say they may be absent "if temporarily unavailable", and a misspelled field gives none). */
function lipsyncSpans(info) {
  const la = info && info.lipsyncAlignment;
  if (!la || !sameLength(la.visemes, la.visemeStartTimeSeconds, la.visemeEndTimeSeconds) || !la.visemes.length) return null;
  const out = [];
  for (let i = 0; i < la.visemes.length; i++) {
    const s = la.visemeStartTimeSeconds[i], e = la.visemeEndTimeSeconds[i], shape = la.visemes[i];
    if (!finite(s) || !finite(e) || e < s) return null;
    if (OXR.has(shape)) out.push([s * 1000, e * 1000, shape]);
  }
  return out.length ? out : null;
}

/** The fallback: WORD phones with Inworld's coarser 11-class viseme (`[silence]` is a closed mouth). */
function phoneSpans(info) {
  const details = info && info.wordAlignment && info.wordAlignment.phoneticDetails;
  if (!Array.isArray(details)) return null;
  const out = [];
  for (const d of details) {
    for (const p of (d && Array.isArray(d.phones) ? d.phones : [])) {
      if (!p || !finite(p.startTimeSeconds) || !finite(p.durationSeconds) || p.durationSeconds <= 0) continue;
      const shape = p.phoneSymbol === '[silence]' ? 'sil' : p.visemeSymbol;
      if (shape !== 'sil' && !IW11.has(shape)) continue;
      out.push([p.startTimeSeconds * 1000, (p.startTimeSeconds + p.durationSeconds) * 1000, shape]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.length ? out : null;
}

/** Spoken words as [startMs, endMs, text]: whitespace, punctuation, the trailing "" and `[silence]`
 *  dropped; bracketed sounds the proxy added (`[laugh]`, `[sigh]`) kept, since the face reacts to them. */
function wordSpans(info) {
  const wa = info && info.wordAlignment;
  if (!wa || !sameLength(wa.words, wa.wordStartTimeSeconds, wa.wordEndTimeSeconds)) return null;
  const out = [];
  for (let i = 0; i < wa.words.length; i++) {
    const text = typeof wa.words[i] === 'string' ? wa.words[i].trim() : '';
    const s = wa.wordStartTimeSeconds[i], e = wa.wordEndTimeSeconds[i];
    if (!text || !finite(s) || !finite(e) || e < s) continue;
    if (BRACKETED.test(text) ? text.toLowerCase() === '[silence]' : !SPOKEN.test(text)) continue;
    out.push([s * 1000, e * 1000, text.slice(0, 64)]);
  }
  return out.length ? out : null;
}

/** A time on the clip as Inworld sent it -> the same moment after the pause limiter removed `cuts`
 *  ([startMs, endMs] in input time, sorted, not overlapping). A time inside a cut lands on the cut. */
function mapThroughCuts(ms, cuts) {
  let removed = 0;
  for (const [a, b] of cuts || []) {
    if (ms <= a) break;
    if (ms < b) return a - removed;
    removed += b - a;
  }
  return ms - removed;
}

/** One chunk's spans placed in the final PCM: through the cuts, minus the head trim, inside the kept
 *  piece, then shifted to where that piece starts. Spans left with no length are dropped. */
function chunkSpans(spans, { cuts = [], headMs = 0, keptMs = Infinity, offsetMs = 0 } = {}) {
  const out = [];
  for (const [s, e, x] of spans || []) {
    const a = Math.max(0, mapThroughCuts(s, cuts) - headMs);
    const b = Math.min(keptMs, mapThroughCuts(e, cuts) - headMs);
    if (b > a) out.push([a + offsetMs, b + offsetMs, x]);
  }
  return out;
}

/** Round to whole ms, keep the list sorted and non-overlapping, join touching spans of one shape. */
function tidy(spans, merge) {
  const out = [];
  for (const [s0, e0, x] of spans) {
    const prev = out[out.length - 1];
    const s = Math.max(Math.round(s0), prev ? prev[1] : 0);
    const e = Math.round(e0);
    if (e <= s) continue;
    if (merge && prev && prev[2] === x && s === prev[1]) prev[1] = e;
    else out.push([s, e, x]);
  }
  return out;
}

/** chunks: [{ info, cuts, headMs, keptMs, offsetMs }] in playing order (offsets from real buffer
 *  lengths). Returns the track, or null when no chunk brought usable data or it will not fit. */
function buildTrack(chunks, durMs, { words = true, maxBytes = 256 * 1024 } = {}) {
  if (!Array.isArray(chunks) || !chunks.length || !finite(durMs) || durMs <= 0) return null;
  const lips = chunks.map((c) => lipsyncSpans(c && c.info));
  const anyLip = lips.some(Boolean);
  // Lip-sync is derived from the audio and covers laughs; phones are only the fallback, and one
  // track has one shape set, so phones fill in only when no chunk brought lip-sync at all.
  const shapes = anyLip ? lips : chunks.map((c) => phoneSpans(c && c.info));
  if (!shapes.some(Boolean)) return null;
  const vis = [], cov = [], w = [];
  chunks.forEach((c, i) => {
    const place = { cuts: c.cuts || [], headMs: c.headMs || 0, keptMs: c.keptMs, offsetMs: c.offsetMs || 0 };
    if (shapes[i]) {
      vis.push(...chunkSpans(shapes[i], place));
      const start = place.offsetMs, end = place.offsetMs + place.keptMs;
      // Two covered pieces in a row: the seam silence between them is covered too (a closed mouth).
      if (i > 0 && shapes[i - 1] && cov.length) cov[cov.length - 1][1] = end;
      else cov.push([start, end]);
    }
    if (words) {
      const ws = wordSpans(c && c.info);
      if (ws) w.push(...chunkSpans(ws, place));
    }
  });
  const dur = Math.round(durMs);
  const track = {
    v: TRACK_VERSION,
    src: 'inworld',
    set: anyLip ? 'oxr' : 'iw11',
    dur,
    vis: tidy(vis, true).filter((s) => s[0] < dur).map((s) => [s[0], Math.min(s[1], dur), s[2]]),
    cov: tidy(cov.map(([s, e]) => [s, e, 0]), true).map(([s, e]) => [s, Math.min(e, dur)]).filter(([s, e]) => e > s),
  };
  const wt = tidy(w, false).filter((s) => s[0] < dur);
  if (wt.length) track.w = wt;
  if (!track.vis.length || !track.cov.length) return null;
  if (Buffer.byteLength(JSON.stringify(track)) > maxBytes) delete track.w;
  if (Buffer.byteLength(JSON.stringify(track)) > maxBytes) return null;
  return track;
}

/** RIFF/WAVE with `fmt ` (16 bytes, still first: the bridge reads the byte rate at offset 28), then
 *  `kdtm` (UTF-8 JSON, padded to an even length), then `data`. The RIFF size covers every chunk. */
function writeWavWithTrack({ numChannels, sampleRate, bitsPerSample }, trackJson, pcm) {
  const body = Buffer.from(String(trackJson), 'utf8');
  const pad = body.length % 2;
  const head = Buffer.alloc(12 + 24 + 8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(4 + 24 + 8 + body.length + pad + 8 + pcm.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(numChannels, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
  head.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  head.writeUInt16LE(bitsPerSample, 34);
  head.write('kdtm', 36, 'ascii');
  head.writeUInt32LE(body.length, 40);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0, 'ascii');
  dataHead.writeUInt32LE(pcm.length, 4);
  return Buffer.concat([head, body, Buffer.alloc(pad), dataHead, pcm]);
}

/** The track a WAV carries (first RIFF only), or null. For tests, probes and the live check. */
function readTrack(buffer) {
  try {
    if (!buffer || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
    const end = Math.min(buffer.length, 8 + buffer.readUInt32LE(4));
    for (let at = 12; at + 8 <= end;) {
      const id = buffer.toString('ascii', at, at + 4);
      const size = buffer.readUInt32LE(at + 4);
      if (id === 'kdtm') {
        if (size > 512 * 1024 || at + 8 + size > end) return null;
        const track = JSON.parse(buffer.toString('utf8', at + 8, at + 8 + size));
        return track && track.v === TRACK_VERSION ? track : null;
      }
      if (id === 'data') return null;
      at += 8 + size + (size % 2);
    }
  } catch (_) { /* not a track */ }
  return null;
}

module.exports = {
  TRACK_VERSION,
  timingSettings,
  timingAsked,
  lipsyncSpans,
  phoneSpans,
  wordSpans,
  mapThroughCuts,
  chunkSpans,
  buildTrack,
  writeWavWithTrack,
  readTrack,
};
