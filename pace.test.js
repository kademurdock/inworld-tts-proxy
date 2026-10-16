'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FISH_PACES, fishPace, fishPacedText } = require('./pace');

// Finding 27 (Oct 16 2026): the pace instruction rides in Fish's billed text on
// every chunk, so it is the shortest form that still names the pace.
test('the Fish pace instruction is a short pace tag that still names the pace', () => {
  const text = '[warm and amused] I <emphasis>really</emphasis> mean it.';
  const want = { 0.75: /unhurried/, 0.9: /easygoing/, 1.2: /brisk/, 1.5: /quick/ };
  for (const pace of FISH_PACES) {
    const added = fishPacedText(text, pace.value).length - text.length;
    if (pace.name === 'Natural') { assert.equal(added, 0); continue; }
    assert.ok(added <= 18, `${pace.name} adds ${added} characters`);
    assert.match(fishPacedText(text, pace.value), want[pace.value]);
    assert.match(fishPacedText(text, pace.value), /^\[[a-z]+ pace\] /);
    assert.ok(fishPacedText(text, pace.value).endsWith(' ' + text), 'the spoken words follow unchanged');
  }
  // Before: Unhurried +60, Easygoing +79, Brisk +79, Quick +87 characters per request.
  const total = FISH_PACES.reduce((sum, pace) => sum + fishPacedText('x', pace.value).length - 1, 0);
  assert.ok(total <= 60, `all four paces together add ${total} characters`);
  // The served pace names and values are unchanged, so clients keep sending the same speeds.
  assert.deepEqual(FISH_PACES.map(({ value, name }) => [value, name]),
    [[0.75, 'Unhurried'], [0.9, 'Easygoing'], [1, 'Natural'], [1.2, 'Brisk'], [1.5, 'Quick']]);
  assert.equal(fishPace(undefined).name, 'Natural');
});
