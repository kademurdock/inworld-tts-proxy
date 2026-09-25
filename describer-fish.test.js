// Describer picker (Sep 25 2026): /voices.json names the labels that speak through fish.audio,
// so the describer can say they sound less natural sped up. Labels only, never ids.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const definitions=source.slice(source.indexOf('const OPENAI_ALIAS_MAP ='),source.indexOf('const MODEL_MAP ='));
const picker=source.slice(source.indexOf('const VOICE_LIST ='),source.indexOf('const SAMPLE_TEXT ='));
const ctx={FISH_VOICE_PREFIX:'fish:',process:{env:{}},console:{log(){},warn(){}},require:(p)=>require(p)};
vm.runInNewContext(definitions+'\n'+picker+'\nthis.result={VOICE_LIST,VOICE_RENAMES,fish:fishPickerLabels()};',ctx);
const r=ctx.result;
assert.ok(r.fish.includes('Kade Murdock'));
assert.ok(!r.fish.includes('clear woman · flint'));
assert.ok(!r.fish.includes('clear high-ish young woman · dory'));
assert.equal(r.VOICE_RENAMES['Voice 541'],'clear high-ish young woman · dory');
assert.ok(r.fish.length>150&&r.fish.length<r.VOICE_LIST.length);
assert.ok(r.fish.every((label)=>r.VOICE_LIST.includes(label)));
assert.ok(r.fish.every((label)=>!/fish:|[0-9a-f]{32}/.test(label)));
assert.match(source,/app\.get\("\/voices\.json"[\s\S]{0,2500}fish: fishPickerLabels\(\)/);
console.log(`Describer picker: ${r.fish.length} of ${r.VOICE_LIST.length} picker labels are marked as fish.audio voices, labels only.`);
