'use strict';
/* Oct 16 2026 — Kade: voices are like hair, customisable, not people, but their names must
 * stick in memory. The Oct 14-15 catalog used human names ("Adam West", "Holly Hawkins");
 * every voice now has a two-word non-person name, and every name a voice ever had still
 * resolves to the same voice (saved picks, listener reports and old spellings). */
const test=require('node:test');
const assert=require('node:assert/strict');
const rows=require('./selected-voices.json').voices;
const ledger=require('./test-fixtures/voice-name-ledger.json').rows;
const pools=require('./test-fixtures/person-name-pools.json');
const {selectedPicker,installSelectedBindings}=require('./private-voice-references');

const KEPT=new Map([['ref_bf1767b03e81b7b7','Miss-A (Amber A)'],['ref_98888fc96b2b118f','Kadiana (Expressive)'],
 ['ref_766d05487fa1b67b','Kade (HQ)'],['ref_8418a845902d058e','Coco'],['ref_a741b980a2fcc56f','Snoley'],['ref_ae16039c7842cf19','Manayah']]);
const legacy={voices:[],hidden:[],aliases:[],map:{},renames:{},describe:{},tags:{}};

test('personal and file-named voices keep their names',()=>{
 for(const [id,label] of KEPT){const row=rows.find(r=>r.id===id);assert.equal(row.label,label);}
});

test('every renamed voice has a memorable two-word name that is nobody\'s name',()=>{
 const first=new Set(pools.first.map(n=>n.toLowerCase()));
 const surnames=new Set(pools.surnames.map(n=>n.toLowerCase()));
 for(const row of rows){
  if(KEPT.has(row.id))continue;
  assert.match(row.label,/^[A-Z][A-Za-z]*(-[A-Za-z]+)* [A-Z][A-Za-z]*(-[A-Za-z]+)*$/,row.label);
  assert.equal(row.tag,row.label);
  const [a,b]=row.label.toLowerCase().split(' ');
  assert.ok(!(first.has(a)&&surnames.has(b)),`${row.label} reads like a person's name`);
  assert.ok(!/\b(woman|man|girl|boy|lady|guy|male|female|voice)\b/i.test(row.label),row.label);
 }
});

test('every name a voice has ever had still reaches the same recording',()=>{
 const map={},auditions=new Map();
 installSelectedBindings(rows,map,auditions);
 const picker=selectedPicker(rows,legacy);
 let checked=0;
 for(const {id,names} of ledger){
  const row=rows.find(r=>r.id===id);
  assert.ok(row,`voice ${id} still exists`);
  for(const name of names){
   assert.equal(map[name],'fish:'+id,`${name} still speaks with ${id}`);
   if(name!==row.label){
    assert.ok(picker.hidden.includes(name),`${name} stays a hidden, valid saved name`);
    assert.equal(picker.renames[name],row.label,`${name} is shown as ${row.label}`);
   }
   checked++;
  }
 }
 assert.ok(checked>=1121+3*598,`checked ${checked} names`);
});

test('retired names are not served as name-match aliases',()=>{
 const picker=selectedPicker(rows,legacy);
 const served=new Set(picker.aliases);
 for(const {names} of ledger.slice(0,40))for(const name of names.slice(1))assert.ok(!served.has(name)||name.startsWith('fish:'),name);
 for(const row of rows)assert.ok(served.has('fish:'+row.id));
});
