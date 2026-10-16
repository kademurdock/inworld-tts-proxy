'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { SCENES, POOLS, audienceFor, pickScene, createScenePicker } = require('./audition-scenes');

test('all published voices route by their actual catalog group, including binding aliases', () => {
  const rows = require('./selected-voices.json').voices;
  assert.equal(rows.length,1121);
  for (const label of ['Miss-A (Amber A)', 'Kadiana (Expressive)', 'Kade (HQ)']) {
    const row = rows.find(value => value.label === label);
    assert.ok(row, `Missing family voice: ${label}`);
    assert.ok(row.categories.every(category => category.startsWith('Women, ')));
    assert.equal(audienceFor(row.categories), 'adults');
  }
  for (const row of rows) {
    const expected = row.categories.some(c => c.startsWith('Kids and teens,')) ? 'kids'
      : row.categories.some(c => c.startsWith('Characters,')) ? 'characters' : 'adults';
    assert.equal(audienceFor(row.categories), expected);
    for (const quick of [false,true]) assert.ok(POOLS[expected][quick?'quick':'long'].includes(pickScene(row,quick)));
  }
  assert.equal(audienceFor(['Characters, Clear & Neutral','Kids and teens, Bright & Lively']),'kids');
  assert.equal(audienceFor(undefined),'kids');
});
test('6000 scripts cover 3000 original scenes, evenly split by audience and use', () => {
  assert.equal(SCENES.length,3000);
  assert.equal(new Set(SCENES.map(s=>s[3])).size,3000);
  assert.equal(new Set(SCENES.map(s=>s[4])).size,3000);
  for (const audience of Object.keys(POOLS)) {
    assert.equal(SCENES.filter(s=>s[0]===audience&&s[1]==='conversation').length,500);
    assert.equal(SCENES.filter(s=>s[0]===audience&&s[1]==='book').length,500);
    assert.equal(new Set(POOLS[audience].long).size,1000);
    assert.equal(new Set(POOLS[audience].quick).size,1000);
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
  const pickScene = createScenePicker();
  for (const audience of Object.keys(POOLS)) {
    const row={id:'test-'+audience,categories:[audience==='kids'?'Kids and teens, Test':audience==='characters'?'Characters, Test':'Women, Test']};
    for (const quick of [false,true]) {
      let prior; const seen=new Set();
      for (let i=0;i<160;i++) { const current=pickScene(row,quick,()=>((i*7)%15)/15);assert.notEqual(current,prior);seen.add(current);prior=current; }
      assert.ok(seen.size>=12);
    }
  }
});

test('browsing different voices exhausts a whole category before any repeat', () => {
  for (const random of [()=>0, ()=>0.999999, Math.random]) {
    const pick = createScenePicker();
    for (const audience of Object.keys(POOLS)) {
      const categories = [audience === 'kids' ? 'Kids and teens' : audience === 'characters' ? 'Characters' : 'Men'];
      for (const quick of [false, true]) {
        let previous;
        for (let cycle = 0; cycle < 3; cycle++) {
          const seen = new Set();
          for (let i = 0; i < 1000; i++) {
            const current = pick({ id: `voice-${i}`, categories }, quick, random);
            assert.notEqual(current, previous, 'including the cycle boundary');
            assert.ok(!seen.has(current), 'no repeats inside a category cycle');
            seen.add(current);
            previous = current;
          }
          assert.deepEqual(seen, new Set(POOLS[audience][quick ? 'quick' : 'long']));
        }
      }
    }
  }
});

test('category and preview-length rotations remain independent when interleaved', () => {
  const pick = createScenePicker();
  const seen = new Map();
  for (let i = 0; i < 1000; i++) {
    for (const [audience, category] of [['kids','Kids and teens'],['characters','Characters'],['adults','Women']]) {
      for (const quick of [false,true]) {
        const key = `${audience}:${quick}`;
        const values = seen.get(key) || new Set();
        const current = pick({id:'same-id', categories:[category]},quick,()=>0.25);
        assert.ok(!values.has(current));
        values.add(current);
        seen.set(key,values);
      }
    }
  }
  for (const values of seen.values()) assert.equal(values.size,1000);
});
test('every existing preview sentinel passes its voice into selection; normal speech is untouched',()=>{
  const code=fs.readFileSync(require.resolve('./server'),'utf8');
  assert.equal((code.match(/pickAudition\(AUDITION_SCRIPTS, voice\)/g)||[]).length,2);
  assert.equal((code.match(/pickAudition\(AUDITION_QUICK_LINES, voice\)/g)||[]).length,1);
  assert.match(code,/installSelectedBindings\(rows, VOICE_MAP, selectedAuditionVoices\)/);
});
