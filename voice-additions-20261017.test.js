'use strict';
/* Oct 17 2026 — Kade: "I also added some new inworld voices today that you can add to the server.
 * Just the most recent ones." Voices 654-663 are the ten new non-personal workspace voices. They are
 * described by ear like every Inworld voice, filed in a section, and their workspace names
 * (person-like) are never a way to reach them. */
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
const WS = 'default-e-m11vgtr9l-m7afw4kmnw__';
const NEW = ['craigia', 'dennesha', 'holisha', 'janique', 'karakano', 'karika', 'marklisha', 'niki', 'shavailah', 'shiara'];

test('Voices 654-663 speak as the ten new workspace voices, described and filed', () => {
  NEW.forEach((short, i) => {
    const num = `Voice ${654 + i}`;
    assert.equal(r.VOICE_MAP[num], WS + short, num);
    const label = r.VOICE_RENAMES[num];
    assert.equal(label, catalog.voices[num].label, `${num} shows its described label`);
    assert.equal(r.VOICE_MAP[label], WS + short);
    assert.ok(r.VOICE_DESCRIBE[label], `${label} has a description`);
    assert.equal(r.VOICE_LIST.filter((v) => v === label).length, 1);
    const sections = r.VOICE_PICKER_CATEGORIES.filter((c) => c.voices.includes(label)).map((c) => c.name);
    assert.deepEqual(Array.from(sections), [catalog.voices[num].category], `${label} sits in one section`);
  });
  assert.ok(!r.VOICE_PICKER_CATEGORIES.some((c) => c.name === 'Not yet described'), 'every picker voice is described');
});

test('the workspace names are not served as voice names', () => {
  for (const name of ['Craigia', 'Dennesha', 'Holisha', 'janique', 'Janique', 'Karakano', 'Karika', 'Marklisha', 'Niki', 'Shavailah', 'Shiara']) {
    assert.equal(r.VOICE_MAP[name], undefined, name);
  }
});

test('tag words are new and the labels unique', () => {
  const labels = Object.values(catalog.voices).map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length);
  const tags = Object.values(catalog.voices).map((v) => v.tag).filter(Boolean);
  assert.equal(new Set(tags).size, tags.length);
});
