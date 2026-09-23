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

test('lively baseline: Balanced only, never over a direction the character wrote', () => {
  const { baselineInstruction, LIVELY_BASELINE } = require('./speech-prosody');
  assert.equal(baselineInstruction(null, 'BALANCED'), LIVELY_BASELINE);
  assert.equal(baselineInstruction('whispering, sad', 'BALANCED'), 'whispering, sad');
  assert.equal(baselineInstruction(null, 'STABLE'), null);
  assert.equal(baselineInstruction(null, 'CREATIVE'), null);
  assert.doesNotMatch(LIVELY_BASELINE, /\b(?:slow|fast|quick|unhurried|pace|tempo)\b/i, "speed stays the listener's");
  process.env.KADE_TTS_LIVELY_BASELINE = '0';
  try { assert.equal(baselineInstruction(null, 'BALANCED'), null); } finally { delete process.env.KADE_TTS_LIVELY_BASELINE; }
});
