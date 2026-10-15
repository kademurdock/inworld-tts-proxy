'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { carryDrama3Scopes } = require('./speech-prosody');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const start = src.indexOf('const FISH_EMPHASIS_STOPLIST =');
const end = src.indexOf('// Short interjections', start);
function load(model) {
  const c = { FISH_TTS_MODEL: model };
  vm.runInNewContext(src.slice(start, end) + '\nthis.emphasis = fishEmphasisFromCaps;', c);
  return c.emphasis;
}
test('Drama3 scopes ordinary stressed words, retaining the exact spoken words and punctuation', () => {
  const f = load('drama-3');
  assert.equal(f('I REALLY meant THAT, not this.'), 'I <emphasis>REALLY</emphasis> meant <emphasis>THAT</emphasis>, not this.');
  assert.equal(f('REALLY? YES!'), '<emphasis>REALLY</emphasis>? <emphasis>YES</emphasis>!');
});
test('actor directions, acronyms and existing scoped emphasis never acquire extra stress tags', () => {
  const f = load('drama-3');
  const input = '[KEEP THIS DIRECTION] NASA sent a PDF. <emphasis>I REALLY meant THAT</emphasis> <stress>NOT THIS</stress>';
  assert.equal(f(input), input);
  assert.equal(f('[emphasis] REALLY matters. NEXT word.'), '[emphasis] REALLY matters. NEXT word.');
});
test('soft and fast scopes can enclose a stressed word, and closing stress resumes ordinary conversion', () => {
  const f = load('drama-3');
  assert.equal(f('<soft><fast>REALLY now</fast></soft> <stress>YES</stress> THEN.'),
    '<soft><fast><emphasis>REALLY</emphasis> now</fast></soft> <stress>YES</stress> <emphasis>THEN</emphasis>.');
});
test('artificial request boundaries close and reopen an emphasized phrase without losing words', () => {
  const f = load('drama-3');
  const pieces = carryDrama3Scopes([f('<emphasis>One REALLY important'), f('word</emphasis> and NEXT.')]);
  assert.deepEqual(pieces, ['<emphasis>One REALLY important</emphasis>', '<emphasis>word</emphasis> and <emphasis>NEXT</emphasis>.']);
});
test('explicit S2 rollback retains its original prefix syntax; Drama3 preview uses paired syntax', () => {
  assert.equal(load('s2.1-pro')('I REALLY meant THAT.'), 'I [emphasis] REALLY meant [emphasis] THAT.');
  assert.equal(load('drama-3-preview')('REALLY.'), '<emphasis>REALLY</emphasis>.');
});
