'use strict';
/* Oct 17-18 2026: Fish Drama3 on a cloned reference ran on after a short line (4 of 16 takes of
 * "Audio description by Kade-AI.", 18-48 s instead of about 2.3 s). fish-runaway.js measures every
 * Fish chunk against the words it was asked to say; a take far past its words is asked for once
 * more, and a second run-on fails that chunk. The clip lengths below are the measured ones. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const runaway = require('./fish-runaway');
const { spokenText, pcmSeconds, measureFishChunk, checkTake, runawayLimitSeconds, runawayMode, LIMIT } = runaway;
const { fishPacedText, capFishPauses } = require('./pace');
const { shapeFishPauses } = require('./speech-prosody');

const RATE = 24000;
function pcmOf(parts) {
  const out = [];
  for (const [kind, ms] of parts) {
    const n = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < n; i++) out.push(kind === 'tone' ? Math.round(8000 * Math.sin(i / 3)) : (i % 2 ? 20 : -20));
  }
  return Buffer.from(new Int16Array(out).buffer);
}
const wavOf = (parts) => Buffer.concat([Buffer.alloc(44), pcmOf(parts)]);
const seconds = (s) => [['tone', s * 1000]];
function withMode(mode, fn) {
  const before = process.env.FISH_RUNAWAY_GUARD;
  if (mode === undefined) delete process.env.FISH_RUNAWAY_GUARD; else process.env.FISH_RUNAWAY_GUARD = mode;
  try { return fn(); } finally { if (before === undefined) delete process.env.FISH_RUNAWAY_GUARD; else process.env.FISH_RUNAWAY_GUARD = before; }
}
// The same, for an async fn: the mode must hold until the Fish take has been judged.
async function inMode(mode, fn) {
  const before = process.env.FISH_RUNAWAY_GUARD;
  if (mode === undefined) delete process.env.FISH_RUNAWAY_GUARD; else process.env.FISH_RUNAWAY_GUARD = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FISH_RUNAWAY_GUARD; else process.env.FISH_RUNAWAY_GUARD = before; }
}
const quiet = { log() {} };

// ── measuring ──────────────────────────────────────────────────────────────────────────────────
test('spoken text leaves out bracket directions, sounds and <tags>', () => {
  assert.equal(spokenText('[talking off the cuff] Ha, [small laugh] that is <emphasis>so</emphasis> funny. [short pause]'),
    'Ha, that is so funny.');
  assert.equal(spokenText('[breathe]'), '');
  assert.equal(spokenText(''), '');
});

test('seconds and voiced seconds come from the PCM after the 44-byte header', () => {
  const pcm = pcmOf([['gap', 200], ['tone', 1000], ['gap', 500], ['tone', 300]]);
  const { seconds: s, voiced } = pcmSeconds(pcm, RATE);
  assert.ok(Math.abs(s - 2) < 0.01, String(s));
  assert.ok(Math.abs(voiced - 1.3) < 0.03, String(voiced));
  assert.deepEqual(pcmSeconds(Buffer.alloc(0), RATE), { seconds: 0, voiced: 0 });
});

test('a chunk is measured on what Fish was asked to say, not on the briefs', () => {
  const sent = fishPacedText('Ha, that is hilarious. [small laugh] Okay. [short pause]', 0.75, { talk: true });
  const m = measureFishChunk(sent, wavOf(seconds(2.5)), RATE);
  assert.equal(m.chars, 'Ha, that is hilarious. Okay.'.length);
  assert.equal(m.words, 5);
  assert.equal(m.sentences, 2);
  assert.equal(m.sounds, 1);
  assert.equal(m.pauses, 1);
  assert.ok(Math.abs(m.seconds - 2.5) < 0.01);
});

test('every take is logged with its pace, voice and limit', () => {
  const lines = [];
  const m = checkTake('Sure!', wavOf(seconds(0.9)), { rate: 1.5, talk: { turn: 0 }, delivery: 'CREATIVE', voice: 'ref_0123456789abcdef', log: l => lines.push(l) });
  assert.equal(m.chars, 5);
  assert.equal(m.ranOn, false);
  assert.match(lines[0], /^\[TTS\] fish chunk length: chars=5 words=1 sentences=1 sounds=0 pauses=0 seconds=0\.90 voiced=0\.90 sPerChar=0\.1800 pace=Quick talk=yes delivery=CREATIVE voice=ref_0123456789abcdef limit=3\.80$/);
});

// ── the limit and the switch ───────────────────────────────────────────────────────────────────
test('the limit is 3 s plus 0.16 s a character plus 1.5 s a sound or pause, and the switch has three settings', () => {
  assert.deepEqual(LIMIT, { base: 3, perChar: 0.16, perTag: 1.5 });
  assert.equal(runawayLimitSeconds({ chars: 5, sounds: 0, pauses: 0 }), 3.8);
  assert.equal(runawayLimitSeconds({ chars: 100, sounds: 1, pauses: 2 }), 3 + 16 + 4.5);
  assert.equal(withMode(undefined, runawayMode), 'retry', 'on by default');
  assert.equal(withMode('log', runawayMode), 'log');
  assert.equal(withMode(' OFF ', runawayMode), 'off');
  assert.equal(withMode('retry', runawayMode), 'retry');
  assert.equal(withMode('nonsense', runawayMode), 'retry');
  const lines = [];
  assert.equal(withMode('off', () => checkTake('Sure!', wavOf(seconds(30)), { rate: 1, log: l => lines.push(l) })), null);
  assert.equal(lines.length, 0, 'off measures nothing');
  assert.deepEqual(withMode('log', () => runaway.runawayHealth()), { mode: 'log', limit: '3 s + 0.16 s per spoken character + 1.5 s per sound or pause tag' });
});

test('every run-on measured on Oct 17-18 is caught; the same line spoken normally is not', () => {
  // Kade's voice, the describer's credit, STABLE at Quick (as the fork sends it).
  const credit = 'Audio description by Kade-AI.';
  for (const s of [8.4, 13.44, 18.76, 25.46, 27.88, 46.85, 47.48]) {
    assert.equal(checkTake(credit, wavOf(seconds(s)), { rate: 1.5, delivery: 'STABLE', ...quiet }).ranOn, true, `${s} s`);
  }
  for (const s of [2.32, 2.41]) assert.equal(checkTake(credit, wavOf(seconds(s)), { rate: 1.5, delivery: 'STABLE', ...quiet }).ranOn, false);
  assert.equal(checkTake('A red balloon floats down.', wavOf(seconds(9.23)), { rate: 1.5, delivery: 'STABLE', ...quiet }).ranOn, true);
  assert.equal(checkTake('Napoleon scrambles up the stone wall and gazes at the city view below.', wavOf(seconds(25.69)), { rate: 1.5, delivery: 'STABLE', ...quiet }).ranOn, true);
});

// ── never flagged ──────────────────────────────────────────────────────────────────────────────
const P1 = 'Okay so I finally got the garden sorted out this morning. The tomatoes were a mess, honestly, half of them ' +
  'had split from all that rain last week. I picked what I could, and the rest I just left for the birds. ' +
  'Anyway, how did your thing go yesterday?';
const P2 = "I don't know... I keep thinking about what you said. Maybe you're right, maybe it's time to just call her " +
  "and see what happens. It's been almost two years now. That's a long time to be mad at somebody over a couch.";
const LONG = [
  P1, P2,
  "[fond] We keep meaning to fix the gate latch but it's been squeaking in that same key for years now. I'd recognize it coming home from anywhere. Maybe we fix it next spring.",
  `[warmly] ${P1} [pause] ${P2} [small laugh] Anyway. ${P1}`,
  Array.from({ length: 8 }, () => 'We walked down to the creek and sat on the big flat rock for a while, just listening.').join(' '),
];

test('normal long paragraphs at Unhurried with pauses are never flagged', () => {
  // Measured: P1 at Unhurried took 16.2, 17.8 and 19.5 s on three voices (the slowest voice last);
  // the slowest normal clip anywhere ran 0.128 s per character (the gate latch, 21.3 s), and a sound
  // or pause added at most about 1.3 s.
  const measured = [[P1, 16.2], [P1, 17.82], [P1, 19.53], [LONG[2], 21.31]];
  for (const [text, s] of measured) {
    const take = checkTake(shapeFishPauses(text), wavOf(seconds(s)), { rate: 0.75, talk: { turn: 0 }, ...quiet });
    assert.equal(take.ranOn, false, `${s} s for ${take.chars} characters`);
  }
  for (const text of LONG) {
    const shaped = shapeFishPauses(text);
    const sent = fishPacedText(shaped, 0.75, { talk: { turn: 0 } });
    const m = measureFishChunk(sent, Buffer.alloc(44), RATE);
    assert.ok(m.pauses >= 1, `the real pipeline gave this paragraph pauses: ${sent}`);
    // As slow as the slowest normal reading measured, for every character the listener's text has.
    const slowest = 0.128 * spokenText(text).length + 1.3 * (m.sounds + m.pauses);
    const take = checkTake(shaped, wavOf(seconds(slowest)), { rate: 0.75, talk: { turn: 0 }, ...quiet });
    assert.equal(take.ranOn, false, `${slowest.toFixed(1)} s for ${take.chars} characters, limit ${take.limit.toFixed(1)}`);
  }
});

test('short lines with [small laugh] or [breathe] are never flagged', () => {
  // Measured on two voices at Unhurried and Quick, little sounds on: 2.6-2.9 s at most.
  const lines = [['[small laugh] Yeah, I know.', 2.93], ['[breathe] Okay. Let\'s do it.', 2.96], ["Ha, that's hilarious.", 2.69],
    ['Ugh, what a long day.', 2.78], ['Okay, sounds good.', 1.79], ['Sure!', 1.02]];
  for (const rate of [0.75, 1, 1.5]) {
    for (const [line, s] of lines) {
      // Twice the longest measured take still passes.
      const take = checkTake(shapeFishPauses(line), wavOf(seconds(2 * s)), { rate, talk: { turn: 0 }, ...quiet });
      assert.equal(take.ranOn, false, `${line} at ${rate}: ${2 * s} s, limit ${take.limit}`);
    }
  }
  const laugh = checkTake('[small laugh]', wavOf(seconds(3)), { rate: 1, talk: { turn: 0 }, ...quiet });
  assert.equal(laugh.ranOn, false, 'a laugh on its own may take a few seconds');
});

// ── the real fishSynthesizeChunk ───────────────────────────────────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (from, to) => { const i = source.indexOf(from); return source.slice(i, source.indexOf(to, i)); };
function loadChunk(answers) {
  const calls = [];
  const noted = [];
  const warned = [];
  const logged = [];
  const context = {
    console: { warn: (l) => warned.push(l), log: (l) => logged.push(l) }, Buffer, Math, AbortController, setTimeout, clearTimeout, process,
    noteChunk: (k) => noted.push(k), sleep: async () => {}, fishLimiter: async (fn) => fn(),
    fishBody: require('./private-voice-references').fishBody, selectedReferenceStore: null,
    fishPacedText, fishApiSpeed: require('./pace').fishApiSpeed, capFishPauses,
    fishRunaway: { ...runaway, checkTake: (text, wav, opts) => runaway.checkTake(text, wav, { ...opts, log: (l) => logged.push(l) }) },
    FISH_API_KEY: 'fake-test-key', FISH_TIMEOUT_MS: 1000, FISH_SAMPLE_RATE: RATE, FISH_TTS_LATENCY: 'normal',
    FISH_TEMPERATURE: 0.9, FISH_TEMPERATURE_MAX: 1, FISH_TOP_P: 0.85, FISH_NORMALIZE: false, FISH_TEMPERATURE_BY_DELIVERY: {},
    fetch: async (url, request) => {
      const answer = answers[Math.min(calls.length, answers.length - 1)];
      calls.push(JSON.parse(request.body).text);
      if (answer === 503) return { ok: false, status: 503, text: async () => 'busy' };
      const pcm = pcmOf(seconds(answer));
      return { ok: true, arrayBuffer: async () => pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length) };
    },
  };
  vm.runInNewContext(cut('const FISH_TTS_MODEL =', 'const FISH_TTS_LATENCY =') + '\n' +
    cut('function buildWavHeader(', '// Aug 6 2026') + '\n' +
    cut('async function fishSynthesizeChunkOnce(', 'app.get("/health"') + '\nthis.synthesize = fishSynthesizeChunk;', context);
  return { synthesize: context.synthesize, calls, noted, warned, logged };
}
const secondsOfWav = (wav) => (wav.length - 44) / 2 / RATE;

test('a long tone is asked for once more, then the chunk fails clearly', async () => {
  const run = loadChunk([30]);
  await assert.rejects(inMode(undefined, () => run.synthesize('Sure!', 'legacy-id', 1, undefined, { turn: 0 })),
    (e) => e.isRunaway === true && /^Fish ran on twice for this chunk \(30\.0 s, then 30\.0 s, for 5 spoken characters; the limit is 3\.8 s\)/.test(e.message));
  assert.equal(run.calls.length, 2, 'one fresh request, no more');
  assert.equal(run.calls[0], run.calls[1], 'the same words both times');
  assert.deepEqual(run.noted, ['ranOn', 'ranOn', 'failed']);
  assert.match(run.warned[0], /fish chunk ran on \(30\.0 s for 5 spoken characters, limit 3\.8 s\) -- asking once more/);
  assert.equal(run.logged.filter(l => l.includes('ranOn=yes')).length, 2);
});

test('when the fresh take speaks normally the chunk is kept, so the reply is not lost', async () => {
  const run = loadChunk([30, 1.2]);
  const wav = await inMode('retry', () => run.synthesize('Sure!', 'legacy-id', 1, undefined, { turn: 0 }));
  assert.ok(Math.abs(secondsOfWav(wav) - 1.2) < 0.01, 'the fresh take is the one returned');
  assert.equal(run.calls.length, 2);
  assert.deepEqual(run.noted, ['ranOn', 'ok', 'ranOnFixed']);
  assert.match(run.logged.at(-1), /spoken again after a run-on: 1\.2 s/);
});

test('the fresh take does not use up the retries meant for provider errors', async () => {
  const run = loadChunk([30, 503, 503, 503, 1.1]);
  const wav = await inMode(undefined, () => run.synthesize('Sure!', 'legacy-id', 1, undefined, { turn: 0 }));
  assert.ok(Math.abs(secondsOfWav(wav) - 1.1) < 0.01);
  assert.equal(run.calls.length, 5, 'one run-on, three busy answers, then the take');
  assert.deepEqual(run.noted, ['ranOn', 'ok', 'retried', 'ranOnFixed']);
});

test('FISH_RUNAWAY_GUARD=log keeps the long take and says so; off neither measures nor retries', async () => {
  const logged = loadChunk([30]);
  const wav = await inMode('log', () => logged.synthesize('Sure!', 'legacy-id', 1));
  assert.ok(Math.abs(secondsOfWav(wav) - 30) < 0.01);
  assert.equal(logged.calls.length, 1);
  assert.deepEqual(logged.noted, ['ranOn', 'ok']);
  assert.match(logged.warned[0], /ran on .* kept, FISH_RUNAWAY_GUARD=log/);
  const off = loadChunk([30]);
  await inMode('off', () => off.synthesize('Sure!', 'legacy-id', 1));
  assert.equal(off.calls.length, 1);
  assert.deepEqual(off.noted, ['ok']);
  assert.equal(off.logged.length, 0);
});

test('a normal reply is measured once and never asked for again', async () => {
  const run = loadChunk([17.82]);
  await inMode(undefined, () => run.synthesize(shapeFishPauses(P1), 'legacy-id', 0.75, undefined, { turn: 0 }));
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.noted, ['ok']);
  assert.match(run.logged[0], /chars=\d+ .* pace=Unhurried talk=yes delivery=DEFAULT voice=legacy-id limit=\d+\.\d\d$/);
});

// ── through the real HTTP handler ──────────────────────────────────────────────────────────────
test('on the real server a run-on line fails clearly, and a paragraph fixed by one fresh take keeps the reply', async () => {
  const PORT = '31893';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-runaway-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT, INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt,
    RUNAWAY_ALWAYS: 'Sure', RUNAWAY_ONCE: 'ladder' };
  for (const k of ['FISH_RUNAWAY_GUARD', 'FISH_DIRECTOR', 'SELECTED_VOICES_ENABLED', 'KADE_SPEECH_SECRET']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/runaway-provider.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', x => { log += x; });
  child.stderr.on('data', x => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const say = (input) => fetch(`http://127.0.0.1:${PORT}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, voice: 'fish:fixture' }) });
  try {
    let health = null;
    for (let i = 0; i < 100 && !health; i++) {
      try { health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(); } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(health, log);
    assert.equal(health.fishRunaway.mode, 'retry');

    const failed = await say('Sure!');
    assert.equal(failed.status, 500, log.slice(-2000));
    assert.match((await failed.json()).details, /^Fish ran on twice for this chunk \(40\.0 s, then 40\.0 s, for 5 spoken characters/);
    assert.equal(rows().length, 2, 'asked once more, then given up');

    const before = rows().length;
    const kept = await say('I have some news about the ladder.\n\nIt is fine, mostly. We can talk about it later.');
    assert.equal(kept.status, 200, log.slice(-2000));
    const wav = Buffer.from(await kept.arrayBuffer());
    const calls = rows().slice(before);
    assert.equal(calls.length, 3, 'two paragraphs, one of them asked for twice');
    assert.equal(calls.filter(c => c.text.includes('ladder')).length, 2);
    assert.ok(wav.length < 44 + 2 * RATE * 5, `the reply is two short paragraphs, not the 40 s take (${wav.length} bytes)`);
    assert.match(log, /fish chunk spoken again after a run-on: 1\.0 s/);

    health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    assert.equal(health.chunksToday.ranOn, 3);
    assert.equal(health.chunksToday.ranOnFixed, 1);
    assert.match(health.chunksToday.spoken, /3 Fish takes ran on past their words \(1 fixed by a fresh take\)/);
  } finally {
    child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
});
