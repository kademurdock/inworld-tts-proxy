'use strict';
/* Part 117.3 (Sep 2 2026): lookahead limiter replaces the tanh waveshaper. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLookaheadLimiter, limitPcmInPlace } = require('./limiter');
const { createStreamProcessor } = require('./stream-lane');

const SR = 24000;
function sine(n, amp, hz = 1000) { return Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR)); }

test('a clean signal under the ceiling passes through bit-exact (only delayed)', () => {
  const x = sine(SR, 20000);
  const lim = createLookaheadLimiter({ ceiling: 31500, sampleRate: SR });
  const out = []; for (const v of x) { const o = lim.push(v); if (o !== null) out.push(o); } out.push(...lim.flush());
  assert.equal(out.length, x.length);
  let maxDiff = 0; for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - x[i]));
  assert.ok(maxDiff < 1e-6, 'untouched: ' + maxDiff);
  assert.equal(lim.limitedSamples, 0);
});

test('a burst three times over the ceiling comes out under it, and the waveform shape is scaled not bent', () => {
  const x = sine(SR, 20000).map((v, i) => (i > 10000 && i < 10300 ? v * 3 : v));
  const lim = createLookaheadLimiter({ ceiling: 31500, sampleRate: SR });
  const out = []; for (const v of x) { const o = lim.push(v); if (o !== null) out.push(o); } out.push(...lim.flush());
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 31500 * 1.03, 'peak ' + peak);
  assert.ok(peak < 32767, 'never reaches the hard clamp');
  // shape check: inside the burst, output/input ratio is locally constant (a level change, not a knee)
  const ratios = [];
  for (let i = 10100; i < 10200; i++) if (Math.abs(x[i]) > 30000) ratios.push(out[i] / x[i]);
  const spread = Math.max(...ratios) - Math.min(...ratios);
  assert.ok(spread < 0.02, 'gain is flat across the peak: ' + spread);
  assert.ok(lim.limitedSamples > 200 && lim.limitedSamples < SR / 2, 'limited the burst plus hold and the deep part of its release: ' + lim.limitedSamples);
});

test('limitPcmInPlace keeps buffer length, honours a per-sample gain ramp, and clamps as a last resort', () => {
  const n = 4800;
  const buf = Buffer.alloc(n * 2);
  sine(n, 10000).forEach((v, i) => buf.writeInt16LE(Math.round(v), i * 2));
  const r = limitPcmInPlace(buf, SR, (i) => (i < 480 ? 1 + i / 480 : 2), 31500);
  assert.equal(buf.length, n * 2);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(i * 2)));
  assert.ok(peak <= 20000 + 1 && peak > 19000, 'ramped to 2x: ' + peak);
  assert.equal(r.limited, 0);
});

test('stream processor in lookahead mode: output lags by the lookahead, flush returns exactly that tail, tanh mode is unchanged', () => {
  const n = 2400;
  const pcm = Buffer.alloc(n * 2);
  sine(n, 30000).forEach((v, i) => pcm.writeInt16LE(Math.round(v), i * 2));
  const la = createStreamProcessor({ gain: 1.2, knee: 26000, kneeRange: 6767, fadeInSamples: 1, rampSamples: 1, limiter: 'lookahead', ceiling: 28000, sampleRate: SR });
  const out = la.process(Buffer.from(pcm));
  const tail = la.flush();
  assert.equal(out.length + tail.length, n * 2, 'nothing lost across process+flush');
  assert.equal(tail.length, 120 * 2, '5 ms at 24 kHz');
  let peak = 0; for (let i = 0; i < out.length / 2; i++) peak = Math.max(peak, Math.abs(out.readInt16LE(i * 2)));
  assert.ok(peak <= 28000 * 1.03, 'limited at the ceiling: ' + peak);
  const th = createStreamProcessor({ gain: 1.2, knee: 26000, kneeRange: 6767, fadeInSamples: 1, rampSamples: 1, limiter: 'tanh' });
  const o2 = th.process(Buffer.from(pcm));
  assert.equal(o2.length, n * 2);
  assert.equal(th.flush().length, 0);
});

test('hold: after a single over-peak the gain stays down for the hold window before releasing', () => {
  const x = sine(SR / 2, 20000).map((v, i) => (i === 6000 ? 60000 : v));
  const lim = createLookaheadLimiter({ ceiling: 31500, sampleRate: SR, holdMs: 20, releaseMs: 250 });
  const env = [];
  const out = []; for (const v of x) { const o = lim.push(v); if (o !== null) out.push(o); }
  // gain at the peak sample and 15 ms after it (inside the hold) must be the same reduced gain
  const gAt = (i) => out[i] / x[i];
  const gPeak = Math.abs(out[6000]) / 60000;
  assert.ok(gPeak < 0.55, 'peak pulled to the ceiling: ' + gPeak);
  const g15 = Math.abs(gAt(6000 + 360));
  assert.ok(Math.abs(g15 - gPeak) < 0.02, `held 15 ms later: ${g15} vs ${gPeak}`);
  const g100 = Math.abs(gAt(6000 + 2400));
  assert.ok(g100 > gPeak + 0.1, 'releasing by 100 ms: ' + g100);
});
