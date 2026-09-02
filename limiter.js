"use strict";
/**
 * limiter.js — LOOKAHEAD PEAK LIMITER (Part 117.3, Sep 2 2026)
 *
 * Her words: "I like having them consistent and loud, so they can carry on a
 * speaker in a crowd but also sound full and warm on headphones… it seems like
 * the voices are clipping. Like that little, sometimes buzz or crackle or
 * whatever? I don't know if it's the volume as much as the EQ maybe?"
 *
 * WHAT THE OLD STAGE DID. Since July 16 the loudness lane ended in a static
 * tanh waveshaper: every sample above the knee (26000, ~2 dB under full
 * scale) was bent toward full scale on its own, with no memory of its
 * neighbours. That can never hard-clip, which is what it was built for — but
 * bending the top of a waveform IS harmonic distortion, and the lane was
 * measured doing it to 0.1–0.6% of the samples of every fish clone in the
 * Sep 2 sweep (0.01–0.04% on Inworld voices, which arrive quieter and
 * peakier). 0.4% of a 20-second clip is ~1,900 samples, all of them sitting on
 * the loudest vowels and sibilants — a buzz on exactly the syllables that
 * carry. It sounds like EQ because a bent peak adds high harmonics; it is
 * not EQ.
 *
 * WHAT THIS DOES INSTEAD. A limiter that looks 3 ms AHEAD, turns the whole
 * signal down smoothly just before a peak would cross the ceiling, and lets
 * it back up over ~80 ms. The waveform's SHAPE is never touched — only its
 * level, and only for a few milliseconds around the peaks that needed it.
 * No added harmonics, so no buzz, and the loudness target is unchanged
 * because speech peaks are short: the gain dips cost well under 0.1 dB of
 * RMS on the clips measured. The same object serves the buffered lane and the
 * streamed lane (it is a 120-sample delay line, 5 ms at 24 kHz — the streamed
 * lane's first-audio time moves by 5 ms).
 *
 * TTS_NORM_LIMITER=tanh restores the waveshaper in both lanes.
 */

/* Part 117.5 (Sep 2 2026), her ear on 117.4: "still clipping on some
 * syllables… without clipping/buzzing like the mic is hot." Measured the gain
 * ENVELOPE on raw clones at the live drive: with a 3 ms attack and an 80 ms
 * release, the envelope rippled at PITCH rate (60–400 Hz) — a limiter that
 * re-opens between glottal pulses is a waveshaper with extra steps, and that
 * ripple is the buzz. A 5 ms lookahead, a 20 ms HOLD (the gain may not rise
 * for 20 ms after the last over-peak) and a 250 ms release cut the pitch-rate
 * ripple by ~40% at the same loudness; capping the gain so the raw peak lands
 * at most 4 dB over the ceiling (server.js) cut it a further 25–45% and
 * bounds the dip on any syllable to 4 dB. Cost: 0–1.3 dB of RMS on the
 * peakiest clones, none on the rest. */
const DEFAULT_LOOKAHEAD_MS = 5;
const DEFAULT_HOLD_MS = 20;
const DEFAULT_RELEASE_MS = 250;

/**
 * Stateful lookahead limiter over float samples (int16 scale, i.e. ±32768).
 * push(v) returns the limited sample from `lookahead` samples ago, or null
 * while the delay line is priming. flush() drains the line.
 */
