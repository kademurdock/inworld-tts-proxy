'use strict';
/* Oct 29 2026 — Kade: "I added a few new inworld voices you can add to my platform." Voices 665-671
 * are the seven new non-personal workspace voices (Dale and Sky are on the workspace too, but she
 * took those off the platform on Jun 26). They are described by ear like every Inworld voice,
 * filed in a section, and their workspace names (person-like) are never a way to reach them. */
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
const NEW = ['darain', 'maikolo', 'malra', 'martellah', 'secoyah', 'shabellvia', 'vanarrolane'];

test('Voices 665-671 speak as the seven new workspace voices, described and filed', () => {
  NEW.forEach((short, i) => {
    const num = `Voice ${665 + i}`;
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

test('the workspace names are not served as voice names, and Dale and Sky stay off', () => {
  for (const name of ['Darain', 'Maikolo', 'malra', 'Malra', 'Martellah', 'Secoyah', 'Shabellvia', 'Vanarrolane', 'Dale', 'Sky']) {
    assert.equal(r.VOICE_MAP[name], undefined, name);
  }
  for (const short of ['dale', 'sky']) assert.ok(!Object.values(r.VOICE_MAP).includes(WS + short), short);
});

test('the new tag words are nobody\'s name, and tags and labels stay unique', () => {
  const names = new Set([...pools.first, ...pools.surnames].map((n) => n.toLowerCase()));
  NEW.forEach((_, i) => assert.ok(!names.has(catalog.voices[`Voice ${665 + i}`].tag), `Voice ${665 + i}`));
  const labels = Object.values(catalog.voices).map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length);
  const tags = Object.values(catalog.voices).map((v) => v.tag).filter(Boolean);
  assert.equal(new Set(tags).size, tags.length);
});
