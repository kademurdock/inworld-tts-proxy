'use strict';
// Oct 17 2026: how a filler word is placed (TALK_FILLER_STYLE). Kade heard the sentence-opening
// "Um," as scripted; these hold the other styles still.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fishTalkFillers, talkFillersByParagraph, fillerStyle, fishPacedText } = require('./pace');

const TEXT = 'Okay so I checked on that for you. I was thinking about the porch swing all afternoon and it still squeaks every time. That swing has been through a lot of summers.';

function withStyle(style, fn) {
  const before = process.env.TALK_FILLER_STYLE;
  if (style === undefined) delete process.env.TALK_FILLER_STYLE;
  else process.env.TALK_FILLER_STYLE = style;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TALK_FILLER_STYLE;
    else process.env.TALK_FILLER_STYLE = before;
  }
}

test('unset or unknown style keeps the Oct 16 behaviour', () => {
  assert.equal(withStyle(undefined, fillerStyle), 'lead');
  assert.equal(withStyle('sideways', fillerStyle), 'lead');
  const lead = withStyle(undefined, () => fishTalkFillers(TEXT, { turn: 0, seed: 1 }));
  assert.match(lead, /(?:Um|Uh), [a-z]/);
});

test('none: no filler word at all, the words are untouched', () => {
  assert.equal(withStyle('none', () => fishTalkFillers(TEXT, { turn: 0, seed: 1 })), TEXT);
  assert.equal(withStyle('none', () => talkFillersByParagraph(`${TEXT}\n\n${TEXT}`, { seed: 2 })), `${TEXT}\n\n${TEXT}`);
});

test('mid: the word sits inside a sentence, never opening one', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const out = withStyle('mid', () => fishTalkFillers(TEXT, { turn: 0, seed }));
    assert.notEqual(out, TEXT, `seed ${seed} placed nothing`);
    assert.match(out, /\S, (?:uh|um), [a-z]/, out);
    assert.doesNotMatch(out, /(?:^|[.!?] )(?:Um|Uh)\b/, out);
    assert.equal(out.replace(/, (?:uh|um),/, ''), TEXT);
  }
});

test('pause: the same kind of spot gets a trail-off and no word', () => {
  const out = withStyle('pause', () => fishTalkFillers(TEXT, { turn: 0, seed: 3 }));
  assert.match(out, /\w\.\.\. ?[a-z]|\w\.\.\.[ ]/, out);
  assert.doesNotMatch(out, /\b(?:uh|um)\b/i);
  assert.equal(out.replace('...', ''), TEXT);
});

test('run: the word sits mid-thought with no commas around it (Kade\'s pick)', () => {
  assert.equal(withStyle('run', fillerStyle), 'run');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const out = withStyle('run', () => fishTalkFillers(TEXT, { turn: 0, seed }));
    assert.notEqual(out, TEXT, `seed ${seed} placed nothing`);
    assert.match(out, /[a-z'’] (?:uh|um) [a-z]/, out);
    assert.doesNotMatch(out, /,\s*(?:uh|um)\b|\b(?:uh|um),/i, out);
    assert.doesNotMatch(out, /(?:^|[.!?] )(?:Um|Uh)\b/, out);
    assert.equal(out.replace(/ (?:uh|um)(?= )/, ''), TEXT);
  }
});

test('mid, pause and run still leave lists, quotes and short lines alone', () => {
  for (const style of ['mid', 'pause', 'run']) {
    withStyle(style, () => {
      assert.equal(fishTalkFillers('- milk\n- eggs and bread for the week'), '- milk\n- eggs and bread for the week');
      assert.equal(fishTalkFillers('She said "I was there and it was fine" to me.'), 'She said "I was there and it was fine" to me.');
    });
  }
});

test('the casual brief still rides Fish chat speech with words off', () => {
  const before = process.env.FISH_DEFAULT_DIRECTION;
  process.env.FISH_DEFAULT_DIRECTION = 'talking to a friend';
  try {
    const out = withStyle('none', () => fishPacedText(TEXT, 1, { talk: { turn: 0, seed: 1, fillers: true, sounds: false } }));
    assert.match(out, /^\[talking to a friend\] /);
    assert.doesNotMatch(out, /\b(?:Um|Uh|um|uh)\b/);
  } finally {
    if (before === undefined) delete process.env.FISH_DEFAULT_DIRECTION;
    else process.env.FISH_DEFAULT_DIRECTION = before;
  }
});