function createLookaheadLimiter({ ceiling = 31500, sampleRate = 24000, lookaheadMs = DEFAULT_LOOKAHEAD_MS, holdMs = DEFAULT_HOLD_MS, releaseMs = DEFAULT_RELEASE_MS } = {}) {
  const L = Math.max(4, Math.round((sampleRate * lookaheadMs) / 1000));
  const H = Math.max(0, Math.round((sampleRate * holdMs) / 1000));
  const W = L + H; // window of `need` values the envelope may not rise above: L ahead of the output sample, H behind it
  // gain must be fully down by the time the peak reaches the output, so the
  // attack settles in ~L/4 samples (four time constants inside the lookahead)
  const attackCoef = 1 - Math.exp(-4 / L);
  const releaseCoef = 1 - Math.exp(-1 / Math.max(1, (sampleRate * releaseMs) / 1000));

  const delay = new Float64Array(L);   // ring buffer of samples
  const need = new Float64Array(L);    // ring buffer of per-sample required gain
  // monotonic deque (indices into a growing counter) for the sliding-window min of `need`
  const R = W + 2; // ring size: the window holds at most W+1 entries
  const dqIdx = new Int32Array(R);
  const dqVal = new Float64Array(R);
  let dqHead = 0, dqTail = 0;
  let count = 0;          // samples pushed so far
  let env = 1;            // current gain envelope
  let limitedSamples = 0; // output samples attenuated by 1 dB or more (env < 0.89) -- the log number
  let minEnv = 1;

  function push(v) {
    const a = Math.abs(v);
    const r = a > ceiling ? ceiling / a : 1;
    const slot = count % L;
    // sliding-window minimum over the L most recent `need` values
    // window = H samples before the one leaving the delay line (count - L) through this one
    while (dqTail > dqHead && dqVal[(dqTail - 1) % R] >= r) dqTail--;
    dqIdx[dqTail % R] = count; dqVal[dqTail % R] = r; dqTail++;
    while (dqIdx[dqHead % R] < count - W) dqHead++;
    const target = dqVal[dqHead % R];
    // attack toward a lower target fast, release toward 1 slowly
    env += (target - env) * (target < env ? attackCoef : releaseCoef);
    if (env > 1) env = 1;

    const out = count >= L ? delay[slot] * env : null;
    if (out !== null) {
      if (env < 0.89) limitedSamples++;
      if (env < minEnv) minEnv = env;
    }
    delay[slot] = v; need[slot] = r;
    count++;
    return out;
  }
  function flush() {
    const outs = [];
    for (let i = 0; i < L && count >= L; i++) {
      // nothing new ahead; the hold still applies for H samples past the last over-peak
      while (dqIdx[dqHead % R] < count + i + 1 - W && dqHead < dqTail) dqHead++;
      const target = dqHead < dqTail ? dqVal[dqHead % R] : 1;
      env += (target - env) * (target < env ? attackCoef : releaseCoef);
      const slot = (count - L + i) % L;
      outs.push(delay[slot] * env);
      if (env < 0.89) limitedSamples++;
    }
    return outs;
  }
  return {
    push, flush,
    get limitedSamples() { return limitedSamples; },
    get minGain() { return minEnv; },
    lookahead: L,
  };
}

/**
 * Buffered helper: gains an int16 PCM buffer IN PLACE with a per-sample gain
 * function, limited at `ceiling`, and returns { limited, minGain }.
 * gainAt(i) lets the caller ramp between clips exactly as before.
 */
function limitPcmInPlace(pcmBuf, sampleRate, gainAt, ceiling = 31500) {
  const total = pcmBuf.length >> 1;
  const lim = createLookaheadLimiter({ ceiling, sampleRate });
  let w = 0;
  const write = (v) => {
    const c = Math.round(Math.max(-32768, Math.min(32767, v)));
    pcmBuf.writeInt16LE(c, w * 2);
    w++;
  };
  for (let i = 0; i < total; i++) {
    const out = lim.push(pcmBuf.readInt16LE(i * 2) * gainAt(i));
    if (out !== null) write(out);
  }
  for (const v of lim.flush()) if (w < total) write(v);
  while (w < total) write(0);
  return { limited: lim.limitedSamples, minGain: lim.minGain };
}

module.exports = { createLookaheadLimiter, limitPcmInPlace, DEFAULT_LOOKAHEAD_MS, DEFAULT_HOLD_MS, DEFAULT_RELEASE_MS };
