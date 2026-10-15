'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { classicPicker } = require('./classic');
const { selectedPicker, installSelectedBindings } = require('./private-voice-references');
const { fishPacedText, fishPace } = require('./pace');

test('restores every registered legacy Inworld row without touching any saved binding or selected Fish row', () => {
  const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
  const ctx = { FISH_VOICE_PREFIX: 'fish:', process: { env: {} }, console: { log() {}, warn() {} }, require };
  vm.runInNewContext(source.slice(source.indexOf('const OPENAI_ALIAS_MAP ='), source.indexOf('const MODEL_MAP =')) + '\n' +
    source.slice(source.indexOf('const VOICE_LIST ='), source.indexOf('const SAMPLE_TEXT =')) +
    '\nthis.legacy={voices:VOICE_LIST,map:VOICE_MAP,hidden:HIDDEN_VOICE_ALIASES,aliases:Object.keys(CUSTOM_VOICE_MAP),renames:VOICE_RENAMES,describe:VOICE_DESCRIBE,tags:VOICE_TAGS,categories:VOICE_PICKER_CATEGORIES};', ctx);
  const legacy = ctx.legacy;
  const before = { ...legacy.map };
  const rows = require('./selected-voices.json').voices;
  const selected = selectedPicker(rows, legacy);
  const { picker, bindings } = classicPicker(selected, legacy);
  assert.deepEqual(picker.voices.slice(0, rows.length), rows.map(r => r.label));
  assert.deepEqual(picker.fish, selected.fish);
  const expected = legacy.voices.filter(label => !legacy.map[label].startsWith('fish:'));
  assert.equal(bindings.size, expected.length);
  assert.ok(bindings.size > 300);
  for (const old of expected) {
    const label = old + ' (Classic)';
    assert.equal(bindings.get(label), before[old]);
    assert.equal(picker.providers[label], 'inworld');
    assert.match(picker.tags[label], /Classic/);
    assert.ok(picker.categories.some(c => c.voices.includes(label)));
  }
  for (const [label, target] of bindings) legacy.map[label] = target;
  installSelectedBindings(rows, legacy.map, new Map());
  for (const [label, target] of Object.entries(before)) assert.equal(legacy.map[label], target, label);
  assert.equal(picker.fish.length, 601);
  console.log(`${bindings.size} Classic entries, ${new Set(bindings.values()).size} distinct Inworld IDs; 601 Fish entries preserved.`);
});

test('Fish pace is an instruction and preserves emotion, paired word scopes, and spoken words', () => {
  const text = '[warm and amused] I <emphasis>really</emphasis> mean <whisper>this</whisper>.';
  assert.equal(fishPacedText(text, 1), text);
  assert.equal(fishPacedText(text, undefined), text);
  for (const rate of [0.5, 0.75, 0.9, 1.2, 1.25, 1.5, 2]) {
    assert.ok(fishPacedText(text, rate).endsWith(text));
    assert.equal(fishPace(rate).value > 1, rate > 1);
  }
  assert.match(fishPacedText(text, 1.2), /^\[Speak briskly/);
});
