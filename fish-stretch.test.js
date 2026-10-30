'use strict';
// Oct 30 2026: Praat's overlap-add at Brisk and Quick (fish-stretch.js, fish_stretch_worker.py). Kade:
// "Grat actually sounded really naturally." Run with FISH_STRETCH_PYTHON naming an interpreter that
// has praat-parselmouth; without it the tests that need the real worker skip and say so.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const pace = require('./pace');
const runaway = require('./fish-runaway');
const { createFishStretch } = require('./fish-stretch');

const { fishApiSpeed, fishStretchOn, fishStretchRatio, FISH_PACES, capFishPauses } = pace;
const RATE = 24000;
const ON = { FISH_PACE_STRETCH: '1' };
const PYTHON = process.env.FISH_STRETCH_PYTHON;
const NEEDS_PYTHON = PYTHON ? false : 'FISH_STRETCH_PYTHON is not set, so this real-worker test is skipped';
const MISSING = path.join(os.tmpdir(), 'no-such-folder', 'no-such-python');

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
function peakOf(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  return peak;
}
// The longest quiet run strictly inside the clip, in milliseconds.
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

// ── the switch and its reach ───────────────────────────────────────────────────────────────────
test('off unless FISH_PACE_STRETCH is exactly 1', () => {
  for (const source of [{}, { FISH_PACE_STRETCH: '0' }, { FISH_PACE_STRETCH: 'true' }, { FISH_PACE_STRETCH: ' 1' }]) {
    assert.equal(fishStretchOn(source), false);
    for (const rate of [1.2, 1.5]) assert.equal(fishStretchRatio(rate, { talk: true, source }), 1);
  }
  assert.equal(fishStretchOn(ON), true);
});

test('only Brisk and Quick chat move, by the amounts she has heard', () => {
  assert.equal(fishStretchRatio(1.2, { talk: true, source: ON }), 1.05);
  assert.equal(fishStretchRatio(1.5, { talk: true, source: ON }), 1.1);
  for (const rate of [undefined, 0.75, 0.9, 1]) assert.equal(fishStretchRatio(rate, { talk: true, source: ON }), 1, String(rate));
  assert.deepEqual(FISH_PACES.map((p) => p.stretch || 1), [1, 1, 1, 1.05, 1.1]);
  assert.equal(fishStretchRatio(1.5, { talk: false, source: ON }), 1);
  assert.equal(fishStretchRatio(1.5, { source: ON }), 1);
});

test('never both stretches: FISH_PACE_STRETCH keeps prosody.speed at 1, FISH_PACE_SPEED alone still works', () => {
  const both = { FISH_PACE_STRETCH: '1', FISH_PACE_SPEED: '1' };
  for (const rate of [1, 1.2, 1.5]) assert.equal(fishApiSpeed(rate, { talk: true, source: both }), 1);
  assert.equal(fishApiSpeed(1.5, { talk: true, source: { FISH_PACE_SPEED: '1', FISH_PACE_STRETCH: '0' } }), 1.1);
});

test('a live call is out of the worker\'s reach and keeps Fish\'s own speed, still never both', () => {
  const both = { FISH_PACE_STRETCH: '1', FISH_PACE_SPEED: '1' };
  for (const rate of [1.2, 1.5]) assert.equal(fishStretchRatio(rate, { talk: true, liveCall: true, source: ON }), 1);
  assert.equal(fishApiSpeed(1.2, { talk: true, liveCall: true, source: both }), 1.05);
  assert.equal(fishApiSpeed(1.5, { talk: true, liveCall: true, source: both }), 1.1);
  assert.equal(fishApiSpeed(1.5, { talk: true, liveCall: true, source: ON }), 1, 'FISH_PACE_SPEED off stays off');
  assert.equal(fishApiSpeed(1.5, { liveCall: true, source: both }), 1, 'not chat');
});

// ── the module with no Python behind it ────────────────────────────────────────────────────────
test('what is not worth stretching never starts a worker and comes back as the same buffer', async () => {
  const logged = [];
  const s = createFishStretch({ python: MISSING, log: (l) => logged.push(l) });
  const long = Buffer.alloc(2 * RATE * 91);
  const short = voiced(0.1);
  const odd = Buffer.alloc(2 * RATE + 1);
  for (const [pcm, ratio] of [[voiced(1), 1], [short, 1.1], [long, 1.1], [odd, 1.1], [voiced(1), 0], [voiced(1), NaN], [Buffer.alloc(0), 1.1]]) {
    assert.equal(await s.stretch(pcm, ratio, RATE), pcm);
  }
  assert.equal(s.pid(), null);
  assert.deepEqual(logged, []);
  s.stop();
});

