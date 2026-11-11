'use strict';
// Nov 11 2026: the face track (timing-track.js). Pure: the cut map, trims, seams, the phone fallback,
// merging, the size cap, and the WAV carrier round-tripping through the server's own parseWav shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  timingSettings, timingAsked, lipsyncSpans, phoneSpans, wordSpans, mapThroughCuts, chunkSpans, buildTrack, writeWavWithTrack, readTrack,
} = require('./timing-track');
const { limitPauses, pauseSettings } = require('./inworld-pauses');

const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-fixtures/inworld-timing/rest_word_full.json'), 'utf8')).timestampInfo;
const lipOnly = { lipsyncAlignment: recorded.lipsyncAlignment };
const wordsOnly = { wordAlignment: recorded.wordAlignment };

// The server's parseWav, copied so this file needs no server boot (it walks chunks the same way).
function parseWav(buffer) {
  let offset = 12, fmt = null, data = null;
  while (offset < buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') fmt = { numChannels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), bitsPerSample: buffer.readUInt16LE(start + 14) };
    else if (id === 'data') data = buffer.slice(start, start + size);
    offset = start + size + (size % 2);
  }
  return { ...fmt, data };
}

test('settings: on by default, each switch read from the environment given', () => {
  assert.deepEqual(timingSettings({}), { on: true, words: true, maxBytes: 256 * 1024 });
  assert.deepEqual(timingSettings({ INWORLD_TIMINGS: '0', INWORLD_TIMINGS_WORDS: '0', INWORLD_TIMINGS_MAX_KB: '8' }), { on: false, words: false, maxBytes: 8 * 1024 });
  assert.equal(timingSettings({ INWORLD_TIMINGS_MAX_KB: 'lots' }).maxBytes, 256 * 1024);
  assert.equal(timingSettings({ INWORLD_TIMINGS_MAX_KB: '4096' }).maxBytes, 512 * 1024); // no reader keeps more
  assert.equal(timingAsked('1', undefined), true);
  assert.equal(timingAsked(undefined, true), true);
  assert.equal(timingAsked(undefined, 'true'), true);
  for (const [h, b] of [[undefined, undefined], ['0', false], ['yes', 'yes'], ['', 1]]) assert.equal(timingAsked(h, b), false);
});

test('the cut map: before a cut, inside one, after several, and a cut at 0', () => {
  const cuts = [[100, 200], [300, 350]];
  assert.equal(mapThroughCuts(50, cuts), 50);
  assert.equal(mapThroughCuts(100, cuts), 100);
  assert.equal(mapThroughCuts(150, cuts), 100, 'inside a cut lands on the cut');
  assert.equal(mapThroughCuts(250, cuts), 150);
  assert.equal(mapThroughCuts(320, cuts), 200);
  assert.equal(mapThroughCuts(400, cuts), 250);
  assert.equal(mapThroughCuts(0, [[0, 40]]), 0);
  assert.equal(mapThroughCuts(60, [[0, 40]]), 20);
  assert.equal(mapThroughCuts(77, []), 77);
});

test('the recorded answer reads as 15-shape lip-sync, phones and spoken words', () => {
  const lip = lipsyncSpans(recorded);
  assert.equal(lip.length, recorded.lipsyncAlignment.visemes.length);
  assert.deepEqual(lip[0], [0, 87.5, 'sil']);
  const words = wordSpans(recorded).map((w) => w[2]);
  assert.deepEqual(words.slice(0, 4), ['Well', 'I', 'finally', 'got']);
  assert.ok(!words.includes(',') && !words.includes('') && !words.includes('.'));
  const phones = phoneSpans(recorded);
  assert.ok(phones.length > 20);
  assert.ok(phones.every((p, i) => i === 0 || p[0] >= phones[i - 1][0]), 'sorted');
  assert.ok(phones.some((p) => p[2] === 'sil'), '[silence] is a closed mouth');
  assert.equal(lipsyncSpans(wordsOnly), null);
  assert.equal(lipsyncSpans(null), null);
  assert.equal(lipsyncSpans({ lipsyncAlignment: { visemes: ['aa'], visemeStartTimeSeconds: [0, 1], visemeEndTimeSeconds: [1] } }), null, 'arrays of different lengths');
});

