'use strict';
/* Nov 19 2026 - Kade: "I also have some new voices on inworld to add to the platform, and miss-a and Kade my
 * professional voices need to be replaced by the new professional voices." Voices 801-811 are the 11 new
 * non-personal workspace voices. Miss-A (653) and Kade (664) keep their labels and now speak as her new
 * clones; any raw old id saved somewhere follows them. Workspace names are never a way to reach a voice. */
const fs = require('node:fs'), vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const definitions = source.slice(source.indexOf('const OPENAI_ALIAS_MAP ='), source.indexOf('const MODEL_MAP ='));
const picker = source.slice(source.indexOf('const VOICE_LIST ='), source.indexOf('const SAMPLE_TEXT ='));
const ctx = { FISH_VOICE_PREFIX: 'fish:', process: { env: {} }, console: { log() {}, warn() {} }, require: (p) => require(p) };
vm.runInNewContext(definitions + '\n' + picker + '\nthis.result={VOICE_MAP,VOICE_LIST,VOICE_PICKER_CATEGORIES,VOICE_RENAMES,VOICE_DESCRIBE};', ctx);
const r = ctx.result;
const catalog = require('./voice-catalog-v2.json');
const pools = require('./test-fixtures/person-name-pools.json');
const WS = 'default-e-m11vgtr9l-m7afw4kmnw__';
const FIRST = 801;
const NEW = ["soyer", "salacka", "milio", "namaro", "sanso", "slervie", "sansanita", "sadaysa", "scavards", "sansa", "silverbell"];
const WORKSPACE_NAMES = ["Soyer", "Salacka", "milio", "namaro", "Sanso", "SLERVIE", "Sansanita", "sadaysa", "Scavards", "Sansa", "silverbell", "Me from eleven", "Dale", "Sky"];

test('Voices 801-811 speak as the new workspace voices, described and filed', () => {
  assert.equal(NEW.length, 11);
  NEW.forEach((short, i) => {
    const num = `Voice ${FIRST + i}`;
    assert.equal(r.VOICE_MAP[num], WS + short, num);
    const label = r.VOICE_RENAMES[num];
    assert.equal(label, catalog.voices[num].label, `${num} shows its described label`);
    assert.equal(r.VOICE_MAP[label], WS + short);
    assert.ok(r.VOICE_DESCRIBE[label], `${label} has a description`);
    assert.equal(r.VOICE_LIST.filter((v) => v === label).length, 1);
    const sections = r.VOICE_PICKER_CATEGORIES.filter((c) => c.voices.includes(label)).map((c) => c.name);
    assert.deepEqual(Array.from(sections), [catalog.voices[num].category], `${label} sits in one section`);
  });
  assert.equal(r.VOICE_MAP[`Voice ${FIRST + NEW.length}`], undefined, 'nothing past the batch');
  assert.ok(!r.VOICE_PICKER_CATEGORIES.some((c) => c.name === 'Not yet described'), 'every picker voice is described');
});

test('the workspace names are not served as voice names, and the hold-outs stay off', () => {
  for (const name of WORKSPACE_NAMES) assert.equal(r.VOICE_MAP[name], undefined, name);
  for (const short of ['dale', 'sky', 'podcast_keighty_fast', 'kade_southern', 'kade_commercial', 'kade_casually_talking', 'amber_pro_clone', 'amber_conversational', 'pro_amber_reading', 'kade_commercial_vo']) {
    assert.ok(!Object.values(r.VOICE_MAP).includes(WS + short), short);
  }
});

test('the new tag words are nobody\'s name, and tags and labels stay unique', () => {
  const names = new Set([...pools.first, ...pools.surnames].map((n) => n.toLowerCase()));
  NEW.forEach((_, i) => assert.ok(!names.has(catalog.voices[`Voice ${FIRST + i}`].tag), `Voice ${FIRST + i}`));
  const labels = Object.values(catalog.voices).map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length);
  const tags = Object.values(catalog.voices).map((v) => v.tag).filter(Boolean);
  assert.equal(new Set(tags).size, tags.length);
});

test('Miss-A and Kade speak as her new clones, and the old ids follow them', () => {
  assert.equal(r.VOICE_MAP['Voice 653'], WS + 'miss-a');
  assert.equal(r.VOICE_MAP['Miss-A'], WS + 'miss-a');
  assert.equal(r.VOICE_MAP[WS + 'miss_a'], WS + 'miss-a');
  assert.equal(r.VOICE_MAP['Voice 664'], WS + 'me_from_eleven');
  assert.equal(r.VOICE_MAP['Kade'], WS + 'me_from_eleven');
  assert.equal(r.VOICE_MAP[WS + 'kade_murdock'], WS + 'me_from_eleven');
  assert.ok(!Object.entries(r.VOICE_MAP).some(([k, t]) => t === WS + 'kade_murdock' || t === WS + 'miss_a'), 'nothing still points at a retired id');
});
