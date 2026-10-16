'use strict';

/* Oct 16 2026, Kade: Fish "still talking slow regardless" of Brisk and Fast, and Fish's
 * numeric prosody.speed "starts sounding robotic like when you change the formant", so it
 * stays at 1.0 (it is a time-stretch; Inworld renders its rate natively and sounds fine).
 * Measured on Drama3 (three voices, 51 words, two takes, words per minute against today's
 * Natural): the old Brisk/Quick sentences did 0 to +8%; a "25 percent faster" instruction
 * barely moved; the per-sentence [short pause] tags and Fish's own long gaps are most of
 * the slowness on slow voices. Brisk and Quick therefore (1) use wording that measured
 * faster, (2) skip the added sentence pauses, and (3) shorten any silence inside the clip
 * to a cap. The words themselves are never sped up: Brisk averaged about +11% (+19% on the
 * slowest voice) and Quick about +19% (+25%). */
const FISH_PACES = [
  { value: 0.75, name: 'Unhurried', direction: 'Speak unhurriedly, with relaxed phrasing and clear words.' },
  { value: 0.9, name: 'Easygoing', direction: 'Speak at an easygoing conversational pace, with natural expressive phrasing.' },
  { value: 1, name: 'Natural', direction: '' },
  { value: 1.2, name: 'Brisk', direction: 'speaking quickly, letting the sentences flow together with short pauses', sentencePauses: false, pauseCapMs: 300 },
  { value: 1.5, name: 'Quick', direction: 'fast-talking, rapid delivery with almost no pauses', sentencePauses: false, pauseCapMs: 200 },
];

function fishPace(rate) {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  return FISH_PACES.reduce((best, pace) => Math.abs(pace.value - value) < Math.abs(best.value - value) ? pace : best);
}

// Runs at the provider boundary, after author-tempo cleanup and chunk shaping.
// This changes the actor's instruction, never the audio's playback rate.
function fishPacedText(text, rate) {
  const { direction } = fishPace(rate);
  return direction ? `[${direction}] ${text}` : text;
}

// Whether the proxy adds its [short pause] after sentences for this pace.
function fishSentencePauses(rate) {
  return fishPace(rate).sentencePauses !== false;
}

/* Shorten silences INSIDE a Fish clip (16-bit mono PCM) to the pace's cap. Speech is
 * never touched: a 10 ms window counts as silence below 4% of the clip's loud level, the
 * first and last half-cap of each long silent run are kept (word tails and breaths in),
 * the middle is dropped, and 5 ms fades meet at the join. Leading and trailing silence
 * stay as they are. Returns the same buffer when there is nothing to do. */
function capFishPauses(pcm, rate, sampleRate = 24000) {
  const cap = fishPace(rate).pauseCapMs;
  if (!cap || !pcm || pcm.length < 4) return pcm;
  const s = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const windows = Math.floor(s.length / win);
  if (windows < 3) return pcm;
  const rms = new Array(windows);
  for (let w = 0; w < windows; w++) {
    let acc = 0;
    for (let i = w * win; i < (w + 1) * win; i++) acc += s[i] * s[i];
    rms[w] = Math.sqrt(acc / win);
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(windows * 0.95)] || 0;
  if (!loud) return pcm;
  const quiet = rms.map(v => v < loud * 0.04);
  const keepWindows = Math.max(2, Math.round(cap / 10));
  const half = Math.floor(keepWindows / 2);
  const cuts = []; // [startSample, endSample) to drop
  let w = 0;
  while (w < windows) {
    if (!quiet[w]) { w++; continue; }
    let end = w;
    while (end < windows && quiet[end]) end++;
    const inside = w > 0 && end < windows;
    if (inside && end - w > keepWindows) cuts.push([(w + half) * win, (end - (keepWindows - half)) * win]);
    w = end;
  }
  if (!cuts.length) return pcm;
  const fade = Math.min(Math.round(sampleRate * 0.005), half * win);
  const out = new Int16Array(s.length - cuts.reduce((n, [a, b]) => n + (b - a), 0));
  let from = 0;
  let to = 0;
  for (const [a, b] of cuts) {
    out.set(s.subarray(from, a), to);
    to += a - from;
    for (let k = 0; k < fade; k++) out[to - fade + k] = Math.round(out[to - fade + k] * (1 - (k + 1) / fade));
    for (let k = 0; k < fade && b + k < s.length; k++) s[b + k] = Math.round(s[b + k] * ((k + 1) / fade));
    from = b;
  }
  out.set(s.subarray(from), to);
  return Buffer.from(out.buffer);
}

module.exports = { FISH_PACES, fishPace, fishPacedText, fishSentencePauses, capFishPauses };
