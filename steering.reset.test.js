/* steering.reset.test.js — Aug 25 2026.
 *
 * Covers the [reset] work in BOTH halves: sounds.js (unit) and server.js's
 * applySteeringTags carry-forward (extracted from the real file, not a copy —
 * a test that runs against a transcription of the code proves nothing).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const sounds = require('./sounds');

// ── sounds.js ───────────────────────────────────────────────────────────────
test('reset is recognised, case and spacing insensitive', () => {
  for (const v of ['reset', 'RESET', 'Reset', ' reset ', '[reset]'.slice(1, -1)]) {
    assert.strictEqual(sounds.isResetTag(v), true, v);
  }
});

test('reset is not a sound and not confused with one', () => {
  assert.strictEqual(sounds.isNonVerbalSound('reset'), false);
  assert.strictEqual(sounds.isResetTag('laugh'), false);
  assert.strictEqual(sounds.isResetTag('quick and animated'), false);
});

test('THE BUG: a leading [reset] is never lifted into the instruction field', () => {
  const out = sounds.liftInstruction('[reset] Anyway, here is what I actually found.');
  assert.strictEqual(out.instruction, null,
    'lifting reset would send the literal word "reset" as a delivery instruction');
  assert.ok(out.text.startsWith('[reset]'), 'reset must stay inline where Inworld can act on it');
});

test('an ordinary leading direction still lifts', () => {
  const out = sounds.liftInstruction('[quick and animated still a little spooked by it] See, that is the exact scenario.');
  assert.strictEqual(out.instruction, 'quick and animated still a little spooked by it');
  assert.strictEqual(out.text, 'See, that is the exact scenario.');
});

test('a real sound still stays put', () => {
  const out = sounds.liftInstruction('[laugh] Girl, no.');
  assert.strictEqual(out.instruction, null);
  assert.strictEqual(out.text, '[laugh] Girl, no.');
});

// ── server.js applySteeringTags, extracted from the shipped source ──────────
function loadApplySteeringTags() {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const start = src.indexOf('function applySteeringTags(text) {');
  assert.ok(start > -1, 'applySteeringTags not found in server.js');
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > -1, 'could not bracket-match applySteeringTags');
  const ctx = {
    STEERING_OPEN: '%%%', STEERING_CLOSE: '%%%',
    STEER_CARRY_MAX: 2,
    soundsIsDirectionTag: sounds.isDirectionTag,
    soundsIsResetTag: sounds.isResetTag,
    vocalizeDirection: (s) => s,
    sanitizeDirectionText: (s) => String(s).replace(/\s{2,}/g, ' ').trim(),
    module: {}, exports: {},
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.fn = applySteeringTags;', ctx);
  return ctx.fn;
}
const applySteeringTags = loadApplySteeringTags();

test('the live bug reproduces: one pace tag carries onto the next two paragraphs', () => {
  const reply = ['%%%quick and animated still a little spooked by it%%%', 'P one.', 'P two.', 'P three.', 'P four.'].join('\n\n');
  const out = applySteeringTags(reply);
  const stamped = (out.match(/\[quick and animated still a little spooked by it\]/g) || []).length;
  assert.strictEqual(stamped, 2, 'the direction-only paragraph is dropped and the next two carry it');
  assert.ok(!/\[.*\]\s*P three\./.test(out), 'the cap stops it at two');
});

test('THE FIX: %%%reset%%% ends the carry instead of being carried', () => {
  const reply = ['%%%cracking up barely able to get it out%%% Girl. GIRL.', '%%%reset%%% Anyway, here is the real part.', 'And this one too.'].join('\n\n');
  const out = applySteeringTags(reply);
  assert.ok(!/\[reset\][^\n]*\n\n\[reset\]/.test(out), 'reset must never be stamped onto a later paragraph');
  assert.strictEqual((out.match(/\[reset\]/g) || []).length, 1, 'exactly the one the author wrote');
  assert.ok(!/\[cracking up barely able to get it out\][^]*And this one too\./.test(out.split('[reset]')[1] || ''),
    'the old direction must not survive past the reset');
});

test('without reset the direction still carries — the fix changes nothing else', () => {
  const reply = ['%%%dry as hell like you are already unimpressed%%% One.', 'Two.', 'Three.'].join('\n\n');
  const out = applySteeringTags(reply);
  assert.strictEqual((out.match(/\[dry as hell like you are already unimpressed\]/g) || []).length, 3);
});

test('untagged text is untouched', () => {
  assert.strictEqual(applySteeringTags('Just words.\n\nMore words.'), 'Just words.\n\nMore words.');
});
