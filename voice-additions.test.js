'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const rows=require('./selected-voices.json').voices;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/* Oct 16 2026: voices were renamed from human names to memorable non-person names.
 * Names may change; what defines each voice may not: its id, reference recording,
 * metadata, description and place in the catalog. */
const IDENTITY=['id','sha256','metadataSha256','referenceKey','metadataKey','testedModel','description','language','accent'];
const identity=list=>list.map(r=>Object.fromEntries(IDENTITY.map(k=>[k,r[k]??null])));
test('the catalog keeps every voice, its recording and its order',()=>{
 assert.equal(rows.length, 1121);
 assert.equal(hash(identity(rows)), 'cdc699b22325f80710caeac433de20ce5994934af576dbbe25d609331d9a9887');
 assert.equal(new Set(rows.map(r=>r.id)).size,1121);
 assert.equal(new Set(rows.map(r=>r.label.toLowerCase())).size,1121);
 for(const name of ['Coco','Manayah','Snoley'])assert.equal(rows.filter(r=>r.label===name).length,1);
 for(const row of rows.slice(601)){
  assert.equal(row.testedModel,'drama-3');
  assert.match(row.id,/^ref_[a-f0-9]{16}$/);
  assert.ok(row.categories.length>=1&&row.categories.length<=3);
  assert.ok(row.categories.every(c=>/^(Women|Men|Kids and teens|Characters), /.test(c)));
 }
});
