'use strict';
// Oct 30 2026: FISH_SPEED_EXACT. Kade: "All the prat clips sounded completely natural. Even the one
// going upwards of 150. So I'm thinking ... we need Prat as the fish speed controler in all methods
// that use fish." One number everywhere: the Natural take, stretched whole by Praat. Run with
// FISH_STRETCH_PYTHON naming an interpreter that has praat-parselmouth; without it the tests that need
// a real process skip and say so.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const pace = require('./pace');
const runaway = require('./fish-runaway');
const { createFishStretch, BACKOFF_MAX_MS } = require('./fish-stretch');

const { fishExactOn, fishSpeedApplied, fishPacedText, fishSentencePauses, fishPauseCapMs, capFishPauses, fishThoughtGapMs, padFishTail, fishApiSpeed, fishStretchRatio } = pace;
const RATE = 24000;
const PYTHON = process.env.FISH_STRETCH_PYTHON;
const NEEDS_PYTHON = PYTHON ? false : 'FISH_STRETCH_PYTHON is not set, so this test is skipped';
const MISSING = path.join(os.tmpdir(), 'no-such-folder', 'no-such-python');
// The people-facing list, and what shipped apps already send, all inside it.
const THE_LIST = [0.75, 0.8, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5];

function voiced(seconds, { f0 = 150, amp = 9000 } = {}) {
  const n = Math.round(seconds * RATE);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * f0 * i) / RATE;
    pcm.writeInt16LE(Math.round(amp * (Math.sin(t) + 0.35 * Math.sin(2 * t) + 0.15 * Math.sin(3 * t))), i * 2);
  }
  return pcm;
}
const secondsOf = (pcm) => pcm.length / 2 / RATE;
function crossingsPerSecond(pcm) {
  let crossings = 0;
  const n = pcm.length / 2;
  for (let i = 1; i < n; i++) if ((pcm.readInt16LE((i - 1) * 2) < 0) !== (pcm.readInt16LE(i * 2) < 0)) crossings++;
  return crossings / (n / RATE);
}
function longestInnerSilenceMs(pcm) {
  const n = pcm.length / 2;
  let first = 0;
  let last = n - 1;
  while (first < n && Math.abs(pcm.readInt16LE(first * 2)) < 100) first++;
  while (last > first && Math.abs(pcm.readInt16LE(last * 2)) < 100) last--;
  let best = 0;
  let run = 0;
  for (let i = first; i <= last; i++) {
    run = Math.abs(pcm.readInt16LE(i * 2)) < 100 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return (best / RATE) * 1000;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(15);
  }
  return false;
}
function withEnv(values, fn) {
  const was = {};
  for (const [k, v] of Object.entries(values)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function withEnvAsync(values, fn) {
  const was = {};
  for (const [k, v] of Object.entries(values)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── pace.js ────────────────────────────────────────────────────────────────────────────────────
test('the switch is on only at exactly 1', () => {
  for (const source of [{}, { FISH_SPEED_EXACT: '0' }, { FISH_SPEED_EXACT: 'true' }, { FISH_SPEED_EXACT: ' 1' }]) assert.equal(fishExactOn(source), false);
  assert.equal(fishExactOn({ FISH_SPEED_EXACT: '1' }), true);
});

test('exact: the stretch is the number itself on every path, whatever the older switches say', () => {
  for (const rate of [...THE_LIST, 0.5, 1.05, 1.37]) {
    for (const opts of [{}, { talk: true }, { liveCall: true }, { talk: true, liveCall: true }, { source: {} }, { source: { FISH_PACE_STRETCH: '0' } }]) {
      assert.equal(fishStretchRatio(rate, { ...opts, exact: true }), rate);
    }
  }
  for (const rate of [undefined, null, 1, NaN, 'fast']) assert.equal(fishStretchRatio(rate, { talk: true, exact: true }), 1, String(rate));
});

test('exact: a line is never sped up twice', () => {
  const both = { FISH_PACE_SPEED: '1', FISH_PACE_STRETCH: '1' };
  for (const rate of [0.75, 1.2, 1.5]) {
    for (const liveCall of [false, true]) assert.equal(fishApiSpeed(rate, { talk: true, liveCall, exact: true, source: both }), 1);
  }
});

test('exact: no pace wording and the Natural text at every speed; the casual brief stays talk-only', () => {
  withEnv({ FISH_DEFAULT_DIRECTION: 'talking off the cuff with a friend', FISH_TALK_FILLERS: undefined, FISH_TALK_SOUNDS: undefined }, () => {
    for (const rate of [...THE_LIST, undefined]) {
      assert.equal(fishPacedText('Hi.', rate, { exact: true }), 'Hi.', String(rate));
      assert.equal(fishPacedText('Hi.', rate, { exact: true, talk: true }), fishPacedText('Hi.', 1, { talk: true }), String(rate));
    }
  });
});

test('exact: sentence pauses ignore the rate; FISH_SENTENCE_PAUSES=0 still turns them off', () => {
  withEnv({ FISH_SENTENCE_PAUSES: undefined }, () => {
    for (const rate of [...THE_LIST, undefined]) assert.equal(fishSentencePauses(rate, { exact: true }), true);
    assert.equal(fishSentencePauses(1.5), false, 'the old way, without exact');
  });
  withEnv({ FISH_SENTENCE_PAUSES: '0' }, () => assert.equal(fishSentencePauses(1, { exact: true }), false));
});

test('exact: pause cap is natural / rate from 1x up and natural below it', () => {
  withEnv({ FISH_NATURAL_PAUSE_CAP_MS: undefined }, () => {
    for (const [rate, cap] of [[1, 500], [undefined, 500], [1.25, 400], [1.5, 500 / 1.5], [0.9, 500], [0.75, 500]]) assert.equal(fishPauseCapMs(rate, { exact: true }), cap, String(rate));
    assert.equal(fishPauseCapMs(1.5), 350, 'the old way, without exact');
  });
  withEnv({ FISH_NATURAL_PAUSE_CAP_MS: '300' }, () => {
    assert.equal(fishPauseCapMs(1.5, { exact: true }), 200);
    assert.equal(fishPauseCapMs(0.75, { exact: true }), 300);
  });
  withEnv({ FISH_NATURAL_PAUSE_CAP_MS: '0' }, () => {
    const pcm = voiced(1);
    assert.equal(capFishPauses(pcm, 1.5, RATE, { exact: true }), pcm, 'no cap');
  });
});

test('exact: thought gap is 450 / rate, kept to 300-500, and the switch still turns it off', () => {
  withEnv({ FISH_THOUGHT_GAPS: undefined }, () => {
    for (const [rate, gap] of [[0.75, 500], [0.9, 500], [undefined, 450], [1, 450], [1.2, 375], [1.5, 300]]) assert.equal(fishThoughtGapMs(rate, { exact: true }), gap, String(rate));
    assert.equal(fishThoughtGapMs(1.5), 350, 'the old way, without exact');
    const pcm = voiced(1);
    const padded = padFishTail(pcm, 1.5, RATE, { exact: true });
    assert.ok(Math.abs(secondsOf(padded) - 1 - 0.22) < 0.012, `${secondsOf(padded)}`);
  });
  withEnv({ FISH_THOUGHT_GAPS: '0' }, () => assert.equal(fishThoughtGapMs(1.5, { exact: true }), 0));
});

test('the header number: before over after to 3 decimals, 1 when nothing was stretched', () => {
  assert.equal(fishSpeedApplied({ before: 24000, after: 16000 }), '1.500');
  assert.equal(fishSpeedApplied({ before: 24000, after: 32000 }), '0.750');
  assert.equal(fishSpeedApplied({ before: 24000, after: 24000 }), '1');
  assert.equal(fishSpeedApplied({ before: 0, after: 0 }), '1');
  assert.equal(fishSpeedApplied(), '1');
});

test('the run-on guard logs the number with exact and the pace name without', () => {
  const lines = [];
  const wav = Buffer.concat([Buffer.alloc(44), voiced(1)]);
  runaway.checkTake('Sure, that works for me.', wav, { rate: 1.3, exact: true, log: (l) => lines.push(l) });
  runaway.checkTake('Sure, that works for me.', wav, { exact: true, log: (l) => lines.push(l) });
  runaway.checkTake('Sure, that works for me.', wav, { rate: 1.3, log: (l) => lines.push(l) });
  assert.match(lines[0], / speed=1\.3 /);
  assert.doesNotMatch(lines[0], /pace=/);
  assert.match(lines[1], / speed=1 /);
  assert.match(lines[2], / pace=Brisk /);
});

// ── fish-stretch.js: lanes, with workers that misbehave on purpose ─────────────────────────────
const FAKE_HEAD = 'import os,struct,sys,time\nR=struct.Struct("<IdII");S=struct.Struct("<III");i=sys.stdin.buffer;o=sys.stdout.buffer\n' +
  'def send(a,b,c=b""):\n  o.write(S.pack(a,b,len(c)));o.write(c);o.flush()\n';
const FAKE_LOOP = 'while True:\n  h=i.read(R.size)\n  if len(h)<R.size: sys.exit(0)\n  n,ratio,sr,c=R.unpack(h)\n  pcm=i.read(c)\n';
const GOOD_CLIP = '  send(n,0,pcm[:int(len(pcm)/ratio)//2*2])\n';
function fakeWorker(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-exact-fake-'));
  const file = path.join(dir, 'worker.py');
  fs.writeFileSync(file, FAKE_HEAD + `F=${JSON.stringify(path.join(dir, 'flag'))}\n` + body);
  return file;
}
const fakeRun = (body, options, fn) => async () => {
  const logged = [];
  const s = createFishStretch({ python: PYTHON, script: fakeWorker(body), backoffMs: 50, log: (l) => logged.push(l), ...options });
  try { await fn(s, logged); } finally { s.stop(); }
};
const STUCK = `send(0,0)\n${FAKE_LOOP}  time.sleep(60)\n`;
// Dies on the first clip it ever sees, across restarts; afterwards a good worker.
const DIES_ONCE = `send(0,0)\n${FAKE_LOOP}  if not os.path.exists(F):\n    open(F,"w").close()\n    sys.exit(1)\n${GOOD_CLIP}`;
const DIES_ALWAYS = `send(0,0)\n${FAKE_LOOP}  sys.exit(1)\n`;
const SLOW = (ms) => `send(0,0)\n${FAKE_LOOP}  time.sleep(${ms / 1000})\n${GOOD_CLIP}`;
const stretchedTo = (out, pcm, ratio) => out !== pcm && Math.abs(out.length - pcm.length / ratio) <= 2;

test('a live-call clip goes first, ahead of everything but the clip in the worker and earlier calls', { skip: NEEDS_PYTHON },
  fakeRun(SLOW(120), { timeoutMs: 8000, callMs: 8000, startWaitMs: 8000 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const order = [];
    const ask = (name, lane) => s.stretch(voiced(0.5), 1.5, RATE, { lane }).then(() => order.push(name));
    const all = [ask('in the worker', 'chat')];
    await sleep(30);
    all.push(ask('chat', 'chat'), ask('reading', 'reading'), ask('first call', 'call'), ask('second call', 'call'));
    await Promise.all(all);
    assert.deepEqual(order, ['in the worker', 'first call', 'second call', 'chat', 'reading']);
  }));

test('a stuck worker costs each lane its own patience', { skip: NEEDS_PYTHON },
  fakeRun(STUCK, { stuckMs: 60000 }, async (s, logged) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    let t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'call' }), pcm);
    let took = Date.now() - t;
    assert.ok(took >= 550 && took < 1000, `call took ${took} ms`);
    t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'chat' }), pcm);
    took = Date.now() - t;
    assert.ok(took >= 1900 && took < 2500, `chat took ${took} ms`);
    assert.ok(logged.some((l) => /too slow/.test(l)), logged.join('\n'));
  }));

