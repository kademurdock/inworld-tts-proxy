const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPerformableContent, liftInstruction } = require('./sounds');

test('standalone supported sounds survive both instruction lifting and content filtering', () => {
  for (const text of ['[laugh]', '[sigh]', '[cough]', '[breathe]', '[reset] [laugh]']) {
    assert.equal(hasPerformableContent(text), true, text);
    assert.equal(hasPerformableContent(liftInstruction(text).text), true, text);
  }
  const directed = liftInstruction('[warm and close] [laugh]');
  assert.equal(directed.instruction, 'warm and close');
  assert.equal(hasPerformableContent(directed.text), true);
});

test('direction-only, reset-only and punctuation do not request empty speech', () => {
  for (const text of ['', null, '…', '[reset]', '[warm and close]', '[quietly] [reset]']) {
    assert.equal(hasPerformableContent(text), false, String(text));
  }
});

test('speech in non-Latin scripts is retained', () => {
  for (const text of ['你好', 'مرحبا', 'こんにちは', '[quietly] Hello.']) {
    assert.equal(hasPerformableContent(text), true);
  }
});
