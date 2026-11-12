'use strict';
/* Nov 11 2026 - Kade: "add the new voices I just made today from inworld to my platform. Several voices."
 * Voices 672-757 are the 86 new non-personal workspace voices (her Kade and Amber clones and Podcast
 * Keighty fast stay off, and so do Dale and Sky, taken off on Jun 26). They are described by ear like every
 * Inworld voice, filed in a section, and their workspace names are never a way to reach them. */
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
const FIRST = 672;
const NEW = ["aaron", "arinia", "arsea", "austin", "bobby", "brendai", "brittney", "bryant", "butterscotch", "cana", "carney", "chaienne", "charly", "chocola", "clemmadee", "codya", "cosh", "darson", "feefer", "forrene", "frogley", "garlah", "goji", "hank", "java", "karreesse", "keese", "keesh", "kessie", "kinna", "kirk", "kobie", "maggoolah", "maikin", "marceene", "marksy", "marnique", "marsia", "martene", "marthaleea", "maylene", "megina", "mina_may", "myanne", "naimaoro", "nairro", "naithannos", "nasheen", "neea", "needalay", "nervera", "nezzy", "nova", "olathah", "pansy", "panthos", "pavous", "poppy", "posey", "radio_dude", "rayly", "revvy", "rocky", "saina", "salara", "sanaray", "sanettah", "sartruca", "shan", "shassy", "shawnsy", "sofia", "swarmsley", "tamika", "tansinite", "tarka", "teesia", "thanial", "threeni", "tierrah", "tiffany", "toshley", "treese", "tuniea", "willo", "ziria"];
const WORKSPACE_NAMES = ["Aaron", "Arinia", "Arsea", "Austin", "Bobby", "Brendai", "Brittney", "Bryant", "Butterscotch", "Cana", "Carney", "Chaienne", "Charly", "Chocola", "Clemmadee", "Codya", "Cosh", "Dale", "Darson", "Feefer", "Forrene", "Frogley", "Garlah", "Goji", "Hank", "Java", "Karreesse", "Keese", "Keesh", "Kessie", "Kinna", "Kirk", "Kobie", "Maggoolah", "Maikin", "Marceene", "Marksy", "Marnique", "Marsia", "Martene", "Marthaleea", "Maylene", "Megina", "Mina may", "Myanne", "Naimaoro", "Nairro", "Naithannos", "Nasheen", "Neea", "Needalay", "Nervera", "Nezzy", "Nova", "Olathah", "Pansy", "Panthos", "Pavous", "Poppy", "Posey", "Radio dude", "Rayly", "Revvy", "Rocky", "Saina", "Salara", "Sanaray", "Sanettah", "Sartruca", "Shan", "Shassy", "Shawnsy", "Sky", "Sofia", "Swarmsley", "Tamika", "Tansinite", "Tarka", "Teesia", "Thanial", "Threeni", "Tierrah", "Tiffany", "Toshley", "Treese", "Tuniea", "Willo", "Ziria", "aaron", "arinia", "sartruca", "tansinite", "tarka", "toshley"];

test('Voices 672-757 speak as the new workspace voices, described and filed', () => {
  assert.equal(NEW.length, 86);
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
  for (const short of ['dale', 'sky', 'podcast_keighty_fast', 'amber_brit', 'kade_southern']) {
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
