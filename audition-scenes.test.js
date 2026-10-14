'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { SCENES, POOLS, audienceFor, pickScene } = require('./audition-scenes');

test('all published voices route by their actual catalog group, including binding aliases', () => {
  const rows = require('./selected-voices.json').voices;
  assert.equal(rows.length,598);
  for (const row of rows) {
    const expected = row.categories.some(c => c.startsWith('Kids and teens,')) ? 'kids'
      : row.categories.some(c => c.startsWith('Characters,')) ? 'characters' : 'adults';
    assert.equal(audienceFor(row.categories), expected);
    for (const quick of [false,true]) assert.ok(POOLS[expected][quick?'quick':'long'].includes(pickScene(row,quick)));
  }
  assert.equal(audienceFor(['Characters, Clear & Neutral','Kids and teens, Bright & Lively']),'kids');
  assert.equal(audienceFor(undefined),'kids');
});
test('each group has sixteen distinct new monologues and previews with conversation and book coverage', () => {
  assert.equal(SCENES.length,48);
  for (const audience of Object.keys(POOLS)) {
    assert.equal(SCENES.filter(s=>s[0]===audience&&s[1]==='conversation').length,8);
    assert.equal(SCENES.filter(s=>s[0]===audience&&s[1]==='book').length,8);
    assert.equal(new Set(POOLS[audience].long).size,16);
    assert.equal(new Set(POOLS[audience].quick).size,16);
  }
  for (const [audience,kind,feeling,long,quick] of SCENES) {
    assert.match(feeling,/^[a-z ]+$/);
    assert.ok((long.match(/[.!?]/g)||[]).length>=3);
    assert.ok(long.length<440);
    assert.ok(`%%%${feeling}%%% ${quick}`.length<=160);
    assert.doesNotMatch(long+quick,/%%%|\{voice\}|—|\b(?:leverage|delve|journey|synergy|as an ai|pick me|you've got this)\b/i);
    if (audience==='kids') assert.doesNotMatch(long+quick,/\b(?:mortgage|boss|rent|dating|hangover|whiskey|wine|sex)\b/i);
  }
});
test('random picks vary without immediate repeats for each voice and preview length', () => {
  for (const audience of Object.keys(POOLS)) {
    const row={id:'test-'+audience,categories:[audience==='kids'?'Kids and teens, Test':audience==='characters'?'Characters, Test':'Women, Test']};
    for (const quick of [false,true]) {
      let prior; const seen=new Set();
      for (let i=0;i<160;i++) { const current=pickScene(row,quick,()=>((i*7)%15)/15);assert.notEqual(current,prior);seen.add(current);prior=current; }
      assert.ok(seen.size>=12);
    }
  }
});
test('every existing preview sentinel passes its voice into selection; normal speech is untouched',()=>{
  const code=fs.readFileSync(require.resolve('./server'),'utf8');
  assert.equal((code.match(/pickAudition\(AUDITION_SCRIPTS, voice\)/g)||[]).length,2);
  assert.equal((code.match(/pickAudition\(AUDITION_QUICK_LINES, voice\)/g)||[]).length,1);
  assert.match(code,/selectedAuditionVoices\.set\(row\.label, row\)/);
  assert.match(code,/selectedAuditionVoices\.set\(binding, row\)/);
});