test('bracketed sounds stay as words, [silence] and punctuation go', () => {
  const info = { wordAlignment: { words: ['[laugh]', ' ', 'Oh', ', ', '[silence]', 'wow', '!', ''], wordStartTimeSeconds: [0, 0.4, 0.4, 0.6, 0.6, 0.9, 1.2, 1.3], wordEndTimeSeconds: [0.4, 0.4, 0.6, 0.6, 0.9, 1.2, 1.3, 1.3] } };
  assert.deepEqual(wordSpans(info).map((w) => w[2]), ['[laugh]', 'Oh', 'wow']);
});

test('head and tail trims: spans before the head go, spans past the kept piece are cut short', () => {
  const spans = [[0, 50, 'sil'], [50, 120, 'aa'], [120, 400, 'oh']];
  assert.deepEqual(chunkSpans(spans, { headMs: 60, keptMs: 200, offsetMs: 1000 }), [[1000, 1060, 'aa'], [1060, 1200, 'oh']]);
});

test('a multi-chunk message: offsets, a 340 ms seam covered as silence, one track', () => {
  const a = { lipsyncAlignment: { visemes: ['aa', 'sil'], visemeStartTimeSeconds: [0, 0.5], visemeEndTimeSeconds: [0.5, 0.9] } };
  const b = { lipsyncAlignment: { visemes: ['sil', 'oh'], visemeStartTimeSeconds: [0, 0.1], visemeEndTimeSeconds: [0.1, 0.7] } };
  // chunk a: tail trimmed to 600 ms; chunk b: head trimmed 100 ms, 600 ms kept; seam 340 ms
  const track = buildTrack([
    { info: a, cuts: [], headMs: 0, keptMs: 600, offsetMs: 0 },
    { info: b, cuts: [], headMs: 100, keptMs: 600, offsetMs: 940 },
  ], 1540);
  assert.deepEqual(track.vis, [[0, 500, 'aa'], [500, 600, 'sil'], [940, 1540, 'oh']]);
  assert.deepEqual(track.cov, [[0, 1540]]);
  assert.equal(track.set, 'oxr');
  assert.equal(track.dur, 1540);
});

test('a chunk without lip-sync is a gap in cov, not a closed mouth', () => {
  const a = { lipsyncAlignment: { visemes: ['aa'], visemeStartTimeSeconds: [0], visemeEndTimeSeconds: [0.6] } };
  const track = buildTrack([
    { info: a, keptMs: 600, offsetMs: 0 },
    { info: wordsOnly, keptMs: 600, offsetMs: 940 },
    { info: a, keptMs: 600, offsetMs: 1880 },
  ], 2480);
  assert.deepEqual(track.cov, [[0, 600], [1880, 2480]]);
  assert.ok(track.w.some((w) => w[0] >= 940 && w[1] <= 1540), 'words still come from a chunk that has no lip-sync');
});

test('phones fill in as iw11 only when no chunk brought lip-sync', () => {
  const track = buildTrack([{ info: wordsOnly, keptMs: 6100, offsetMs: 0 }], 6100);
  assert.equal(track.set, 'iw11');
  assert.ok(track.vis.some((s) => s[2] === 'qw'));
  assert.ok(track.vis.every((s, i) => i === 0 || s[0] >= track.vis[i - 1][1]), 'sorted, no overlap');
});

test('repeated shapes merge, nothing has zero length', () => {
  const info = { lipsyncAlignment: { visemes: ['aa', 'aa', 'oh', 'PP', 'oh'], visemeStartTimeSeconds: [0, 0.1, 0.2, 0.3, 0.3002], visemeEndTimeSeconds: [0.1, 0.2, 0.3, 0.3002, 0.5] } };
  const track = buildTrack([{ info, keptMs: 500, offsetMs: 0 }], 500);
  // aa+aa join; the 0.2 ms PP rounds to nothing, so the two oh spans touch and join too
  assert.deepEqual(track.vis, [[0, 200, 'aa'], [200, 500, 'oh']]);
});

test('no usable data, no track', () => {
  assert.equal(buildTrack([{ info: null, keptMs: 100, offsetMs: 0 }], 100), null);
  assert.equal(buildTrack([{ info: {}, keptMs: 100, offsetMs: 0 }], 100), null);
  assert.equal(buildTrack([], 100), null);
  assert.equal(buildTrack([{ info: lipOnly, keptMs: 100, offsetMs: 0 }], 0), null);
});