test('reading waits out its own patience and no less when the worker is merely slow', { skip: NEEDS_PYTHON },
  fakeRun(SLOW(600), { timeoutMs: 100, stuckMs: 5000, readingMs: 5000 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'chat' }), pcm, 'chat gave up at its 100 ms');
    assert.ok(stretchedTo(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm, 1.5), 'reading was still there');
    assert.equal(s.health().restarts, 0, 'slow is not stuck');
  }));

test('a patient clip gives up at its patience even with the worker running on it', { skip: NEEDS_PYTHON },
  fakeRun(STUCK, { stuckMs: 60000, readingMs: 250 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(Date.now() - t < 700, `${Date.now() - t} ms`);
  }));

test('a patient clip does not let a stuck worker hang for its 20 s: replaced at the stuck limit', { skip: NEEDS_PYTHON },
  fakeRun(STUCK, { stuckMs: 200 }, async (s, logged) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pid = s.pid();
    const pcm = voiced(1);
    const t = Date.now();
    const asked = s.stretch(pcm, 1.5, RATE, { lane: 'reading' });
    assert.ok(await until(() => s.pid() !== pid, 1500), 'replaced well inside the 20 s');
    assert.ok(Date.now() - t < 1500);
    assert.ok(logged.some((l) => /too long on a clip/.test(l)), logged.join('\n'));
    assert.equal(await asked, pcm, 'the next worker stuck too, so it comes back as it was');
    assert.ok(Date.now() - t < 5000, `${Date.now() - t} ms, not 20 s`);
  }));

