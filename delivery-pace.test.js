'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shapeDeliveryPace } = require('./speech-prosody');

test('Balanced and Steady keep feeling and sounds while normalizing tempo in saved text', () => {
  for (const mode of ['BALANCED', 'STABLE']) {
    const input = '[warm and unhurried] Take the slow train. [laugh] [quick and delighted] We won! [reset] Done.';
    const result = shapeDeliveryPace(input, mode);
    assert.equal(result, '[warm and at a natural conversational pace] Take the slow train. [laugh] [at a natural conversational pace and delighted] We won! [reset] Done.');
    assert.equal(result.replace(/\[[^\]]*\]/g, ''), input.replace(/\[[^\]]*\]/g, ''));
  }
});
test('no forced quietness, cue density, or changes to Lively acting', () => {
  const text = '[excited] Really! [sad] Oh. [short pause] [sigh] [breathe] All right.';
  assert.equal(shapeDeliveryPace(text, 'BALANCED'), text);
  for (const mode of ['CREATIVE', undefined]) assert.equal(shapeDeliveryPace('[fast] Go.', mode), '[fast] Go.');
});
test('tempo phrases are consumed whole and reprocessing is stable', () => {
  for (const tag of ['taking your time with every word','picking up speed','rapid-fire','slow pace','breathless','not rushed',"don't rush",'not too fast']) {
    const result=shapeDeliveryPace('['+tag+'] Hello.', 'BALANCED');
    assert.equal(result,'[at a natural conversational pace] Hello.');
    assert.equal(shapeDeliveryPace(result, 'BALANCED'),result);
  }
});
