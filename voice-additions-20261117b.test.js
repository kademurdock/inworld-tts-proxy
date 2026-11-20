'use strict';
/* Nov 17 2026, later the same day - Kade: "add the most recent voices from inworld into my platform"
 * Voices 788-800 are the 13 new non-personal workspace voices (her Kade and Amber clones, Pro amber
 * reading and Podcast Keighty fast stay off, and so do Dale and Sky, taken off on Jun 26). They are
 * described by ear like every Inworld voice, filed in a section, and their workspace names are never a
 * way to reach them. */
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
const FIRST = 788;
const NEW = ["sakayah", "emmsley", "zesty", "shacooka", "musa", "samalanio", "nadeesia", "babaline", "looley", "zizza", "vexie", "deedee", "linnie"];
const WORKSPACE_NAMES = ["Sakayah", "Emmsley", "Zesty", "Shacooka", "Musa", "Samalanio", "Nadeesia", "Babaline", "Looley", "Zizza", "Vexie", "DeeDee", "Linnie", "Dale", "Sky"];

test('Voices 788-800 speak as the new workspace voices, described and filed', () => {
  assert.equal(NEW.length, 13);
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
  assert.equal(r.VOICE_MAP[`Voice ${FIRST + NEW.length}`], 'default-e-m11vgtr9l-m7afw4kmnw__soyer', 'the Nov 19 batch starts right after');
  assert.ok(!r.VOICE_PICKER_CATEGORIES.some((c) => c.name === 'Not yet described'), 'every picker voice is described');
});

test('the workspace names are not served as voice names, and the hold-outs stay off', () => {
  for (const name of WORKSPACE_NAMES) assert.equal(r.VOICE_MAP[name], undefined, name);
  for (const short of ['dale', 'sky', 'kade', 'podcast_keighty_fast', 'kade_southern', 'kade_commercial', 'kade_casually_talking', 'amber_pro_clone', 'amber_conversational', 'pro_amber_reading', 'amber_canded', 'kade_commercial_vo']) {
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
