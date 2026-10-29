'use strict';
/* Oct 29 2026 — Kade: "go into icloud/computer downloads and make platform fish voices out of all
 * the speech named recordings that were made in the last 48 hours." speech(5).mp3 to speech(49).mp3
 * became 45 drama-3 voices appended after the 1,121 existing rows. Each was described and its words
 * written down by MiMo listening, previewed once through Fish drama-3 and word-checked. Like every
 * voice since Oct 16 they carry two-word names that are nobody's name. */
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const rows=require('./selected-voices.json').voices;
const pools=require('./test-fixtures/person-name-pools.json');
const {selectedPicker,installSelectedBindings}=require('./private-voice-references');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const IDENTITY=['id','sha256','metadataSha256','referenceKey','metadataKey','testedModel','description','language','accent','label','tag','categories'];
const identity=list=>list.map(r=>Object.fromEntries(IDENTITY.map(k=>[k,r[k]??null])));
const NEW=rows.slice(1121);
const CATEGORY=/^(Women|Men|Kids and teens|Characters), (Clear & Neutral|Warm & Soothing|Bright & Lively|Deep & Resonant|Rough & Textured|Light & Youthful|Characters & Distinctive)$/;
const emptyLegacy={voices:[],hidden:[],aliases:[],map:{},renames:{},describe:{},tags:{}};

test('the 45 Oct 29 voices are appended after every older voice, unchanged',()=>{
 assert.equal(rows.length,1166);
 assert.equal(NEW.length,45);
 assert.equal(hash(identity(NEW)),'452b0a789cd53db527f9116d57b26618982ffb3a991fa138173fd2cc14454e49');
});

test('each new voice is a checked drama-3 reference with a memorable non-person name',()=>{
 const first=new Set(pools.first.map(n=>n.toLowerCase()));
 const surnames=new Set(pools.surnames.map(n=>n.toLowerCase()));
 for(const row of NEW){
  assert.match(row.id,/^ref_[a-f0-9]{16}$/);
  assert.equal(row.testedModel,'drama-3');
  assert.equal(row.aliases,undefined,`${row.label} has no old names`);
  assert.ok(row.categories.length>=1&&row.categories.length<=3,row.label);
  for(const c of row.categories)assert.match(c,CATEGORY);
  assert.equal(row.tag,row.label);
  assert.match(row.label,/^[A-Z][A-Za-z]*(-[A-Za-z]+)* [A-Z][A-Za-z]*(-[A-Za-z]+)*$/);
  for(const word of row.label.toLowerCase().split(/[ -]/)){
   assert.ok(!first.has(word),`${row.label}: ${word} is a given name`);
   assert.ok(!surnames.has(word),`${row.label}: ${word} is a surname`);
  }
  assert.doesNotMatch(row.label+' '+row.tag,/speech/i);
 }
});

test('the picker lists them last and every name reaches its own recording',()=>{
 const picker=selectedPicker(rows,emptyLegacy);
 assert.deepEqual(picker.fish.slice(-45),NEW.map(r=>r.label));
 const map={},auditions=new Map();
 installSelectedBindings(rows,map,auditions);
 for(const row of NEW){
  assert.equal(map[row.label],'fish:'+row.id);
  assert.equal(map['fish:'+row.id],'fish:'+row.id);
  assert.strictEqual(auditions.get(row.label),row);
 }
});
