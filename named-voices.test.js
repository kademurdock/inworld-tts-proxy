const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const definitions=source.slice(source.indexOf('const OPENAI_ALIAS_MAP ='),source.indexOf('const MODEL_MAP ='));
const picker=source.slice(source.indexOf('const VOICE_LIST ='),source.indexOf('const SAMPLE_TEXT ='));
const ctx={FISH_VOICE_PREFIX:'fish:',process:{env:{}},console:{log(){},warn(){}},require:(p)=>require(p)};
vm.runInNewContext(definitions+'\n'+picker+'\nthis.result={VOICE_MAP,VOICE_LIST,VOICE_PICKER_CATEGORIES,VOICE_RENAMES};',ctx);
const r=ctx.result;
assert.equal(r.VOICE_MAP['Kade Murdock'],'fish:a61737cbbea74c6ca3c112cf1f319d35');
assert.equal(r.VOICE_MAP['Miss-A'],'default-e-m11vgtr9l-m7afw4kmnw__miss_a');
assert.equal(r.VOICE_MAP['Miss A'],r.VOICE_MAP['Miss-A']);
for(const [num,label] of [['Voice 652','Kade Murdock'],['Voice 653','Miss-A']]){
 assert.equal(r.VOICE_MAP[num],r.VOICE_MAP[label]);assert.equal(r.VOICE_RENAMES[num],label);
 assert.equal(r.VOICE_LIST.filter(v=>v===label).length,1);
 assert.equal(r.VOICE_PICKER_CATEGORIES.filter(c=>c.name.startsWith('Women')&&c.voices.includes(label)).length,1);
}
console.log('Full voice catalog builds; named Women entries and numbered/saved aliases resolve correctly.');

