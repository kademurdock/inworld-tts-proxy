'use strict';
/* Part 117.1 (Sep 2 2026): one paragraph per fish request. Measured on two of
 * her clones: one long request with three tags and (long-break)s hallucinated
 * 3 of 12 takes (one 44 s for 20 s of words, one "Ma. Ma. Ma." at a break);
 * one request per paragraph, 0 of 12. See the comment above splitFishParagraphs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, 'missing ' + startMarker);
  const b = src.indexOf(endMarker, a);
  return src.slice(a, b + endMarker.length);
}
const code = [
  'const process = { env: {} };',
  grab('const FISH_ONE_REQUEST', ';'),
  grab('function splitFishParagraphs', '\n}'),
  'return splitFishParagraphs;',
].join('\n');
const splitFishParagraphs = new Function(code)();

test('a seeded three-paragraph chunk becomes three requests, no break token inside any of them', () => {
  const out = splitFishParagraphs('[skeptical] So the guy came out. (long-break) [dry] I was not rude. (long-break) [practical] Two more quotes.');
  assert.deepEqual(out, ['[skeptical] So the guy came out.', '[dry] I was not rude.', '[practical] Two more quotes.']);
  for (const p of out) assert.ok(!p.includes('(long-break)'));
});

test('a blank-line paragraph break splits too, and a single paragraph passes through untouched', () => {
  assert.deepEqual(splitFishParagraphs('[warm] One.\n\n[reset] Two.'), ['[warm] One.', '[reset] Two.']);
  assert.deepEqual(splitFishParagraphs('[warm] Just the one paragraph here.'), ['[warm] Just the one paragraph here.']);
});

test('both fish call sites split after seeding (audition/chat funnel and the scene lane)', () => {
  const hits = src.match(/\.map\(seedFishSteering\)\.flatMap\(splitFishParagraphs\)/g) || [];
  assert.equal(hits.length, 2, 'both fish lanes split per paragraph');
});