test('a long clip gets more of the worker before it counts as stuck', { skip: NEEDS_PYTHON },
  fakeRun(SLOW(400), { timeoutMs: 8000, stuckMs: 100, readingMs: 8000 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(10); // 1 s of room at 100 ms per second of speech
    assert.ok(stretchedTo(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm, 1.5));
    assert.equal(s.health().restarts, 0);
  }));

test('a patient clip lives through one worker restart; a chat clip settles at once', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ONCE, {}, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    const out = await s.stretch(pcm, 1.5, RATE, { lane: 'reading' });
    assert.ok(stretchedTo(out, pcm, 1.5), 'stretched by the next worker');
    assert.equal(s.health().restarts, 1);
    assert.equal(s.health().stretched, 1);
  }));

test('a chat or call clip does not wait on the restart', { skip: NEEDS_PYTHON }, async () => {
  for (const lane of ['chat', 'call']) {
    await fakeRun(DIES_ONCE, { timeoutMs: 8000, callMs: 8000 }, async (s) => {
      s.warm();
      assert.ok(await until(() => s.health().ready));
      const pcm = voiced(1);
      const t = Date.now();
      assert.equal(await s.stretch(pcm, 1.5, RATE, { lane }), pcm, lane);
      assert.ok(Date.now() - t < 500, `${lane}: ${Date.now() - t} ms`);
    })();
  }
});

test('patient clips waiting in the queue live through the restart too, in order', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ONCE, {}, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const clips = [voiced(1), voiced(1.5), voiced(2)];
    const out = await Promise.all(clips.map((pcm) => s.stretch(pcm, 1.5, RATE, { lane: 'reading' })));
    out.forEach((o, i) => assert.ok(stretchedTo(o, clips[i], 1.5), `clip ${i}`));
  }));

test('during the backoff a patient clip waits for the worker and a chat clip does not', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ONCE, { backoffMs: 400 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pid = s.pid();
    const pcm = voiced(1);
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'chat' }), pcm, 'this one takes the worker down');
    assert.ok(await until(() => s.pid() !== pid));
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'chat' }), pcm);
    assert.ok(Date.now() - t < 20, 'chat does not wait on the backoff');
    assert.ok(stretchedTo(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm, 1.5));
  }));

test('a patient clip does not wait on a backoff longer than its patience', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ONCE, { backoffMs: 3000, readingMs: 200 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    const first = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm, 'the restart is too far off to wait for');
    assert.ok(Date.now() - first < 500, `${Date.now() - first} ms`);
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(Date.now() - t < 20);
  }));