test('the size cap drops the words first, then the whole track', () => {
  const chunk = { info: recorded, keptMs: 6100, offsetMs: 0 };
  const full = buildTrack([chunk], 6100);
  const whole = Buffer.byteLength(JSON.stringify(full));
  const noWords = { ...full };
  delete noWords.w;
  const lean = Buffer.byteLength(JSON.stringify(noWords));
  assert.ok(full.w);
  assert.equal(buildTrack([chunk], 6100, { maxBytes: whole }).w.length, full.w.length);
  assert.equal(buildTrack([chunk], 6100, { maxBytes: whole - 1 }).w, undefined);
  assert.ok(buildTrack([chunk], 6100, { maxBytes: lean }));
  assert.equal(buildTrack([chunk], 6100, { maxBytes: lean - 1 }), null);
  assert.equal(buildTrack([chunk], 6100, { words: false }).w, undefined);
});

test('every span lands within one 10 ms window of the edited audio (pause limiter on real PCM)', () => {
  const SR = 24000;
  const tone = (ms, amp) => { const b = Buffer.alloc(Math.round((SR * ms) / 1000) * 2); if (amp) for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * amp), i * 2); return b; };
  const pcm = Buffer.concat([tone(300, 3000), tone(1000, 0), tone(300, 3000), tone(900, 0), tone(200, 3000)]);
  const info = { lipsyncAlignment: { visemes: ['aa', 'sil', 'oh', 'sil', 'E'], visemeStartTimeSeconds: [0, 0.3, 1.3, 1.6, 2.5], visemeEndTimeSeconds: [0.3, 1.3, 1.6, 2.5, 2.7] } };
  const { pcm: out, cuts } = limitPauses(pcm, SR, { ...pauseSettings({}), on: true });
  const outMs = out.length / 48;
  assert.ok(cuts.length > 0 && outMs < 2700, 'the limiter cut something');
  const track = buildTrack([{ info, cuts, keptMs: outMs, offsetMs: 0 }], outMs);
  const last = track.vis[track.vis.length - 1];
  assert.ok(Math.abs(last[1] - outMs) <= 10, `last end ${last[1]} vs ${outMs}`);
  // the speech after the first long stop starts where the audio's speech starts
  const oh = track.vis.find((s) => s[2] === 'oh');
  let firstLoud = 300 * 48; // bytes: skip the first speech, then look for the second
  while (firstLoud < out.length && Math.abs(out.readInt16LE(firstLoud)) < 200) firstLoud += 2;
  assert.ok(Math.abs(oh[0] - firstLoud / 48) <= 10, `oh at ${oh[0]} vs audio ${firstLoud / 48}`);
});

test('the WAV carrier: fmt, kdtm, data; parseWav gives back the same format and bytes; odd and even JSON', () => {
  const fmt = { numChannels: 1, sampleRate: 24000, bitsPerSample: 16 };
  const pcm = Buffer.alloc(4800, 7);
  for (const json of ['{"v":1}', '{"v":1} ']) {
    const wav = writeWavWithTrack(fmt, json, pcm);
    assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
    assert.equal(wav.toString('ascii', 36, 40), 'kdtm');
    assert.equal(wav.readUInt32LE(4), wav.length - 8, 'RIFF size covers every chunk');
    assert.equal(wav.readUInt32LE(28), 48000, 'byte rate where the bridge reads it');
    const back = parseWav(wav);
    assert.deepEqual([back.numChannels, back.sampleRate, back.bitsPerSample], [1, 24000, 16]);
    assert.ok(back.data.equals(pcm));
    assert.equal(wav.length % 2, 0);
    assert.deepEqual(readTrack(wav), { v: 1 });
  }
  assert.equal(readTrack(Buffer.from('RIFF\x04\x00\x00\x00WAVE', 'latin1')), null);
  assert.equal(readTrack(writeWavWithTrack(fmt, '{"v":2}', pcm)), null, 'unknown version');
  assert.equal(readTrack(writeWavWithTrack(fmt, '{broken', pcm)), null);
});
