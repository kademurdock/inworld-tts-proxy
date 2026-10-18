'use strict';
/* Oct 17 2026: Fish Drama3 on a cloned reference ran on after a short line (4 of 16 takes of
 * "Audio description by Kade-AI.", 18-48 s instead of about 2.3 s). fish-runaway.js measures every
 * Fish chunk against the words it was asked to say. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spokenText, pcmSeconds, measureFishChunk, checkTake } = require('./fish-runaway');
const { fishPacedText } = require('./pace');

const RATE = 24000;
function wavOf(parts) {
  const out = [];
  for (const [kind, ms] of parts) {
    const n = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < n; i++) out.push(kind === 'tone' ? Math.round(8000 * Math.sin(i / 3)) : (i % 2 ? 20 : -20));
  }
  const pcm = Buffer.from(new Int16Array(out).buffer);
  return Buffer.concat([Buffer.alloc(44), pcm]);
}

test('spoken text leaves out bracket directions, sounds and <tags>', () => {
  assert.equal(spokenText('[talking off the cuff] Ha, [small laugh] that is <emphasis>so</emphasis> funny. [short pause]'),
    'Ha, that is so funny.');
  assert.equal(spokenText('[breathe]'), '');
  assert.equal(spokenText(''), '');
});

test('seconds and voiced seconds come from the PCM after the 44-byte header', () => {
  const wav = wavOf([['gap', 200], ['tone', 1000], ['gap', 500], ['tone', 300]]);
  const { seconds, voiced } = pcmSeconds(wav.subarray(44), RATE);
  assert.ok(Math.abs(seconds - 2) < 0.01, String(seconds));
  assert.ok(Math.abs(voiced - 1.3) < 0.03, String(voiced));
  assert.deepEqual(pcmSeconds(Buffer.alloc(0), RATE), { seconds: 0, voiced: 0 });
});

test('a chunk is measured on what Fish was asked to say, not on the briefs', () => {
  const sent = fishPacedText('Ha, that is hilarious. [small laugh] Okay. [short pause]', 0.75, { talk: true });
  const m = measureFishChunk(sent, wavOf([['tone', 2500]]), RATE);
  assert.equal(m.chars, 'Ha, that is hilarious. Okay.'.length);
  assert.equal(m.words, 5);
  assert.equal(m.sentences, 2);
  assert.equal(m.sounds, 1);
  assert.equal(m.pauses, 1);
  assert.ok(Math.abs(m.seconds - 2.5) < 0.01);
});

test('every take is logged with its pace and voice, and the switch turns the measuring off', () => {
  const lines = [];
  const m = checkTake('Sure!', wavOf([['tone', 900]]), { rate: 1.5, talk: { turn: 0 }, delivery: 'CREATIVE', voice: 'ref_0123456789abcdef', log: l => lines.push(l) });
  assert.equal(m.chars, 5);
  assert.match(lines[0], /^\[TTS\] fish chunk length: chars=5 words=1 sentences=1 sounds=0 pauses=0 seconds=0\.90 voiced=0\.90 sPerChar=0\.1800 pace=Quick talk=yes delivery=CREATIVE voice=ref_0123456789abcdef$/);
  process.env.FISH_RUNAWAY_GUARD = 'off';
  try {
    assert.equal(checkTake('Sure!', wavOf([['tone', 900]]), { rate: 1, log: l => lines.push(l) }), null);
    assert.equal(lines.length, 1);
  } finally {
    delete process.env.FISH_RUNAWAY_GUARD;
  }
});