test('a broken interpreter path gives the original back fast, and says so once with no words', async () => {
  const logged = [];
  const s = createFishStretch({ python: MISSING, log: (l) => logged.push(l) });
  const pcm = voiced(6);
  const t = Date.now();
  assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
  const t2 = Date.now();
  assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
  assert.ok(Date.now() - t2 < 20, 'the backoff is running: nobody waits on it');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^\[TTS\] fish stretch: worker could not start \(ENOENT\) -- original audio kept$/);
  assert.equal(s.health().ready, false);
  assert.equal(s.health().kept, 2);
  s.stop();
});

// ── the real worker ────────────────────────────────────────────────────────────────────────────
test('length within 3 percent and pitch preserved at the amounts she heard and well past them', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000 });
  try {
    const pcm = voiced(6);
    const before = crossingsPerSecond(pcm);
    for (const ratio of [1.05, 1.1, 1.5]) {
      const out = await s.stretch(pcm, ratio, RATE);
      assert.notEqual(out, pcm, `${ratio}: the worker answered`);
      const wanted = secondsOf(pcm) / ratio;
      assert.ok(Math.abs(secondsOf(out) - wanted) / wanted < 0.03, `${ratio}: ${secondsOf(out)} s, wanted ${wanted}`);
      const after = crossingsPerSecond(out);
      assert.ok(Math.abs(after - before) / before < 0.04, `${ratio}: ${after} crossings per second, was ${before}`);
    }
    assert.equal(s.health().stretched, 3);
    assert.equal(s.health().ready, true);
  } finally { s.stop(); }
});

test('short and silent clips do not break it; the worker stays up', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000 });
  try {
    const warm = voiced(1);
    assert.notEqual(await s.stretch(warm, 1.1, RATE), warm);
    const pid = s.pid();
    for (const pcm of [Buffer.alloc(2 * Math.round(RATE * 0.2)), Buffer.alloc(2 * RATE * 2), voiced(0.2), voiced(0.21, { f0: 500 })]) {
      const out = await s.stretch(pcm, 1.1, RATE);
      assert.ok(out === pcm || Math.abs(out.length - pcm.length / 1.1) < pcm.length * 0.1);
    }
    assert.equal(s.pid(), pid);
    const after = voiced(1);
    assert.notEqual(await s.stretch(after, 1.1, RATE), after, 'still stretching');
    assert.equal(s.pid(), pid);
  } finally { s.stop(); }
});

test('a clip at full scale comes out inside int16 and never wraps around', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000 });
  try {
    const n = RATE * 2;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.sin((2 * Math.PI * 200 * i) / RATE) >= 0 ? 32767 : -32768, i * 2);
    const out = await s.stretch(pcm, 1.1, RATE);
    assert.notEqual(out, pcm);
    assert.ok(peakOf(out) <= Math.ceil(32768 * 0.99), `peak ${peakOf(out)}`);
  } finally { s.stop(); }
});

test('clips asked for together all come back, each its own length', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000 });
  try {
    const clips = [1, 2, 3, 4, 5, 6].map((seconds) => voiced(seconds));
    const out = await Promise.all(clips.map((pcm) => s.stretch(pcm, 1.1, RATE)));
    out.forEach((o, i) => {
      assert.notEqual(o, clips[i]);
      assert.ok(Math.abs(secondsOf(o) - (i + 1) / 1.1) < 0.1, `clip ${i}: ${secondsOf(o)} s`);
    });
  } finally { s.stop(); }
});

