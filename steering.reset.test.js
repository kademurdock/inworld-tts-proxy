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
  /* Part 109: the carry now stamps a TEMPO-STRIPPED copy, so the extracted
   * slice has to start at the helper that does the stripping rather than at
   * applySteeringTags itself — otherwise this runs the real function against
   * a helper that does not exist, which is a test failing for the one reason
   * that tells you nothing. Still a slice of the SHIPPED file, never a copy. */
  const helperStart = src.indexOf('const CARRY_TEMPO_STRIP =');
  assert.ok(helperStart > -1, 'CARRY_TEMPO_STRIP not found in server.js');
  const start = src.indexOf('function applySteeringTags(text) {');
  assert.ok(start > -1, 'applySteeringTags not found in server.js');
  assert.ok(helperStart < start, 'the tempo helper must be defined before applySteeringTags');
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
    // Part 109: the tempo helper reads its kill switch off the environment.
    // Give the sandbox a real one so the DEFAULT (strip on) is what is tested;
    // a test that silently ran with the switch flipped would be worse than no
    // test at all.
    process: { env: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(helperStart, end) + '\nthis.fn = applySteeringTags;\nthis.strip = stripTempoForCarry;', ctx);
  return ctx.fn;
}
const applySteeringTags = loadApplySteeringTags();

/* ⭐ PART 109 UPDATED THIS TEST, and the change is the point rather than a
 * casualty. It was written to pin the Aug-18 cap: this exact tag carried onto
 * exactly two paragraphs and no further. That half is unchanged and still
 * asserted below. What changed is the CONTENT of the carried copy — "quick"
 * is a tempo instruction, and a carried tempo instruction is what made her
 * replies step from one speaking speed to another mid-reply. The author's own
 * leading tag keeps every word; only the copy the carry stamps loses "quick".
 * Measured cost of that word on a fixed 92-char sentence: 4.53s vs 6.20s
 * untagged, a 27% speed-up that then snaps back when the carry expires. */
test('the cap still stops the carry at two paragraphs', () => {
  const reply = ['%%%quick and animated still a little spooked by it%%%', 'P one.', 'P two.', 'P three.', 'P four.'].join('\n\n');
  const out = applySteeringTags(reply);
  const stamped = (out.match(/\[animated still a little spooked by it\]/g) || []).length;
  assert.strictEqual(stamped, 2, 'the direction-only paragraph is dropped and the next two carry it');
  assert.ok(!/\[.*\]\s*P three\./.test(out), 'the cap stops it at two');
});

test('THE PART-109 FIX: the carried copy keeps the mood and drops the tempo word', () => {
  const reply = ['%%%quick and animated still a little spooked by it%%% First beat.', 'Second.', 'Third.'].join('\n\n');
  const out = applySteeringTags(reply);
  assert.ok(/\[quick and animated still a little spooked by it\] First beat\./.test(out),
    "the author's own tag is left exactly as written — that is intent, not accident");
  assert.strictEqual((out.match(/\[quick /g) || []).length, 1,
    'and "quick" appears nowhere else: no carried copy may set a clock');
  assert.ok(/\[animated still a little spooked by it\] Second\./.test(out),
    'the carry still runs, still carries the FEELING — going flat is the bug it exists to prevent');
});

test('a purely emotional direction carries verbatim — the fix touches nothing it should not', () => {
  const reply = ['%%%warm and kind%%% One.', 'Two.'].join('\n\n');
  const out = applySteeringTags(reply);
  assert.strictEqual((out.match(/\[warm and kind\]/g) || []).length, 2);
});

test('a direction that is ONLY tempo carries as no tag at all, never as an empty bracket', () => {
  const reply = ['%%%unhurried%%% One.', 'Two.', 'Three.'].join('\n\n');
  const out = applySteeringTags(reply);
  assert.ok(/\[unhurried\] One\./.test(out), 'the authored one stands');
  assert.ok(!/\[\s*\]/.test(out), 'an empty bracket would be read aloud as punctuation');
  assert.ok(/\n\nTwo\./.test(out), 'the carried paragraph is simply left bare');
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
