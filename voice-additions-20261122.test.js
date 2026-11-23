'use strict';
/* Nov 22 2026 - Kade: "I have a few new inworld voices for you to add to the platform." Voices 812-829 are the 18
 * new workspace voices since Nov 19, described by ear and filed. Workspace names are never a way to reach a voice. */
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
const FIRST = 812;
const NEW = ["barkley", "ellias", "patty", "ennzia", "zana", "aubrey", "zenzy", "nezia", "elia", "lomez", "clari", "etzie", "justin", "vanoussa", "china", "novo", "peddle", "elry"];
const WORKSPACE_NAMES = ["Barkley", "Ellias", "Patty", "Ennzia", "Zana", "aubrey", "Zenzy", "Nezia", "Elia", "Lomez", "Clari", "Etzie", "Justin", "Vanoussa", "China", "Novo", "Peddle", "Elry"];

test('Voices 812-829 speak as the new workspace voices, described and filed', () => {
  assert.equal(NEW.length, 18);
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
});

test('the workspace names are not served as voice names', () => {
  for (const name of WORKSPACE_NAMES) assert.equal(r.VOICE_MAP[name], undefined, name);
});

test('the new tag words are nobody\'s name', () => {
  const names = new Set([...pools.first, ...pools.surnames].map((n) => n.toLowerCase()));
  NEW.forEach((_, i) => assert.ok(!names.has(catalog.voices[`Voice ${FIRST + i}`].tag), `Voice ${FIRST + i}`));
});