test('a worker killed mid-clip gives that clip back and recovers', { skip: NEEDS_PYTHON }, async () => {
  const logged = [];
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000, backoffMs: 100, log: (l) => logged.push(l) });
  try {
    const warm = voiced(1);
    assert.notEqual(await s.stretch(warm, 1.1, RATE), warm);
    const pid = s.pid();
    const long = voiced(85);
    const asked = s.stretch(long, 1.1, RATE);
    await sleep(40);
    process.kill(pid);
    assert.equal(await asked, long);
    assert.ok(logged.some((l) => /worker stopped/.test(l)), logged.join('\n'));
    assert.ok(await until(() => s.health().ready && s.pid() !== pid), 'a new worker came up');
    const pcm = voiced(2);
    const out = await s.stretch(pcm, 1.1, RATE);
    assert.notEqual(out, pcm, 'stretching again');
    assert.equal(s.health().restarts, 1);
  } finally { s.stop(); }
});

// Workers that misbehave on purpose. Python's standard library only.
const FAKE_HEAD = 'import struct,sys,time\nR=struct.Struct("<IdII");S=struct.Struct("<III");i=sys.stdin.buffer;o=sys.stdout.buffer\n' +
  'def send(a,b,c=b""):\n  o.write(S.pack(a,b,len(c)));o.write(c);o.flush()\n';
const FAKE_LOOP = 'while True:\n  h=i.read(R.size)\n  if len(h)<R.size: sys.exit(0)\n  n,ratio,sr,c=R.unpack(h)\n  pcm=i.read(c)\n';
function fakeWorker(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-stretch-fake-'));
  const file = path.join(dir, 'worker.py');
  fs.writeFileSync(file, FAKE_HEAD + body);
  return file;
}
const fakeRun = (body, options, fn) => async () => {
  const logged = [];
  const s = createFishStretch({ python: PYTHON, script: fakeWorker(body), timeoutMs: 300, startWaitMs: 5000, backoffMs: 50, log: (l) => logged.push(l), ...options });
  try { await fn(s, logged); } finally { s.stop(); }
};

test('a worker returning the wrong length is not believed, and stays up', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}  send(n,0,pcm[:len(pcm)//4*2])\n`, {}, async (s, logged) => {
    const pcm = voiced(2);
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.match(logged[0], /wrong length/);
    const pid = s.pid();
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.equal(s.pid(), pid);
  }));

test('an error status gives the original back without replacing the worker', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}  send(n,2)\n`, {}, async (s, logged) => {
    const pcm = voiced(2);
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.match(logged[0], /could not stretch a clip \(status 2\)/);
    const pid = s.pid();
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.equal(s.pid(), pid);
  }));

test('a worker stuck on a clip costs that clip the time limit and is replaced', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}  time.sleep(60)\n`, {}, async (s, logged) => {
    const pcm = voiced(2);
    const first = s.stretch(pcm, 1.1, RATE);
    await until(() => s.health().ready);
    const pid = s.pid();
    const t = Date.now();
    assert.equal(await first, pcm);
    assert.ok(Date.now() - t < 700, `waited ${Date.now() - t} ms`);
    assert.ok(await until(() => s.pid() && s.pid() !== pid), 'replaced');
    assert.ok(logged.some((l) => /too slow|too long/.test(l)));
  }));

test('a worker that answers out of turn is replaced', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}  send(n+7,0,pcm)\n`, {}, async (s, logged) => {
    const pcm = voiced(2);
    const first = s.stretch(pcm, 1.1, RATE);
    assert.equal(await first, pcm);
    assert.ok(logged.some((l) => /out of turn/.test(l)), logged.join('\n'));
  }));

test('a worker that never comes up delays one clip by the start wait, not every clip', { skip: NEEDS_PYTHON },
  fakeRun('time.sleep(60)\n', { startWaitMs: 150, startLimitMs: 400 }, async (s, logged) => {
    const pcm = voiced(2);
    const t = Date.now();
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.ok(Date.now() - t < 450);
    const t2 = Date.now();
    assert.equal(await s.stretch(pcm, 1.1, RATE), pcm);
    assert.ok(Date.now() - t2 < 20, 'the second clip does not wait');
    assert.ok(await until(() => logged.some((l) => /too long to start/.test(l))), logged.join('\n'));
  }));

// How long each worker in a row is gone for: from the old one going down to the new one being ready.
async function restartGaps(s, rounds, { clips = 1, spacedMs = 0 } = {}) {
  const pcm = voiced(1);
  const gaps = [];
  s.warm();
  for (let i = 0; i < rounds; i++) {
    assert.ok(await until(() => s.health().ready), 'a worker came up');
    const pid = s.pid();
    await sleep(spacedMs);
    for (let c = 0; c < clips; c++) assert.notEqual(await s.stretch(pcm, 1.1, RATE), pcm, 'a good clip');
    await s.stretch(pcm, 1.1, RATE); // the one it hangs on, or finds it gone
    assert.ok(await until(() => s.pid() !== pid), 'the worker went down');
    const down = Date.now();
    assert.ok(await until(() => s.pid() && s.health().ready), 'a new worker came up');
    gaps.push(Date.now() - down);
  }
  return gaps;
}
// Each wait doubles: 40, 80, 160, 320, 640 ms. Timers never fire early, the 15 ms poll can make a gap look short.
function assertClimbing(gaps) {
  gaps.forEach((gap, i) => assert.ok(gap >= 40 * 2 ** i - 20, `wait ${i} should be at least ${40 * 2 ** i} ms: ${gaps.join(', ')}`));
}
const GOOD_CLIP = '  send(n,0,pcm[:int(len(pcm)/ratio)//2*2])\n';
const BACKOFF = { timeoutMs: 100, backoffMs: 40 };

// Reviewers, on the first version: one good clip reset the wait, so a worker in a bad state cost a
// 2 s stall again and again, or paid Python's imports every 1.4 s, and the climb never started.
test('a worker that answers one clip and then hangs is replaced further and further apart', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}${GOOD_CLIP}  time.sleep(60)\n`, BACKOFF, async (s) => {
    assertClimbing(await restartGaps(s, 5));
  }));

