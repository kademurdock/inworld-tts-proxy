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
// Oct 19 2026: Voice 541 speaks as Kade Professional; every older spelling of it follows.
const pro='default-e-m11vgtr9l-m7afw4kmnw__kade_professional';
for(const name of ['Voice 541','Kade Professional','Voice 541 Kade professional','clear high-ish young woman · dory','default-e-m11vgtr9l-m7afw4kmnw__keighty_pro'])
 assert.equal(r.VOICE_MAP[name],pro,name);
assert.equal(r.VOICE_RENAMES['Voice 541'],'Kade Professional');
assert.equal(r.VOICE_RENAMES['clear high-ish young woman · dory'],'Kade Professional');
assert.equal(r.VOICE_LIST.filter(v=>v==='Kade Professional').length,1);
assert.ok(!r.VOICE_LIST.includes('clear high-ish young woman · dory'));
assert.equal(r.VOICE_PICKER_CATEGORIES.filter(c=>c.voices.includes('Kade Professional')).map(c=>c.name).join(),'Women, named voices');
assert.ok(!Object.values(r.VOICE_MAP).includes('default-e-m11vgtr9l-m7afw4kmnw__keighty_pro'),'nothing still points at the deleted clone');
// Oct 20 2026: Voice 664 is her second Inworld clone, named "Kade".
assert.equal(r.VOICE_MAP['Voice 664'],'default-e-m11vgtr9l-m7afw4kmnw__kade_murdock');
assert.equal(r.VOICE_MAP['Kade'],r.VOICE_MAP['Voice 664']);
assert.equal(r.VOICE_RENAMES['Voice 664'],'Kade');
assert.equal(r.VOICE_MAP['Kade Murdock'],'fish:a61737cbbea74c6ca3c112cf1f319d35','the Fish voice keeps its own name');
assert.equal(r.VOICE_PICKER_CATEGORIES.filter(c=>c.voices.includes('Kade')).map(c=>c.name).join(),'Women, named voices');
console.log('Full voice catalog builds; named Women entries and numbered/saved aliases resolve correctly.');

