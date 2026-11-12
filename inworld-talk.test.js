'use strict';
// Nov 12 2026: chat speech talks instead of performing (inworld-talk.js). Off unless INWORLD_TALK_DELIVERY=frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const talk = require('./inworld-talk');
const { talkSettings, shapeTalk, talkText, liftDirection, cleanFrame, DEFAULT_FRAME, BREAKER } = talk;
const F = DEFAULT_FRAME;
const ON = { INWORLD_TALK_DELIVERY: 'frame' };

test('off unless INWORLD_TALK_DELIVERY=frame; off, the character\'s direction passes untouched', () => {
  talk._resetForTests();
  for (const v of [undefined, '', '0', 'off', 'on', 'reason', 'plain', 'framed']) {
    const s = talkSettings(v === undefined ? {} : { INWORLD_TALK_DELIVERY: v });
    assert.equal(s.mode, 'off', String(v));
    assert.deepEqual(shapeTalk('warm and chatty', s), { instruction: 'warm and chatty', shaped: false });
    assert.deepEqual(shapeTalk(null, s), { instruction: null, shaped: false });
    assert.equal(talkText('[reset] Anyway.', s), '[reset] Anyway.');
    assert.equal(liftDirection('amused', s), null);
  }
  assert.equal(talkSettings({ INWORLD_TALK_DELIVERY: ' Frame ' }).mode, 'frame', 'case and spaces do not matter');
  // the frame rides the instruction field, so the field's own kill switch turns it off too
  assert.equal(talkSettings({ ...ON, KADE_TTS_INSTRUCTION_FIELD: '0' }).mode, 'off');
  assert.equal(talkSettings({ ...ON, KADE_TTS_INSTRUCTION_FIELD: '1' }).mode, 'frame');
});

test('the default frame is the measured wording; the character\'s direction leads it', () => {
  assert.equal(F, 'talking with a close friend on the phone, animated and natural, just chatting, not performing');
  const s = talkSettings(ON);
  assert.deepEqual(shapeTalk('laugh then warm', s), { instruction: `laugh then warm, ${F}`, shaped: true });
  assert.deepEqual(shapeTalk(null, s), { instruction: F, shaped: true });
  assert.deepEqual(shapeTalk('   ', s), { instruction: F, shaped: true }, 'a blank direction is none');
  assert.deepEqual(shapeTalk(' dry\nand  satisfied ', s), { instruction: `dry and satisfied, ${F}`, shaped: true });
  assert.deepEqual(shapeTalk(`warm, ${F}`, s), { instruction: `warm, ${F}`, shaped: false }, 'never framed twice');
});

test('merge orders: after puts the frame first, replace drops the direction, bare frames only the undirected', () => {
  const after = talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: 'after' });
  assert.deepEqual(shapeTalk('dry', after), { instruction: `${F}, dry`, shaped: true });
  const rep = talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: 'replace' });
  assert.deepEqual(shapeTalk('dry', rep), { instruction: F, shaped: true });
  const bare = talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: 'bare' });
  assert.deepEqual(shapeTalk('dry', bare), { instruction: 'dry', shaped: false });
  assert.deepEqual(shapeTalk(null, bare), { instruction: F, shaped: true });
  assert.equal(talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: 'nonsense' }).frameMerge, 'merge');
});

test('the speed: only a direction that still leads the instruction keeps its lift', () => {
  assert.equal(liftDirection('amused', talkSettings(ON)), 'amused');
  assert.equal(liftDirection(null, talkSettings(ON)), null);
  for (const m of ['after', 'replace', 'bare']) assert.equal(liftDirection('amused', talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: m })), null, m);
  assert.equal(talkSettings({ INWORLD_TALK_LIFT: '1.06' }).lift, 1.06);
  assert.equal(talkSettings({ INWORLD_TALK_LIFT: '9' }).lift, 1.3);
  assert.equal(talkSettings({ INWORLD_TALK_LIFT: '0.1' }).lift, 0.8);
  assert.equal(talkSettings({ INWORLD_TALK_LIFT: 'fast' }).lift, 1);
});

test('a [reset] that opens a piece goes (it would clear the frame); everything else in the words stays', () => {
  const s = talkSettings(ON);
  assert.equal(talkText('[reset] Anyway, the report is on your desk.', s), 'Anyway, the report is on your desk.');
  assert.equal(talkText('  [RESET]  Anyway.', s), '  Anyway.');
  assert.equal(talkText('[laugh] Anyway.', s), '[laugh] Anyway.', 'an opening sound stays');
  assert.equal(talkText('[dry] Anyway.', s), '[dry] Anyway.', 'an opening direction stays (it was not lifted)');
  for (const t of ['First bit. [reset] Second bit.', 'Okay. [dry and satisfied] Yeah.', 'he just went [clicks tongue] and', 'A [sobbing] B', 'no tags at all', '']) {
    assert.equal(talkText(t, s), t, t);
  }
  assert.equal(talkText('[reset] Anyway.', talkSettings({ ...ON, INWORLD_TALK_FRAME_MERGE: 'bare' })), '[reset] Anyway.', 'bare: untouched');
  assert.equal(talkText(null, s), '');
});

test('the frame is one clean line: brackets, percent signs and controls cannot reach the voice', () => {
  assert.equal(cleanFrame('relaxed] and natural'), 'relaxed and natural');
  assert.equal(cleanFrame('[a natural phone conversation]'), 'a natural phone conversation');
  assert.equal(cleanFrame('%%%warm%%%\n chat'), 'warm chat');
  assert.equal(cleanFrame('   '), '');
  assert.equal(cleanFrame('][%'), '');
  assert.equal(cleanFrame('x'.repeat(500)).length, talk.FRAME_MAX);
  assert.equal(talkSettings({ ...ON, INWORLD_TALK_FRAME: ' ]] ' }).frame, F, 'an empty frame falls back to the default');
  assert.equal(talkSettings({ ...ON, INWORLD_TALK_FRAME: 'a natural phone conversation with your best friend' }).frame, 'a natural phone conversation with your best friend');
});

test('five refusals in ten minutes turn the frame off for thirty, then it comes back; /health counts them', () => {
  talk._resetForTests();
  const t0 = 1_000_000_000;
  for (let i = 0; i < BREAKER.refusals - 1; i++) assert.equal(talk.noteRefused(t0 + i * 1000), false);
  assert.equal(talkSettings(ON, t0 + 5000).mode, 'frame');
  assert.equal(talk.noteRefused(t0 + 5000), true, 'the fifth trips it');
  assert.equal(talkSettings(ON, t0 + 6000).mode, 'off');
  const h = talk.talkHealth(ON, t0 + 6000);
  assert.deepEqual([h.mode, h.asked, h.refused, h.offForMinutes], ['off', 'frame', 5, 30]);
  assert.equal(talkSettings(ON, t0 + 5000 + BREAKER.offMs).mode, 'frame', 'back after thirty minutes');
  // refusals spread wider than the window never trip it
  talk._resetForTests();
  for (let i = 0; i < 20; i++) assert.equal(talk.noteRefused(t0 + i * (BREAKER.windowMs / 4 + 1)), false);
  talk.noteShaped();
  assert.equal(talk.talkHealth(ON, t0).shaped, 1);
  talk._resetForTests();
});