test('a worker that answers one clip and then dies is replaced further and further apart', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}${GOOD_CLIP}  sys.exit(1)\n`, BACKOFF, async (s) => {
    assertClimbing(await restartGaps(s, 5));
  }));

test('time up alone is not health, on a quiet server one clip can come a minute after the start', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\n${FAKE_LOOP}${GOOD_CLIP}  sys.exit(1)\n`, { ...BACKOFF, healthyMs: 1 }, async (s) => {
    assertClimbing(await restartGaps(s, 5, { spacedMs: 5 }));
  }));

test('good clips alone are not health, a worker that dies every few clips still climbs', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\nk=0\n${FAKE_LOOP}  k+=1\n${GOOD_CLIP}  if k==2: sys.exit(1)\n`, { ...BACKOFF, healthyClips: 1 }, async (s) => {
    assertClimbing(await restartGaps(s, 5, { clips: 2 }));
  }));

test('a worker that has answered its clips and stayed up starts the wait over', { skip: NEEDS_PYTHON },
  fakeRun(`send(0,0)\nk=0\n${FAKE_LOOP}  k+=1\n${GOOD_CLIP}  if k==3: sys.exit(1)\n`, { timeoutMs: 100, backoffMs: 400, healthyClips: 3, healthyMs: 60 }, async (s) => {
    const gaps = await restartGaps(s, 3, { clips: 3, spacedMs: 80 });
    // Climbing, the third wait would be 1600 ms.
    assert.ok(gaps[2] >= 380 && gaps[2] < 1200, `${gaps.join(', ')}`);
  }));

// ── where it sits: the real fishSynthesizeChunk ────────────────────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (from, to) => { const i = source.indexOf(from); return source.slice(i, source.indexOf(to, i)); };
function loadChunk({ takes, stretch, env = ON }) {
  const state = { calls: 0, logged: [], warned: [], noted: [], asked: [], inSlot: false, askedInSlot: false };
  const context = {
    console: { warn: (l) => state.warned.push(l), log: (l) => state.logged.push(l) }, Buffer, Math, AbortController, setTimeout, clearTimeout, process,
    noteChunk: (k) => state.noted.push(k), sleep: async () => {},
    fishLimiter: async (fn) => { state.inSlot = true; try { return await fn(); } finally { state.inSlot = false; } },
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: null,
    fishPacedText: pace.fishPacedText, fishApiSpeed: pace.fishApiSpeed, capFishPauses,
    fishStretchRatio: (rate, opts) => pace.fishStretchRatio(rate, { ...opts, source: env }),
    fishStretch: { stretch: (pcm, ratio, rate) => { state.asked.push({ bytes: pcm.length, ratio, rate }); state.askedInSlot = state.inSlot; return stretch(pcm, ratio, rate); } },
    fishRunaway: { ...runaway, checkTake: (text, wav, opts) => runaway.checkTake(text, wav, { ...opts, log: (l) => state.logged.push(l) }) },
    FISH_API_KEY: 'fake-test-key', FISH_TIMEOUT_MS: 1000, FISH_SAMPLE_RATE: RATE, FISH_TTS_LATENCY: 'normal',
    FISH_TEMPERATURE: 0.9, FISH_TEMPERATURE_MAX: 1, FISH_TOP_P: 0.85, FISH_NORMALIZE: false, FISH_TEMPERATURE_BY_DELIVERY: {},
    fetch: async () => {
      const pcm = takes[Math.min(state.calls++, takes.length - 1)];
      return { ok: true, arrayBuffer: async () => pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length) };
    },
  };
  vm.runInNewContext(cut('const FISH_TTS_MODEL =', 'const FISH_TTS_LATENCY =') + '\n' +
    cut('function buildWavHeader(', '// Aug 6 2026') + '\n' +
    cut('async function fishSynthesizeChunkOnce(', 'app.get("/health"') + '\nthis.synthesize = fishSynthesizeChunk;', context);
  return { synthesize: context.synthesize, state };
}
const halve = async (pcm) => Buffer.from(pcm.subarray(0, Math.floor(pcm.length / 4) * 2));
const copy = async (pcm) => Buffer.from(pcm);
const TALK = { turn: 0 };
// A second and a half of quiet between two seconds of speech: well past every pace's cap.
const withGap = () => Buffer.concat([voiced(1), Buffer.alloc(2 * Math.round(RATE * 1.5)), voiced(1)]);

test('the run-on guard judges the unstretched take: one Praat would have hidden is still caught', async () => {
  const run = loadChunk({ takes: [voiced(4)], stretch: halve });
  await assert.rejects(run.synthesize('Sure!', 'legacy-id', 1.5, undefined, TALK), (e) => e.isRunaway === true);
  assert.equal(run.state.calls, 2, 'one fresh request, as always');
  assert.equal(run.state.asked.length, 0, 'a clip that failed is never stretched');
});

test('the guard logs the unstretched length, the clip that passes is stretched once, outside the slot', async () => {
  const run = loadChunk({ takes: [voiced(3.5)], stretch: halve });
  const wav = await run.synthesize('Sure!', 'legacy-id', 1.2, undefined, TALK);
  assert.match(run.state.logged[0], /seconds=3\.50 /);
  assert.deepEqual(run.state.asked, [{ bytes: voiced(3.5).length, ratio: 1.05, rate: RATE }]);
  assert.equal(run.state.askedInSlot, false, 'the Fish slot was given back first');
  assert.ok(Math.abs((wav.length - 44) / 2 / RATE - 1.75) < 0.01);
  assert.equal(wav.readUInt32LE(40), wav.length - 44, 'the WAV header says the new length');
});

test('after a run-on, Praat gets the fresh take and not the first', async () => {
  const run = loadChunk({ takes: [voiced(5), voiced(2)], stretch: copy });
  await run.synthesize('Sure!', 'legacy-id', 1.5, undefined, TALK);
  assert.equal(run.state.calls, 2);
  assert.equal(run.state.asked[0].bytes, voiced(2).length);
});

test('Praat works from the take before the pause cap, and the cap still means what it says afterward', async () => {
  const take = withGap();
  for (const [rate, cap] of [[1.2, 450], [1.5, 350]]) {
    const run = loadChunk({ takes: [take], stretch: copy });
    const wav = await run.synthesize('I have some news about the ladder and the gutters.', 'legacy-id', rate, undefined, TALK);
    assert.equal(run.state.asked[0].bytes, take.length, 'the uncapped take');
    const ms = longestInnerSilenceMs(wav.subarray(44));
    assert.ok(Math.abs(ms - cap) <= 20, `${rate}: ${ms} ms of quiet, cap ${cap}`);
  }
});

test('when the worker gives the clip back, the clip is exactly today\'s', async () => {
  const take = withGap();
  const said = 'I have some news about the ladder and the gutters.';
  const off = loadChunk({ takes: [take], stretch: copy, env: {} });
  const kept = loadChunk({ takes: [take], stretch: async (pcm) => pcm });
  const a = await off.synthesize(said, 'legacy-id', 1.5, undefined, TALK);
  const b = await kept.synthesize(said, 'legacy-id', 1.5, undefined, TALK);
  assert.equal(off.state.asked.length, 0);
  assert.equal(kept.state.asked.length, 1);
  assert.equal(Buffer.compare(a, b), 0);
});

test('even a stretch that breaks its promise cannot lose the reply', async () => {
  const run = loadChunk({ takes: [voiced(2)], stretch: async () => { throw new Error('should not happen'); } });
  const wav = await run.synthesize('Sure, that works for me.', 'legacy-id', 1.5, undefined, TALK);
  assert.ok(Math.abs((wav.length - 44) / 2 / RATE - 2) < 0.01);
  assert.match(run.state.warned[0], /^\[TTS\] fish stretch: Error -- original audio kept$/);
});

test('Natural, the slower paces, anything not chat and a live call never reach the worker', async () => {
  for (const [rate, talk, options] of [[1, TALK], [0.9, TALK], [0.75, TALK], [undefined, TALK], [1.5, false], [1.2, false], [1.5, TALK, { liveCall: true }]]) {
    const run = loadChunk({ takes: [voiced(2)], stretch: copy });
    await run.synthesize('Sure, that works for me.', 'legacy-id', rate, undefined, talk, options);
    assert.equal(run.state.asked.length, 0, `${rate} ${Boolean(talk)}`);
  }
});

test('with the real worker, a capped silence is the cap and not the cap sped up', { skip: NEEDS_PYTHON }, async () => {
  const s = createFishStretch({ python: PYTHON, timeoutMs: 8000, startWaitMs: 8000 });
  try {
    const run = loadChunk({ takes: [withGap()], stretch: (pcm, ratio, rate) => s.stretch(pcm, ratio, rate) });
    const wav = await run.synthesize('I have some news about the ladder and the gutters.', 'legacy-id', 1.5, undefined, TALK);
    assert.equal(s.health().stretched, 1);
    const ms = longestInnerSilenceMs(wav.subarray(44));
    assert.ok(ms > 330 && ms <= 375, `${ms} ms of quiet, cap 350 (the cap sped up would be 318)`);
  } finally { s.stop(); }
});

// ── through the real HTTP handler ──────────────────────────────────────────────────────────────
async function bootProxy(PORT, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-stretch-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt, FISH_PACE_STRETCH: '1', FISH_PACE_SPEED: '1', ...extra };
  for (const k of ['FISH_DIRECTOR', 'INWORLD_WRITER', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'FISH_RUNAWAY_GUARD', 'KADE_SPEECH_SECRET']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const url = `http://127.0.0.1:${PORT}`;
  const health = async () => (await (await fetch(`${url}/health`)).json()).fishStretch;
  const INPUT = 'I finally finished the quilt for my sister last night and it came out better than I hoped.';
  async function say(extraBody, headers = {}, query = '') {
    const before = rows().length;
    const r = await fetch(`${url}/v1/audio/speech${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ voice: 'fish:fixture', input: INPUT, ...extraBody }),
    });
    assert.equal(r.status, 200, log.slice(-2000));
    const wav = Buffer.from(await r.arrayBuffer());
    return { seconds: (wav.length - 44) / 2 / RATE, calls: rows().slice(before) };
  }
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    try { ready = (await fetch(`${url}/`)).status < 500; } catch {}
    if (!ready) await sleep(50);
  }
  assert.ok(ready, log);
  return { say, health, log: () => log, INPUT, stop: async () => { child.kill(); if (child.exitCode === null) await new Promise((r) => child.once('exit', r)); } };
}
// The fixture's clip is a half-second tone; a chat clip then gets its pace's thought gap at the end.
const TAIL = { 1.2: 0.32, 1.5: 0.27 };

test('real handler: Brisk and Quick chat stretch with prosody.speed 1; Natural, STABLE, reading and scenes never ask', { skip: NEEDS_PYTHON }, async () => {
  const p = await bootProxy('31895', { FISH_STRETCH_PYTHON: PYTHON });
  try {
    for (let i = 0; i < 200 && !(await p.health()).ready; i++) await sleep(25);
    assert.equal((await p.health()).ready, true, p.log().slice(-2000));
    for (const [rate, ratio] of [[1.2, 1.05], [1.5, 1.1]]) {
      const { seconds, calls } = await p.say({ speed: rate });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.prosody.speed, 1, 'never both stretches');
      const wanted = 0.5 / ratio + TAIL[rate];
      assert.ok(Math.abs(seconds - wanted) < 0.012, `${rate}: ${seconds} s, wanted ${wanted}`);
    }
    let h = await p.health();
    assert.equal(h.on, true);
    assert.equal(h.asked, 2);
    assert.equal(h.stretched, 2);
    await p.say({});
    await p.say({ speed: 1 });
    await p.say({ speed: 0.9 });
    await p.say({ speed: 1.5, delivery: 'STABLE' });
    await p.say({ speed: 1.5 }, { 'x-kade-tts-session': 'reading:book-1' });
    const scene = await p.say({ voice: 'alloy', speed: 1.5, input: '[[Voice 327]] We won the whole thing! [[Voice 1]] I knew we could do it.' });
    assert.equal(scene.calls.length, 2, 'a scene');
    h = await p.health();
    assert.equal(h.asked, 2, 'none of those reached the worker');
    assert.doesNotMatch(p.log(), /fish stretch:/, 'nothing went wrong');
  } finally { await p.stop(); }
});

test('real handler: with the worker broken, audio still returns, unstretched, soon, and the log has no words', async () => {
  const p = await bootProxy('31896', { FISH_STRETCH_PYTHON: MISSING });
  try {
    const t = Date.now();
    const { seconds, calls } = await p.say({ speed: 1.5 });
    assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
    assert.equal(calls[0].body.prosody.speed, 1, 'Fish\'s own speed is not a second way in');
    assert.ok(Math.abs(seconds - (0.5 + TAIL[1.5])) < 0.012, `${seconds} s`);
    const h = await p.health();
    assert.equal(h.on, true);
    assert.equal(h.ready, false);
    assert.equal(h.stretched, 0);
    assert.equal(h.asked, 1);
    assert.match(p.log(), /\[TTS\] fish stretch: worker could not start \(ENOENT\) -- original audio kept/);
    const lines = p.log().split('\n').filter((l) => l.includes('fish stretch:'));
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /quilt|sister/);
  } finally { await p.stop(); }
});

// The bridge sends a call's rate as speed: a saved rate, the agent's own, or "talk faster". Phone
// calls carry telephony=1; web calls do not, only the caller name bridge-voice.
test('real handler: live calls never ask the worker and keep the speed they have today', async () => {
  const p = await bootProxy('31898', { FISH_STRETCH_PYTHON: MISSING });
  try {
    const asked = async () => (await p.health()).asked;
    const speedOf = ({ calls }) => { assert.equal(calls.length, 1); return calls[0].body.prosody.speed; };
    assert.equal(speedOf(await p.say({ speed: 1.5 })), 1, 'chat is the worker\'s');
    assert.equal(await asked(), 1, 'chat asks');
    for (const [rate, speed, headers, query] of [
      [1.5, 1.1, { 'x-kade-caller': 'bridge-phone' }, '?telephony=1'],
      [1.25, 1.05, { 'x-kade-caller': 'bridge-phone' }, '?telephony=1'],
      [1.5, 1.1, {}, '?telephony=1'],
      [1.5, 1.1, { 'x-kade-caller': 'bridge-voice' }, ''],
    ]) {
      assert.equal(speedOf(await p.say({ speed: rate }, headers, query)), speed, `${rate} ${query} ${JSON.stringify(headers)}`);
      assert.equal(await asked(), 1, `${rate} ${query} ${JSON.stringify(headers)}: no worker`);
    }
    assert.equal(speedOf(await p.say({ speed: 1.5 }, { 'x-kade-caller': 'fork-tts' })), 1, 'the platform\'s voice messages are chat');
    assert.equal(await asked(), 2);
  } finally { await p.stop(); }
});

test('real handler: with the switch off the worker is never started or asked', async () => {
  const p = await bootProxy('31897', { FISH_PACE_STRETCH: '0', FISH_STRETCH_PYTHON: MISSING });
  try {
    const { calls } = await p.say({ speed: 1.5 });
    assert.equal(calls[0].body.prosody.speed, 1.1, 'the older rollback, FISH_PACE_SPEED, still answers');
    const h = await p.health();
    assert.equal(h.on, false);
    assert.equal(h.asked, 0);
    assert.doesNotMatch(p.log(), /fish stretch:/);
  } finally { await p.stop(); }
});
