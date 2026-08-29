/* KADE Aug 29 2026 — [reset] is Inworld's word; the fish lane must not seed it.
 * isDirectionTag('reset') is deliberately true (reset is not a canonical
 * sound), so seedFishSteering's per-sentence seeder treated a closing [reset]
 * as a direction and stamped it onto every sentence of the paragraph. On fish,
 * reset's whole meaning is "no seed" — the tag strips, the paragraph rides the
 * clone's own baseline. Extracted from the shipped server.js, not a copy.
 * Red-proof: remove the strip line in seedFishSteering and tests 1+2 fail. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sounds = require('./sounds');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function grab(name, endMark) {
  const i = src.indexOf(name);
  assert.ok(i > -1, 'missing ' + name);
  const j = src.indexOf(endMark, i);
  return src.slice(i, j + endMark.length);
}
const soundsIsDirectionTag = sounds.isDirectionTag;
const soundsIsResetTag = sounds.isResetTag;
/* eslint-disable no-eval, no-unused-vars */
eval([
  grab('const ELLIPSIS_TOKEN', ';'),
  grab('const DOT_TOKEN', ';'),
  grab('const SENTENCE_ABBREVIATIONS', '];'),
  grab('function splitSentences', '\n}'),
  grab('const FISH_NONVERBAL_DIALECT', ';'),
  grab('const FISH_EMPHASIS_STOPLIST', ';'),
  grab('function fishEmphasisFromCaps', '\n}'),
  grab('const FISH_SEED_MIN_SENTENCE_LEN', ';'),
  grab('function collapseAdjacentTags', '\n}'),
  grab('const LEADING_TAG_RE', ';'),
  grab('function isDirectionTag', '\n}'),
  grab('function seedFishSteering', '\n}'),
].join('\n'));

const reply = '[gentle] First thought here, said slowly and with some length to it.\n\n[reset] Anyway. Text me when you head out tomorrow morning, okay?';

test('fish lane strips [reset] instead of seeding it', () => {
  const out = seedFishSteering(reply);
  assert.ok(!/\[\s*reset\s*\]/i.test(out), 'no [reset] may survive on the fish lane: ' + out);
});

test('the paragraph after a reset carries NO seeded direction', () => {
  const out = seedFishSteering(reply);
  const closing = out.split(/\n\s*\n/)[1];
  assert.ok(!closing.trim().startsWith('['), 'closing paragraph must open bare: ' + closing);
});

test('real directions still seed per sentence around a reset', () => {
  const out = seedFishSteering('[warm] One sentence long enough to matter here. Another sentence long enough to matter here too.\n\n[reset] Done now, plain and simple, nothing more to perform tonight.');
  assert.ok(out.startsWith('[warm]'), 'leading direction kept');
  assert.ok((out.match(/\[warm\]/g) || []).length >= 2, 'per-sentence seeding still fires');
});

test('reset inflections strip too ([Reset], [ reset ])', () => {
  const out = seedFishSteering('[gentle] A first line that is long enough to be seeded properly.\n\n[Reset] And back to me.');
  assert.ok(!/\[\s*reset\s*\]/i.test(out));
});
