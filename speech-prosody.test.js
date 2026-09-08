const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInworldCaps, shapeFishPauses } = require('./speech-prosody');
test('ordinary emphasized words remain words while acronyms and steering survive', () => {
  assert.equal(normalizeInworldCaps('[IS this deliberate?] This IS it. NASA uses API and USB.'), '[IS this deliberate?] This is it. NASA uses API and USB.');
});
test('Fish sentences receive bounded pauses without changing their words', () => {
  assert.equal(shapeFishPauses('One sentence. Another sentence! Really? Yes.'), 'One sentence. [short pause] Another sentence! [short pause] Really? [short pause] Yes.');
  assert.equal((shapeFishPauses('One. '.repeat(30)).match(/\[short pause\]/g) || []).length, 12);
});
test('preserves punctuation inside directions, abbreviations, decimals, ellipses and authored pauses', () => {
  const input = '[warm. Then amused] Dr. Smith paid 1.25. [pause] Really... maybe.';
  assert.equal(shapeFishPauses(input), input);
  assert.equal(shapeFishPauses('One. [inhale] Two.'), 'One. [inhale] Two.');
});
