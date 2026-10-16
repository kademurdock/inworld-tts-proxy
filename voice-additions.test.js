'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const rows=require('./selected-voices.json').voices;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('the new catalog preserves every original Fish row and its order',()=>{
 assert.equal(rows.length, 1121);
 assert.equal(hash(rows.slice(0,601)), '4e6ce4933897e117f1df84f0a095522b07a7c64be1c7db8ca6a8908699b24876');
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
