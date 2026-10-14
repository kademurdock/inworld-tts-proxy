const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { carryDrama3Scopes } = require('./speech-prosody');
test('paired Drama3 delivery ends at its words, including nested scopes across requests', () => {
  assert.deepEqual(carryDrama3Scopes(['[warmly] <soft>First thought.', '<emphasis>Second', 'word</emphasis> ends.</soft> Normal now.']),
    ['[warmly] <soft>First thought.</soft>', '<soft><emphasis>Second</emphasis></soft>', '<soft><emphasis>word</emphasis> ends.</soft> Normal now.']);
  assert.deepEqual(carryDrama3Scopes(['Hello.', '[laugh] More words.']), ['Hello.', '[laugh] More words.']);
});
test('the real sentence splitter retains words ending in paired tags', () => {
  const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
  const ctx = {};
  vm.runInNewContext(source.slice(source.indexOf('const SENTENCE_ABBREVIATIONS ='), source.indexOf('// Groups whole sentences')) + '\nthis.split = splitSentences;', ctx);
  const text = '<soft>Come back!</soft> I found it. <whisper><stress>Stay here?</stress></whisper> Yes.';
  assert.equal(ctx.split(text).join(' '), text);
});