test('a worker that keeps dying: a clip survives one restart, then nobody waits on it', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ALWAYS, { backoffMs: 40 }, async (s) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(1);
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(s.health().restarts >= 1);
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms, not 20 s`);
  }));

test('no Python at all: reading clips come back soon, not after 20 s each', async () => {
  const logged = [];
  const s = createFishStretch({ python: MISSING, backoffMs: 30, log: (l) => logged.push(l) });
  try {
    const pcm = voiced(1);
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
    const t2 = Date.now();
    assert.equal(await s.stretch(pcm, 1.5, RATE, { lane: 'reading' }), pcm);
    assert.ok(Date.now() - t2 < 20, 'it has already seen two workers fail');
    assert.ok(logged.every((l) => /^\[TTS\] fish stretch: worker could not start \(ENOENT\) -- original audio kept$/.test(l)), logged.join('\n'));
  } finally { s.stop(); }
});

test('with the queue full a live-call clip still gets in; nothing else does', { skip: NEEDS_PYTHON },
  fakeRun(SLOW(40), { timeoutMs: 8000, callMs: 8000, readingMs: 30000, stuckMs: 8000 }, async (s, logged) => {
    s.warm();
    assert.ok(await until(() => s.health().ready));
    const pcm = voiced(0.5);
    const queued = [];
    for (let i = 0; i < 33; i++) queued.push(s.stretch(voiced(0.5), 1.5, RATE, { lane: 'reading' }));
    const late = voiced(0.5);
    assert.equal(await s.stretch(late, 1.5, RATE, { lane: 'chat' }), late, 'the queue is full');
    assert.ok(logged.some((l) => /queue is full/.test(l)));
    const t = Date.now();
    assert.ok(stretchedTo(await s.stretch(pcm, 1.5, RATE, { lane: 'call' }), pcm, 1.5));
    assert.ok(Date.now() - t < 500, `${Date.now() - t} ms, first in line`);
    await Promise.all(queued);
  }));

test('health shows the slowest clip, and the wait between restarts tops out', { skip: NEEDS_PYTHON },
  fakeRun(SLOW(80), { timeoutMs: 8000 }, async (s) => {
    assert.equal(s.health().slowestClipMs, 0);
    s.warm();
    assert.ok(await until(() => s.health().ready));
    await s.stretch(voiced(0.5), 1.5, RATE, { lane: 'chat' });
    await s.stretch(voiced(2), 1.5, RATE, { lane: 'chat' });
    const h = s.health();
    assert.ok(h.slowestClipMs >= 70, `${h.slowestClipMs} ms`);
    assert.ok(h.slowestClipSeconds === 0.5 || h.slowestClipSeconds === 2, `${h.slowestClipSeconds} s`);
    assert.equal(BACKOFF_MAX_MS, 30000);
  }));

test('the wait between restarts stops climbing at the ceiling', { skip: NEEDS_PYTHON },
  fakeRun(DIES_ALWAYS, { backoffMs: 40, backoffMaxMs: 80 }, async (s) => {
    const pcm = voiced(1);
    s.warm();
    const gaps = [];
    for (let i = 0; i < 5; i++) {
      assert.ok(await until(() => s.health().ready));
      const pid = s.pid();
      await s.stretch(pcm, 1.5, RATE);
      assert.ok(await until(() => s.pid() !== pid));
      const down = Date.now();
      assert.ok(await until(() => s.pid() && s.health().ready));
      gaps.push(Date.now() - down);
    }
    // The imports are in here too, so only the ceiling's rough size can be pinned: 1280 ms unchecked.
    assert.ok(gaps[4] < 800, gaps.join(', '));
  }));

test('the real worker: the whole list, length within 3 percent and pitch kept', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, readingMs: 8000, stuckMs: 8000 });
  try {
    const pcm = voiced(6);
    const before = crossingsPerSecond(pcm);
    for (const ratio of [...THE_LIST, 0.5]) {
      const out = await s.stretch(pcm, ratio, RATE, { lane: 'reading' });
      assert.notEqual(out, pcm, `${ratio}: the worker answered`);
      const wanted = secondsOf(pcm) / ratio;
      assert.ok(Math.abs(secondsOf(out) - wanted) / wanted < 0.03, `${ratio}: ${secondsOf(out)} s, wanted ${wanted}`);
      const after = crossingsPerSecond(out);
      assert.ok(Math.abs(after - before) / before < 0.04, `${ratio}: ${after} crossings per second, was ${before}`);
    }
    assert.ok(s.health().slowestClipMs > 0);
    assert.ok(s.health().slowestClipSeconds === 6);
  } finally { s.stop(); }
});

test('the real worker killed mid-clip: a reading clip still comes out stretched', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, stuckMs: 8000, startWaitMs: 8000, backoffMs: 100, log: () => {} });
  try {
    const warm = voiced(1);
    assert.notEqual(await s.stretch(warm, 1.5, RATE, { lane: 'chat' }), warm);
    const pid = s.pid();
    const long = voiced(85);
    const asked = s.stretch(long, 1.3, RATE, { lane: 'reading' });
    await sleep(40);
    process.kill(pid);
    const out = await asked;
    assert.notEqual(out, long);
    assert.ok(Math.abs(secondsOf(out) - 85 / 1.3) / (85 / 1.3) < 0.03);
    assert.equal(s.health().restarts, 1);
  } finally { s.stop(); }
});

// ── the real fishSynthesizeChunk, with the worker stubbed ──────────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (from, to) => { const i = source.indexOf(from); return source.slice(i, source.indexOf(to, i)); };
function loadChunk({ takes, stretch }) {
  const state = { calls: 0, logged: [], warned: [], noted: [], asked: [], inSlot: false, askedInSlot: false, bodies: [] };
  const context = {
    console: { warn: (l) => state.warned.push(l), log: (l) => state.logged.push(l) }, Buffer, Math, AbortController, setTimeout, clearTimeout, process,
    noteChunk: (k) => state.noted.push(k), sleep: async () => {},
    fishLimiter: async (fn) => { state.inSlot = true; try { return await fn(); } finally { state.inSlot = false; } },
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: null,
    fishPacedText: pace.fishPacedText, fishApiSpeed: pace.fishApiSpeed, capFishPauses, fishStretchRatio: pace.fishStretchRatio,
    fishStretch: { stretch: (pcm, ratio, rate, options) => { state.asked.push({ bytes: pcm.length, ratio, rate, lane: options && options.lane }); state.askedInSlot = state.inSlot; return stretch(pcm, ratio, rate); } },
    fishRunaway: { ...runaway, checkTake: (text, wav, opts) => runaway.checkTake(text, wav, { ...opts, log: (l) => state.logged.push(l) }) },
    FISH_API_KEY: 'fake-test-key', FISH_TIMEOUT_MS: 1000, FISH_SAMPLE_RATE: RATE, FISH_TTS_LATENCY: 'normal',
    FISH_TEMPERATURE: 0.9, FISH_TEMPERATURE_MAX: 1, FISH_TOP_P: 0.85, FISH_NORMALIZE: false, FISH_TEMPERATURE_BY_DELIVERY: {},
    fetch: async (_url, options) => {
      state.bodies.push(options.body);
      const pcm = takes[Math.min(state.calls++, takes.length - 1)];
      return { ok: true, arrayBuffer: async () => pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length) };
    },
  };
  vm.runInNewContext(cut('const FISH_TTS_MODEL =', 'const FISH_TTS_LATENCY =') + '\n' +
    cut('function buildWavHeader(', '// Aug 6 2026') + '\n' +
    cut('async function fishSynthesizeChunkOnce(', 'app.get("/health"') + '\nthis.synthesize = fishSynthesizeChunk;', context);
  return { synthesize: context.synthesize, state };
}
const copy = async (pcm) => Buffer.from(pcm);
const shrink = (ratio) => async (pcm) => {
  const wanted = Math.round(pcm.length / 2 / ratio);
  const out = Buffer.alloc(wanted * 2);
  for (let i = 0; i < wanted; i++) out.writeInt16LE(pcm.readInt16LE(Math.min(Math.floor(i * ratio), pcm.length / 2 - 1) * 2), i * 2);
  return out;
};
const EXACT = { exact: true, lane: 'chat' };
const withGap = () => Buffer.concat([voiced(1), Buffer.alloc(2 * Math.round(RATE * 1.5)), voiced(1)]);
const SAID = 'I have some news about the ladder and the gutters.';

test('exact: the number and the lane reach the worker on talk, not talk and a live call; never inside the Fish slot', async () => {
  for (const rate of [0.75, 1.1, 1.3, 1.5]) {
    for (const [talk, options] of [[{ turn: 0 }, EXACT], [false, { exact: true, lane: 'reading' }], [false, { exact: true, liveCall: true, lane: 'call' }], [{ turn: 0 }, { exact: true, liveCall: true, lane: 'call' }]]) {
      const run = loadChunk({ takes: [voiced(2)], stretch: shrink(rate) });
      const wav = await run.synthesize('Sure, that works for me.', 'legacy-id', rate, undefined, talk, options);
      assert.deepEqual(run.state.asked, [{ bytes: voiced(2).length, ratio: rate, rate: RATE, lane: options.lane }]);
      assert.equal(run.state.askedInSlot, false);
      assert.ok(Math.abs((wav.length - 44) / 2 / RATE - 2 / rate) < 0.01);
      assert.equal(wav.readUInt32LE(40), wav.length - 44);
      assert.equal(JSON.parse(run.state.bodies[0]).prosody.speed, 1);
    }
  }
});

test('exact: speed 1 and no speed never touch the worker and send what Natural sends', async () => {
  for (const rate of [1, undefined]) {
    for (const talk of [{ turn: 0 }, false]) {
      const today = loadChunk({ takes: [withGap()], stretch: copy });
      const exact = loadChunk({ takes: [withGap()], stretch: copy });
      const a = await today.synthesize(SAID, 'legacy-id', 1, undefined, talk);
      const b = await exact.synthesize(SAID, 'legacy-id', rate, undefined, talk, EXACT);
      assert.equal(exact.state.asked.length, 0);
      assert.deepEqual(exact.state.bodies, today.state.bodies);
      assert.equal(Buffer.compare(a, b), 0);
    }
  }
});

test('exact: the run-on guard judges the unstretched take and logs the number; a clip that failed is never stretched', async () => {
  const run = loadChunk({ takes: [voiced(4)], stretch: shrink(2) });
  await assert.rejects(run.synthesize('Sure!', 'legacy-id', 1.5, undefined, { turn: 0 }, EXACT), (e) => e.isRunaway === true);
  assert.equal(run.state.calls, 2, 'one fresh request, as always');
  assert.equal(run.state.asked.length, 0);
  assert.match(run.state.logged[0], /seconds=4\.00 /);
  assert.match(run.state.logged[0], / speed=1\.5 /);
  // A run-on Praat would have hidden at 1.5x, and a fresh take gets the stretch.
  const again = loadChunk({ takes: [voiced(5), voiced(2)], stretch: copy });
  await again.synthesize('Sure!', 'legacy-id', 1.5, undefined, { turn: 0 }, EXACT);
  assert.equal(again.state.asked[0].bytes, voiced(2).length);
});

test('exact: Praat gets the take before the cap, and the cap afterward is natural / rate, natural below 1x', async () => {
  const take = withGap();
  for (const [rate, cap] of [[1.2, 500 / 1.2], [1.5, 500 / 1.5], [1.1, 500 / 1.1], [0.75, 500], [0.9, 500]]) {
    const run = loadChunk({ takes: [take], stretch: copy });
    const wav = await run.synthesize(SAID, 'legacy-id', rate, undefined, { turn: 0 }, EXACT);
    assert.equal(run.state.asked[0].bytes, take.length, 'the uncapped take');
    const ms = longestInnerSilenceMs(wav.subarray(44));
    assert.ok(Math.abs(ms - cap) <= 20, `${rate}: ${ms} ms of quiet, cap ${cap}`);
  }
});

test('exact: FISH_NATURAL_PAUSE_CAP_MS is the natural the number divides', async () => {
  await withEnvAsync({ FISH_NATURAL_PAUSE_CAP_MS: '300' }, async () => {
    const run = loadChunk({ takes: [withGap()], stretch: copy });
    const wav = await run.synthesize(SAID, 'legacy-id', 1.5, undefined, { turn: 0 }, EXACT);
    const ms = longestInnerSilenceMs(wav.subarray(44));
    assert.ok(Math.abs(ms - 200) <= 20, `${ms} ms of quiet`);
  });
});

test('exact: when the worker gives the clip back, the clip is the 1x Natural take and the tally says nothing moved', async () => {
  const natural = loadChunk({ takes: [withGap()], stretch: copy });
  const a = await natural.synthesize(SAID, 'legacy-id', 1, undefined, { turn: 0 });
  const tally = { before: 0, after: 0 };
  const kept = loadChunk({ takes: [withGap()], stretch: async (pcm) => pcm });
  const b = await kept.synthesize(SAID, 'legacy-id', 1.5, undefined, { turn: 0 }, { ...EXACT, tally });
  assert.equal(kept.state.asked.length, 1);
  assert.equal(Buffer.compare(a, b), 0);
  assert.equal(tally.before, tally.after);
  assert.equal(fishSpeedApplied(tally), '1');
});

test('exact: a stretch that breaks its promise cannot lose the reply', async () => {
  const tally = { before: 0, after: 0 };
  const run = loadChunk({ takes: [voiced(2)], stretch: async () => { throw new Error('should not happen'); } });
  const wav = await run.synthesize('Sure, that works for me.', 'legacy-id', 1.5, undefined, { turn: 0 }, { ...EXACT, tally });
  assert.ok(Math.abs((wav.length - 44) / 2 / RATE - 2) < 0.01);
  assert.equal(fishSpeedApplied(tally), '1');
});

test('the tally is the audio only, across chunks, and reports what really came out', async () => {
  const tally = { before: 0, after: 0 };
  for (const stretch of [shrink(1.5), async (pcm) => pcm]) {
    const run = loadChunk({ takes: [voiced(3)], stretch });
    await run.synthesize('Sure, that works for me.', 'legacy-id', 1.5, undefined, { turn: 0 }, { ...EXACT, tally });
  }
  assert.equal(tally.before, 2 * voiced(3).length);
  assert.equal(tally.after, Math.round(voiced(3).length / 1.5) + voiced(3).length);
  assert.equal(fishSpeedApplied(tally), '1.200');
});

test('the switch off: the old rules, with no lane and a tally that still tells the truth', async () => {
  await withEnvAsync({ FISH_PACE_STRETCH: '1' }, async () => {
    const tally = { before: 0, after: 0 };
    const run = loadChunk({ takes: [voiced(2)], stretch: shrink(1.1) });
    await run.synthesize('Sure, that works for me.', 'legacy-id', 1.5, undefined, { turn: 0 }, { tally });
    assert.deepEqual(run.state.asked, [{ bytes: voiced(2).length, ratio: 1.1, rate: RATE, lane: undefined }]);
    assert.match(JSON.parse(run.state.bodies[0]).text, /^\[fast-talking/);
    assert.equal(fishSpeedApplied(tally), '1.100');
    for (const [talk, options] of [[false, {}], [{ turn: 0 }, { liveCall: true }]]) {
      const out = loadChunk({ takes: [voiced(2)], stretch: copy });
      await out.synthesize('Sure, that works for me.', 'legacy-id', 1.5, undefined, talk, options);
      assert.equal(out.state.asked.length, 0, JSON.stringify(options));
    }
  });
});

// ── through the real HTTP handler, with the worker stubbed ─────────────────────────────────────
const INPUT = 'I finally finished the quilt for my sister last night and it came out better than I hoped.';
const TWO_SENTENCES = 'I finally finished the quilt for my sister last night. It came out better than I hoped it would.';
const TWO_PARAGRAPHS = 'I finally finished the quilt for my sister last night.\n\nIt came out better than I hoped it would.';
const SCENE = '[[Ann]] We won the whole thing today! [[Bob]] I knew we could do it all along.';
const CLEAR = ['FISH_DIRECTOR', 'INWORLD_WRITER', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'FISH_RUNAWAY_GUARD', 'KADE_SPEECH_SECRET',
  'FISH_SPEED_EXACT', 'FISH_PACE_STRETCH', 'FISH_PACE_SPEED', 'FISH_NATURAL_PAUSE_CAP_MS', 'FISH_SENTENCE_PAUSES', 'FISH_THOUGHT_GAPS', 'TTS_TALK_CALM', 'SELECTED_VOICES_ENABLED', 'SCENE_CAST', 'GAP_MS', 'SCENE_GAP_MS'];

async function bootProxy(PORT, extra = {}, { stub = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-exact-'));
  const receipt = path.join(dir, 'requests.jsonl');
  const stretches = path.join(dir, 'stretches.jsonl');
  fs.writeFileSync(receipt, '');
  fs.writeFileSync(stretches, '');
  const env = { ...process.env };
  for (const k of CLEAR) delete env[k];
  Object.assign(env, { PORT: String(PORT), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, STRETCH_RECEIPT: stretches, SCENE_CAST: 'ann=fish:ann;bob=fish:bob', ...extra });
  const preload = ['--require', path.join(__dirname, 'test-fixtures/provider.cjs')];
  if (stub) preload.push('--require', path.join(__dirname, 'test-fixtures/stretch-stub.cjs'));
  const child = spawn(process.execPath, [...preload, 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  const lines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const url = `http://127.0.0.1:${PORT}`;
  async function say(body = {}, headers = {}, query = '') {
    const beforeCalls = lines(receipt).length;
    const beforeAsked = lines(stretches).length;
    const r = await fetch(`${url}/v1/audio/speech${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ voice: 'fish:fixture', input: INPUT, ...body }),
    });
    assert.equal(r.status, 200, log.slice(-2000));
    const audio = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || '';
    const seconds = type.includes('audio/basic') ? audio.length / 8000 : Math.max(0, audio.length - 44) / 2 / RATE;
    return { audio, type, seconds, applied: r.headers.get('x-kade-tts-speed-applied'), calls: lines(receipt).slice(beforeCalls), asked: lines(stretches).slice(beforeAsked) };
  }
  const health = async () => (await (await fetch(`${url}/health`)).json()).fishStretch;
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    try { ready = (await fetch(`${url}/`)).status < 500; } catch {}
    if (!ready) await sleep(50);
  }
  assert.ok(ready, log);
  return { say, health, log: () => log, stop: async () => { child.kill(); if (child.exitCode === null) await new Promise((r) => child.once('exit', r)); } };
}
// The fixture's clip is half a second of tone with no silence in it.
const talkTail = (rate) => (Math.min(500, Math.max(300, 450 / rate)) - 80) / 1000;
const BRIDGE_PHONE = { 'x-kade-caller': 'bridge-phone' };
const BRIDGE_WEB = { 'x-kade-caller': 'bridge-voice' };
const ON = { FISH_SPEED_EXACT: '1', FISH_PACE_STRETCH: '1', FISH_PACE_SPEED: '1' };

test('handler, switch on: every path gets the exact number in its own lane, prosody.speed 1 and the header', async () => {
  const p = await bootProxy(31931, ON);
  try {
    const paths = [
      ['chat', {}, {}, '', 'chat', 1],
      ['chat from the fork', {}, { 'x-kade-caller': 'fork-tts' }, '', 'chat', 1],
      ['reading seat', {}, { 'x-kade-tts-session': 'reading:book-1' }, '', 'reading', 1],
      ['STABLE', { delivery: 'STABLE' }, {}, '', 'reading', 1],
      ['described video', { delivery: 'STABLE' }, { 'x-kade-caller': 'fork-described-video' }, '', 'reading', 1],
      ['the describer by name alone', {}, { 'x-kade-caller': 'fork-described-video' }, '', 'reading', 1],
      ['phone', {}, BRIDGE_PHONE, '?telephony=1', 'call', 1],
      ['phone, not talk', { delivery: 'STABLE' }, BRIDGE_PHONE, '?telephony=1', 'call', 1],
      ['telephony with no caller name', {}, {}, '?telephony=1', 'call', 1],
      ['web call', {}, BRIDGE_WEB, '', 'call', 1],
      ['web call, not talk', { delivery: 'STABLE' }, BRIDGE_WEB, '', 'call', 1],
      ['voicemail through the bridge', {}, { 'x-kade-caller': 'bridge-voicemail' }, '', 'call', 1],
      ['scene', { input: SCENE }, {}, '', 'chat', 2],
      ['scene while reading', { input: SCENE, delivery: 'STABLE' }, {}, '', 'reading', 2],
      ['scene on the phone', { input: SCENE }, BRIDGE_PHONE, '?telephony=1', 'call', 2],
      ['scene on a web call', { input: SCENE }, BRIDGE_WEB, '', 'call', 2],
    ];
    for (const [name, body, headers, query, lane, clips] of paths) {
      for (const speed of [0.75, 1.1, 1.3, 1.5]) {
        const r = await p.say({ ...body, speed }, headers, query);
        assert.equal(r.asked.length, clips, `${name} ${speed}`);
        assert.ok(r.asked.every((a) => a.ratio === speed && a.lane === lane && a.rate === RATE && a.bytes === 24000), `${name} ${speed}: ${JSON.stringify(r.asked)}`);
        assert.ok(r.calls.length === clips && r.calls.every((c) => c.body.prosody.speed === 1), `${name} ${speed}: never both`);
        assert.equal(Number(r.applied), speed, `${name} ${speed}: header ${r.applied}`);
        assert.doesNotMatch(r.calls[0].body.text, /speaking quickly|fast-talking|unhurriedly|easygoing/, name);
        assert.equal(r.type.includes('audio/basic'), query === '?telephony=1', name);
      }
    }
    assert.equal((await p.health()).exact, true);
    assert.equal((await p.health()).on, true);
  } finally { await p.stop(); }
});

test('handler, switch on: a preview gets the number too; saved numbers off the list work; the range still holds', async () => {
  const p = await bootProxy(31932, ON);
  try {
    for (const [speed, ratio] of [[1.05, 1.05], [1.37, 1.37], [0.6, 0.6], [2, 1.5], [0.2, 0.5]]) {
      const r = await p.say({ speed });
      assert.deepEqual(r.asked.map((a) => a.ratio), [ratio], String(speed));
    }
    const words = await p.say({ speed: '1.2' });
    assert.equal(words.asked.length, 0, 'a number in a string is no number, as today');
    assert.equal(words.applied, '1');
    const r = await p.say({ input: 'Hi there. This is how I sound.', speed: 1.3 });
    assert.ok(r.asked.length >= 1);
    assert.ok(r.asked.every((a) => a.ratio === 1.3 && a.lane === 'chat'), JSON.stringify(r.asked));
    assert.equal(Number(r.applied), 1.3);
  } finally { await p.stop(); }
});

test('handler, switch on: speed 1 and no speed never reach the worker; request and audio equal today\'s Natural', async () => {
  const off = await bootProxy(31933, {});
  const on = await bootProxy(31934, ON);
  try {
    const requests = [
      [{ input: TWO_SENTENCES }, {}, ''],
      [{ input: TWO_SENTENCES, speed: 1 }, {}, ''],
      [{ input: TWO_PARAGRAPHS, speed: 1 }, {}, ''],
      [{ input: TWO_SENTENCES, delivery: 'STABLE' }, {}, ''],
      [{ input: TWO_SENTENCES, speed: 1 }, { 'x-kade-tts-session': 'reading:book-1' }, ''],
      [{ input: SCENE, speed: 1 }, {}, ''],
      [{ input: TWO_SENTENCES, speed: 1 }, BRIDGE_PHONE, '?telephony=1'],
      [{ input: TWO_SENTENCES }, BRIDGE_WEB, ''],
    ];
    for (const [body, headers, query] of requests) {
      const a = await off.say(body, headers, query);
      const b = await on.say(body, headers, query);
      const label = JSON.stringify([body, query]);
      assert.equal(a.asked.length + b.asked.length, 0, label);
      assert.deepEqual(b.calls, a.calls, label);
      assert.equal(Buffer.compare(a.audio, b.audio), 0, label);
      assert.equal(a.applied, '1', label);
      assert.equal(b.applied, '1', label);
    }
  } finally { await off.stop(); await on.stop(); }
});

test('handler, switch on: every speed sends Fish the very text Natural sends, added sentence pauses included', async () => {
  const p = await bootProxy(31935, ON);
  try {
    const natural = await p.say({ input: TWO_SENTENCES, speed: 1 });
    assert.match(natural.calls[0].body.text, /\[short pause\]/);
    for (const speed of [...THE_LIST, 0.5, 1.05]) {
      const r = await p.say({ input: TWO_SENTENCES, speed });
      assert.deepEqual(r.calls.map((c) => c.body), natural.calls.map((c) => c.body), String(speed));
    }
    const read = await p.say({ input: TWO_SENTENCES, speed: 1.5, delivery: 'STABLE' });
    assert.match(read.calls[0].body.text, /\[short pause\]/);
  } finally { await p.stop(); }
});

test('handler, switch on: chat ends on a stop sized to the number; seams and scene gaps as specified', async () => {
  const p = await bootProxy(31936, ON);
  try {
    for (const speed of THE_LIST) {
      const { seconds } = await p.say({ speed });
      const wanted = 0.5 / speed + talkTail(speed);
      assert.ok(Math.abs(seconds - wanted) < 0.012, `${speed}: ${seconds} s, wanted ${wanted}`);
    }
    const chat = await p.say({ input: TWO_PARAGRAPHS, speed: 1.5 });
    assert.equal(chat.asked.length, 2);
    assert.ok(Math.abs(chat.seconds - (2 * (0.5 / 1.5) + 0.3 + talkTail(1.5))) < 0.02, `chat seam at 1.5: ${chat.seconds} s`);
    const reading = await p.say({ input: TWO_PARAGRAPHS, speed: 1.5, delivery: 'STABLE' });
    assert.ok(Math.abs(reading.seconds - (2 * (0.5 / 1.5) + 0.34)) < 0.02, `reading keeps GAP_MS: ${reading.seconds} s`);
    const scene = await p.say({ input: SCENE, speed: 1.5 });
    assert.ok(Math.abs(scene.seconds - (2 * (0.5 / 1.5) + 0.28)) < 0.02, `scene keeps SCENE_GAP_MS: ${scene.seconds} s`);
  } finally { await p.stop(); }
});

test('handler: fishSpeed legacy is today\'s behavior for that one request, switch on or off', async () => {
  const off = await bootProxy(31937, { FISH_PACE_STRETCH: '1', FISH_PACE_SPEED: '1' });
  const on = await bootProxy(31938, ON);
  try {
    const requests = [
      [{ speed: 1.5, delivery: 'STABLE', input: TWO_SENTENCES }, { 'x-kade-caller': 'fork-described-video' }, ''],
      [{ speed: 1.2, input: TWO_SENTENCES }, {}, ''],
      [{ speed: 1.5, input: TWO_PARAGRAPHS }, {}, ''],
      [{ speed: 0.75, input: TWO_SENTENCES }, {}, ''],
      [{ speed: 1.5, input: SCENE }, {}, ''],
      [{ speed: 1.5 }, BRIDGE_PHONE, '?telephony=1'],
      [{ speed: 1.5 }, BRIDGE_WEB, ''],
    ];
    for (const [body, headers, query] of requests) {
      const a = await off.say(body, headers, query);
      const b = await on.say({ ...body, fishSpeed: 'legacy' }, headers, query);
      const label = JSON.stringify([body, query]);
      assert.deepEqual(b.calls, a.calls, label);
      assert.deepEqual(b.asked, a.asked, label);
      assert.equal(Buffer.compare(a.audio, b.audio), 0, label);
      assert.equal(a.applied, b.applied, label);
    }
    const described = await on.say({ speed: 1.5, delivery: 'STABLE', fishSpeed: 'legacy' }, { 'x-kade-caller': 'fork-described-video' });
    assert.match(described.calls[0].body.text, /^\[fast-talking/);
    assert.equal(described.asked.length, 0);
    assert.equal(described.applied, '1');
    const chat = await on.say({ speed: 1.5, fishSpeed: 'legacy' });
    assert.deepEqual(chat.asked.map((x) => [x.ratio, x.lane]), [[1.1, null]]);
    assert.equal(chat.applied, '1.100');
    const call = await on.say({ speed: 1.5, fishSpeed: 'legacy' }, BRIDGE_PHONE, '?telephony=1');
    assert.equal(call.calls[0].body.prosody.speed, 1.1, 'today\'s call');
    assert.equal(call.asked.length, 0);
    // And the very next request without the field is exact again.
    const next = await on.say({ speed: 1.5 });
    assert.deepEqual(next.asked.map((x) => [x.ratio, x.lane]), [[1.5, 'chat']]);
    // Any other value is not the field.
    const other = await on.say({ speed: 1.5, fishSpeed: 'exact' });
    assert.deepEqual(other.asked.map((x) => x.ratio), [1.5]);
  } finally { await off.stop(); await on.stop(); }
});

test('handler, switch off: today\'s named paces, the worker is not asked unless the old switch says so', async () => {
  const p = await bootProxy(31939, {});
  try {
    const r = await p.say({ speed: 1.5 });
    assert.match(r.calls[0].body.text, /^\[fast-talking/);
    assert.equal(r.calls[0].body.prosody.speed, 1);
    assert.equal(r.asked.length, 0);
    assert.equal(r.applied, '1');
    const slow = await p.say({ speed: 0.75 });
    assert.match(slow.calls[0].body.text, /^\[Speak unhurriedly/);
    assert.equal(slow.asked.length, 0);
    const h = await p.health();
    assert.equal(h.on, false);
    assert.equal(h.exact, false);
  } finally { await p.stop(); }
});

test('handler: the header says what really came out, on both lanes, and on an empty reply', async () => {
  const kept = await bootProxy(31940, { ...ON, STRETCH_STUB: 'keep' });
  const mixed = await bootProxy(31941, { ...ON, STRETCH_STUB: 'alternate' });
  try {
    for (const [body, headers, query] of [[{ speed: 1.5 }, {}, ''], [{ speed: 1.5, input: SCENE }, {}, ''], [{ speed: 1.5 }, BRIDGE_PHONE, '?telephony=1'], [{ speed: 1.5, input: SCENE }, BRIDGE_PHONE, '?telephony=1']]) {
      const r = await kept.say(body, headers, query);
      assert.ok(r.asked.length >= 1);
      assert.equal(r.applied, '1', JSON.stringify(body));
    }
    const kept15 = await kept.say({ speed: 1.5 });
    assert.ok(Math.abs(kept15.seconds - (0.5 + talkTail(1.5))) < 0.012, 'the 1x take, and the stop for the number asked');
    const two = await mixed.say({ input: TWO_PARAGRAPHS, speed: 1.5 });
    assert.equal(two.asked.length, 2);
    assert.equal(two.applied, '1.200', 'one chunk at 1.5 and one at 1: (24000 + 24000) / (16000 + 24000)');
    const scene = await mixed.say({ input: SCENE, speed: 1.5 });
    assert.equal(scene.applied, '1.200');
    const empty = await kept.say({ input: '[sound:card_deal]', speed: 1.5 });
    assert.equal(empty.calls.length, 0);
    assert.equal(empty.applied, '1');
    const inworld = await kept.say({ voice: 'Voice 1', speed: 1.5 });
    assert.equal(inworld.applied, null, 'Inworld renders its own rate and says nothing');
    assert.equal(inworld.asked.length, 0);
  } finally { await kept.stop(); await mixed.stop(); }
});

test('handler: an Inworld voice in a scene keeps its own rate and only the Fish part goes to the worker', async () => {
  const p = await bootProxy(31942, { ...ON, SCENE_CAST: 'ann=Voice 1;bob=fish:bob' });
  try {
    const r = await p.say({ voice: 'Voice 1', input: SCENE, speed: 1.5 });
    assert.equal(r.asked.length, 1);
    assert.equal(r.applied, '1.500');
    const inworld = r.calls.find((c) => c.url.includes('inworld'));
    assert.equal(inworld.body.audioConfig.speakingRate, 1.5);
  } finally { await p.stop(); }
});

test('/voices.json pacing is the plain range with the switch on and the old shape off', async () => {
  const run = async (PORT, extra) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-tts-'));
    const receipt = path.join(folder, 'requests.jsonl');
    fs.writeFileSync(receipt, '');
    const env = { ...process.env };
    for (const k of CLEAR) delete env[k];
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/selected-references.cjs'), 'server.js'], {
      cwd: __dirname, env: { ...env, PORT: String(PORT), SELECTED_VOICES_ENABLED: '1', FISH_API_KEY: 'offline', INWORLD_API_KEY: 'offline', FISH_TTS_MODEL: 'drama-3',
        AWS_ACCESS_KEY_ID: 'fake-access', AWS_SECRET_ACCESS_KEY: 'fake-secret', AWS_BUCKET_NAME: 'test-bucket', PROVIDER_RECEIPT: receipt, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (v) => { log += v; });
    child.stderr.on('data', (v) => { log += v; });
    try {
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        try { ready = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch {}
        if (!ready) await sleep(40);
      }
      assert.ok(ready, log);
      return (await (await fetch(`http://127.0.0.1:${PORT}/voices.json`)).json()).pacing;
    } finally {
      child.kill();
      if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
    }
  };
  assert.deepEqual(await run(31943, { FISH_SPEED_EXACT: '1' }), { min: 0.5, max: 1.5, default: 1 });
  const old = await run(31944, {});
  assert.deepEqual(old.inworld, { min: 0.5, max: 1.5, default: 1 });
  assert.deepEqual(old.fish, pace.FISH_PACES.map(({ value, name }) => ({ value, name })));
});

