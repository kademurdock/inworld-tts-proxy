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
test('a stressed contraction or possessive is one word: the scope never closes inside it (finding 24)', () => {
  const f = load('drama-3');
  assert.equal(f("I DON'T want that."), "I <emphasis>DON'T</emphasis> want that.");
  assert.equal(f("You CAN'T be serious."), "You <emphasis>CAN'T</emphasis> be serious.");
  assert.equal(f("YOU'RE kidding."), "<emphasis>YOU'RE</emphasis> kidding.");
  assert.equal(f("That's KADE'S chair."), "That's <emphasis>KADE'S</emphasis> chair.");
  assert.equal(f("That's KADE's chair."), "That's <emphasis>KADE's</emphasis> chair.");
  assert.equal(f("It WASN'T me, and THEY'VE gone."), "It <emphasis>WASN'T</emphasis> me, and <emphasis>THEY'VE</emphasis> gone.");
  assert.equal(f('I DON’T care.'), 'I <emphasis>DON’T</emphasis> care.');
  assert.equal(f("Y'ALL came, and I'm GOIN' home."), "<emphasis>Y'ALL</emphasis> came, and I'm <emphasis>GOIN'</emphasis> home.");
  // A quoted word keeps its quotes outside the scope; a short contraction is never cut.
  assert.equal(f("She said 'REALLY' twice."), "She said '<emphasis>REALLY</emphasis>' twice.");
  assert.equal(f("I'M here, I'LL stay."), "I'M here, I'LL stay.");
  // Acronyms with a possessive are still acronyms.
  assert.equal(f("NASA'S launch."), "NASA'S launch.");
  // No stressed word is ever split anywhere in the output.
  for (const input of ["DON'T", "CAN'T", "YOU'RE", "KADE'S", "WASN'T", 'DON’T']) {
    assert.doesNotMatch(f(`Well ${input} now.`), /<\/emphasis>['’]/);
  }
  // The S2 rollback keeps the word whole too.
  assert.equal(load('s2.1-pro')("I DON'T want that."), "I [emphasis] DON'T want that.");
});
test('a quote closing after a stressed word stays outside the scope; elisions, ellipses and double contractions stay whole', () => {
  const f = load('drama-3');
  // The closing quote of a single-quoted phrase is not part of the word.
  assert.equal(f("'I said NEVER'"), "'I said <emphasis>NEVER</emphasis>'");
  assert.equal(f('‘I said NEVER’'), '‘I said <emphasis>NEVER</emphasis>’');
  assert.equal(f("He said 'I DON'T' and left."), "He said 'I <emphasis>DON'T</emphasis>' and left.");
  assert.equal(f("'Get 'em NOW', she said."), "'Get 'em <emphasis>NOW</emphasis>', she said.");
  // An elision inside a quote whose closing mark comes later keeps its apostrophe.
  assert.equal(f("'We're GOIN' home,' she said."), "'We're <emphasis>GOIN'</emphasis> home,' she said.");
  assert.equal(f("'Fine,' she said, GOIN' home."), "'Fine,' she said, <emphasis>GOIN'</emphasis> home.");
  // An ellipsis character ends (or starts) a stressed word.
  assert.equal(f("I DON'T… know."), "I <emphasis>DON'T</emphasis>… know.");
  assert.equal(f('NEVER… ever. Well…NEVER mind.'), '<emphasis>NEVER</emphasis>… ever. Well…<emphasis>NEVER</emphasis> mind.');
  // Double contractions are one word.
  assert.equal(f("You SHOULDN'T'VE done that."), "You <emphasis>SHOULDN'T'VE</emphasis> done that.");
  assert.equal(f("THEY'D'VE come."), "<emphasis>THEY'D'VE</emphasis> come.");
  assert.equal(f("I love ROCK'N'ROLL'S sound."), "I love <emphasis>ROCK'N'ROLL'S</emphasis> sound.");
  // Never a changed word, and a long apostrophe chain is not a word and stays fast.
  for (const input of ["'I said NEVER'", "You SHOULDN'T'VE done that.", "I DON'T… know."]) {
    assert.equal(f(input).replace(/<\/?emphasis>/g, ''), input);
  }
  const chain = 'ABC' + "'AB".repeat(5000) + 'x';
  const started = Date.now();
  assert.equal(f(chain), chain);
  assert.ok(Date.now() - started < 1000);
});
test('explicit S2 rollback retains its original prefix syntax; Drama3 preview uses paired syntax', () => {
  assert.equal(load('s2.1-pro')('I REALLY meant THAT.'), 'I [emphasis] REALLY meant [emphasis] THAT.');
  assert.equal(load('drama-3-preview')('REALLY.'), '<emphasis>REALLY</emphasis>.');
});
