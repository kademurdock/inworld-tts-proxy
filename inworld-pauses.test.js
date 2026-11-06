'use strict';
// Nov 5 2026: the Inworld pause limiter (inworld-pauses.js). Silence is thinned past a knee and capped;
// speech is never touched; a stream and a whole clip give the same bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pauseSettings, createPauseLimiter, limitPauses } = require('./inworld-pauses');

const SR = 24000;
const ms = (n) => Math.round((SR * n) / 1000);

function pcm(parts) {
  const total = parts.reduce((n, p) => n + p.samples, 0);
  const buf = Buffer.alloc(total * 2);
  let at = 0;
  for (const p of parts) {
    for (let i = 0; i < p.samples; i++) {
      const v = p.amp ? Math.round(p.amp * Math.sin((2 * Math.PI * 200 * (at + i)) / SR)) : 0;
      buf.writeInt16LE(v, (at + i) * 2);
    }
    at += p.samples;
  }
  return buf;
}
const speech = (n) => ({ samples: ms(n), amp: 8000 });
const quiet = (n) => ({ samples: ms(n), amp: 0 });
const settings = pauseSettings({ INWORLD_PAUSE_CAP: '1' });
const lengthMs = (buf) => (buf.length / 2 / SR) * 1000;

test('off unless INWORLD_PAUSE_CAP=1, and the shape can be changed without a deploy', () => {
  assert.equal(pauseSettings({}).on, false);
  assert.equal(pauseSettings({ INWORLD_PAUSE_CAP: '0' }).on, false);
  assert.equal(pauseSettings({ INWORLD_PAUSE_CAP: 'true' }).on, false);
  const s = pauseSettings({ INWORLD_PAUSE_CAP: '1' });
  assert.deepEqual([s.on, s.kneeMs, s.slope, s.maxMs, s.thresholdDb], [true, 350, 0.5, 500, -50]);
  const t = pauseSettings({ INWORLD_PAUSE_CAP: '1', INWORLD_PAUSE_KNEE_MS: '300', INWORLD_PAUSE_SLOPE: '0.25', INWORLD_PAUSE_MAX_MS: '450', INWORLD_PAUSE_THRESHOLD_DB: '-55' });
  assert.deepEqual([t.kneeMs, t.slope, t.maxMs, t.thresholdDb], [300, 0.25, 450, -55]);
  // a ceiling under the knee would cut inside the part kept whole: it is lifted to the knee
  assert.equal(pauseSettings({ INWORLD_PAUSE_KNEE_MS: '400', INWORLD_PAUSE_MAX_MS: '200' }).maxMs, 400);
});

test('a stop under the knee comes out bit for bit', () => {
  const input = pcm([speech(300), quiet(300), speech(300)]);
  const { pcm: out } = limitPauses(input, SR, settings);
  assert.ok(out.equals(input));
});

test('a long silence is brought in: whole to the knee, half-rate past it, never more than the ceiling', () => {
  const at = (silenceMs) => lengthMs(limitPauses(pcm([speech(300), quiet(silenceMs), speech(300)]), SR, settings).pcm) - 600;
  assert.ok(Math.abs(at(450) - 400) <= 10, 'knee + half of the 100 ms over it: ' + at(450));
  assert.ok(Math.abs(at(600) - 475) <= 10, at(600));
  assert.ok(Math.abs(at(1000) - 500) <= 10, 'capped: ' + at(1000));
  assert.ok(Math.abs(at(3000) - 500) <= 10, 'capped: ' + at(3000));
  // order is kept: a longer original stop never comes out shorter
  assert.ok(at(500) <= at(700) && at(700) <= at(1200));
});

test('speech is never shortened or changed, only silence is', () => {
  const input = pcm([speech(400), quiet(900), speech(500), quiet(200), speech(250)]);
  const { pcm: out } = limitPauses(input, SR, settings);
  const nonSilent = (b) => { let n = 0; for (let i = 0; i < b.length; i += 2) if (Math.abs(b.readInt16LE(i)) > 100) n++; return n; };
  assert.equal(nonSilent(out), nonSilent(input));
  // the first word is the first bytes of the output, unchanged
  assert.ok(out.subarray(0, ms(400) * 2).equals(input.subarray(0, ms(400) * 2)));
});

test('a breath-level sound inside a stop is not mistaken for silence', () => {
  // about -40 dBFS: far above the -50 dBFS floor
  const breath = { samples: ms(300), amp: 330 };
  const input = pcm([speech(300), quiet(200), breath, quiet(200), speech(300)]);
  const { pcm: out } = limitPauses(input, SR, settings);
  assert.ok(out.equals(input), 'two 200 ms stops around a breath are both under the knee, so nothing changes');
  const long = pcm([speech(300), quiet(800), breath, speech(300)]);
  const trimmed = limitPauses(long, SR, settings).pcm;
  assert.ok(lengthMs(trimmed) >= 300 + 300 + 300 + 400, 'the breath itself stays whole: ' + lengthMs(trimmed));
});

test('pushed in odd little pieces gives exactly the bytes of one push', () => {
  const input = pcm([speech(350), quiet(900), speech(420), quiet(520), speech(310), quiet(1500), speech(200)]);
  const whole = limitPauses(input, SR, settings).pcm;
  for (const step of [1, 7, 480, 481, 4801, 9999]) {
    const lim = createPauseLimiter({ sampleRate: SR, kneeMs: settings.kneeMs, slope: settings.slope, maxMs: settings.maxMs, thresholdDb: settings.thresholdDb });
    const parts = [];
    for (let i = 0; i < input.length; i += step) parts.push(lim.push(input.subarray(i, i + step)));
    parts.push(lim.flush());
    assert.ok(Buffer.concat(parts).equals(whole), 'step ' + step);
  }
});

test('stats count what was cut, and a clip with nothing long is left alone', () => {
  const lim = createPauseLimiter({ sampleRate: SR });
  lim.push(pcm([speech(200), quiet(1000), speech(200), quiet(200), speech(100)]));
  assert.equal(lim.stats.runsShortened, 1);
  assert.ok(lim.stats.droppedMs >= 480 && lim.stats.droppedMs <= 520, String(lim.stats.droppedMs));
  assert.ok(lim.stats.longestRunMs >= 1000);
  const calm = createPauseLimiter({ sampleRate: SR });
  calm.push(pcm([speech(300), quiet(250), speech(300)]));
  assert.equal(calm.stats.runsShortened, 0);
  assert.equal(calm.stats.droppedMs, 0);
});

test('empty and tiny inputs come back safely', () => {
  assert.equal(limitPauses(Buffer.alloc(0), SR, settings).pcm.length, 0);
  assert.equal(limitPauses(Buffer.alloc(2), SR, settings).pcm.length, 2);
  const lim = createPauseLimiter({ sampleRate: SR });
  assert.equal(lim.push(Buffer.alloc(0)).length, 0);
  assert.equal(lim.flush().length, 0);
});
