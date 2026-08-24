const test = require('node:test');
const assert = require('node:assert');
const { isNonVerbalSound, isDirectionTag, liftInstruction } = require('./sounds');

/* ── the six we had, which must not regress ────────────────────────────────*/
test('the original six are still sounds', () => {
  for (const t of ['laugh', 'breathe', 'clear throat', 'sigh', 'cough', 'yawn']) {
    assert.ok(isNonVerbalSound(t), `${t} must be a sound`);
  }
});

/* ── the forty-four that were being CARRIED FORWARD as directions ──────────*/
test('the sounds Kade named from memory are sounds', () => {
  // "it can crack, it can hock and spit and snort"
  for (const t of ['spit', 'snort', 'cough', 'gulp', 'sniffle']) {
    assert.ok(isNonVerbalSound(t), `${t} must be a sound`);
  }
});

test('a gasp gasps once — it is not a style to wear for the rest of the reply', () => {
  assert.ok(isNonVerbalSound('gasp'));
  assert.ok(!isDirectionTag('gasp'), 'gasp must never be carried forward');
  for (const t of ['chuckle', 'giggle', 'scoff', 'shush', 'tongue click', 'lip smack']) {
    assert.ok(isNonVerbalSound(t), `${t} must be a sound`);
  }
});

test('matching ignores case, spacing and punctuation, and takes inflections', () => {
  for (const t of ['Clear Throat', 'clear_throat', 'clears throat', 'throat clearing',
                   'CLEAR THROAT', '  clear   throat  ']) {
    assert.ok(isNonVerbalSound(t), `${t} must resolve to clear throat`);
  }
  assert.ok(isNonVerbalSound('laughs'));
  assert.ok(isNonVerbalSound('sighing'));
});

/* ── the ones the docs single out as NOT sounds ────────────────────────────*/
test('shout, scream, sing, hum and mumble are INSTRUCTIONS, not sounds', () => {
  for (const t of ['shout', 'scream', 'sing', 'hum', 'mumble']) {
    assert.ok(!isNonVerbalSound(t), `${t} describes how words are spoken`);
    assert.ok(isDirectionTag(t), `${t} must be treated as a direction`);
  }
});

test('a real direction is still a direction', () => {
  for (const t of ['settling in like i have been waiting for somebody to ask this',
                   'say playfully', 'warm and low like a late night phone call',
                   'speak through gritted teeth']) {
    assert.ok(isDirectionTag(t), `${t} must be a direction`);
  }
});

/* ── the lift, which is the whole point ────────────────────────────────────*/
test('a leading direction moves out of the text and into the field', () => {
  const r = liftInstruction('[settling in like i have been waiting] Somebody born in 1885 saw it.');
  assert.strictEqual(r.instruction, 'settling in like i have been waiting');
  assert.strictEqual(r.text, 'Somebody born in 1885 saw it.');
  assert.ok(!r.text.includes('['), 'the tag must be gone from the text');
});

test('THE RETIRED CLASS: a direction-only chunk leaves NO text behind', () => {
  // This exact string 400d on the live API and became her error tone.
  const r = liftInstruction("[settling in like i've been waiting for somebody to ask this]");
  assert.strictEqual(r.text.trim(), '', 'nothing speakable is left in the text');
  assert.ok(r.instruction, 'and the direction survives as a field');
});

test('a leading SOUND is left exactly where it was written', () => {
  const r = liftInstruction('[laugh] I could not believe it.');
  assert.strictEqual(r.instruction, null, 'a sound is not an instruction');
  assert.strictEqual(r.text, '[laugh] I could not believe it.', 'and it must not move');
});

test('mid-text tags are left alone — an inline tag overrides the field on purpose', () => {
  const r = liftInstruction('[say playfully] One. [whisper] Two.');
  assert.strictEqual(r.instruction, 'say playfully');
  assert.strictEqual(r.text, 'One. [whisper] Two.', 'the second tag stays inline');
});

test('untagged text is returned untouched', () => {
  const r = liftInstruction('Just a sentence.');
  assert.strictEqual(r.instruction, null);
  assert.strictEqual(r.text, 'Just a sentence.');
});

test('junk never throws', () => {
  for (const v of [null, undefined, '', '   ', 42, '[]', '[   ]']) {
    const r = liftInstruction(v);
    assert.ok(typeof r.text === 'string');
  }
});