test('handler, real worker: every number comes out that much shorter, phone and web calls too', { skip: NEEDS_PYTHON }, async () => {
  const p = await bootProxy(31945, { FISH_SPEED_EXACT: '1', FISH_STRETCH_PYTHON: PYTHON, FISH_STRETCH_CALL_MS: '5000' }, { stub: false });
  try {
    for (let i = 0; i < 400 && !(await p.health()).ready; i++) await sleep(25);
    assert.equal((await p.health()).ready, true, p.log().slice(-2000));
    for (const speed of [0.75, 1.1, 1.3, 1.5]) {
      for (const [name, headers, query, tail] of [['chat', {}, '', talkTail(speed)], ['web call', BRIDGE_WEB, '', talkTail(speed)], ['phone', BRIDGE_PHONE, '?telephony=1', talkTail(speed)], ['reading', { 'x-kade-tts-session': 'reading:book-1' }, '', 0]]) {
        const r = await p.say({ speed }, headers, query);
        const wanted = 0.5 / speed + tail;
        assert.ok(Math.abs(r.seconds - wanted) < 0.03, `${name} ${speed}: ${r.seconds} s, wanted ${wanted}`);
        assert.ok(Math.abs(Number(r.applied) - speed) / speed < 0.03, `${name} ${speed}: header ${r.applied}`);
        assert.equal(r.calls[0].body.prosody.speed, 1);
      }
    }
    const h = await p.health();
    assert.equal(h.exact, true);
    assert.equal(h.stretched, 16);
    assert.equal(h.kept, 0);
    assert.ok(h.slowestClipMs > 0);
    assert.doesNotMatch(p.log(), /fish stretch:/, 'nothing went wrong');
  } finally { await p.stop(); }
});

test('handler, worker broken: audio still returns at the 1x Natural take, header 1, and the log has no words', async () => {
  const p = await bootProxy(31946, { FISH_SPEED_EXACT: '1', FISH_STRETCH_PYTHON: MISSING }, { stub: false });
  try {
    const t = Date.now();
    const chat = await p.say({ speed: 1.5 });
    assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
    assert.equal(chat.applied, '1');
    assert.equal(chat.calls[0].body.prosody.speed, 1);
    assert.ok(Math.abs(chat.seconds - (0.5 + talkTail(1.5))) < 0.012, `${chat.seconds} s`);
    const t2 = Date.now();
    const reading = await p.say({ speed: 1.5, delivery: 'STABLE' });
    assert.ok(Date.now() - t2 < 3000, `reading took ${Date.now() - t2} ms`);
    assert.equal(reading.applied, '1');
    const h = await p.health();
    assert.equal(h.stretched, 0);
    assert.match(p.log(), /\[TTS\] fish stretch: worker could not start \(ENOENT\) -- original audio kept/);
    assert.doesNotMatch(p.log().split('\n').filter((l) => l.includes('fish stretch:')).join('\n'), /quilt|sister/);
  } finally { await p.stop(); }
});
