'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {selectedPicker,installSelectedBindings}=require('./private-voice-references');
const {createSelectedReportHandler}=require('./selected-voice-moves');
const {applyReport,makeRunner}=require('./voice-moves');
const {audienceFor,createScenePicker,POOLS}=require('./audition-scenes');
const source=fs.readFileSync(require.resolve('./server'),'utf8');
function legacy(){
 const ctx={FISH_VOICE_PREFIX:'fish:',process:{env:{}},console:{log(){},warn(){}},require:p=>require(p)};
 vm.runInNewContext(source.slice(source.indexOf('const OPENAI_ALIAS_MAP ='),source.indexOf('const MODEL_MAP ='))+'\n'+source.slice(source.indexOf('const VOICE_LIST ='),source.indexOf('const SAMPLE_TEXT ='))+'\nthis.result={VOICE_MAP,VOICE_LIST,VOICE_PICKER_CATEGORIES,VOICE_RENAMES,VOICE_DESCRIBE,VOICE_TAGS,HIDDEN_VOICE_ALIASES};',ctx);
 return ctx.result;
}
function fresh(){
 const rows=structuredClone(require('./selected-voices.json').voices),state=legacy(),auditions=new Map();
 const picker=selectedPicker(rows,{voices:state.VOICE_LIST,hidden:state.HIDDEN_VOICE_ALIASES,aliases:[],map:state.VOICE_MAP,renames:state.VOICE_RENAMES,describe:state.VOICE_DESCRIBE,tags:state.VOICE_TAGS});
 installSelectedBindings(rows,state.VOICE_MAP,auditions);
 state.SELECTED_VOICE_REPORT=createSelectedReportHandler(rows,picker);
 return {rows,state,picker,auditions};
}
function report(label,heard,day=1,status='open'){
 return {_id:String(day).padStart(24,'0'),createdAt:`2026-10-${String(day).padStart(2,'0')}T00:00:00Z`,status,subject:'Voice in the wrong section: '+label,detail:`Voice: ${label}. Filed under "Women" — sounds like: ${heard}.`+(status==='resolved'?'\n[auto-move] applied':'')};
}
test('all retained and newly checked identities coexist with historical bindings',()=>{
 const {rows,state,picker,auditions}=fresh();
 assert.equal(rows.length,1121);assert.equal(new Set(rows.map(r=>r.tag)).size,1121);
 for(const row of rows){
  for(const alias of [row.label,'fish:'+row.id,...(row.aliases||[])]){
   assert.equal(state.VOICE_MAP[alias],'fish:'+row.id);assert.strictEqual(auditions.get(alias),row);
  }
  for(const alias of row.aliases||[]){assert.ok(picker.hidden.includes(alias));assert.ok(!picker.voices.includes(alias));assert.equal(picker.renames[alias],row.label);}
 }
 assert.equal(state.VOICE_MAP['Miss-A'],'default-e-m11vgtr9l-m7afw4kmnw__miss_a');
 assert.equal(state.VOICE_MAP['Kade Murdock'],'fish:a61737cbbea74c6ca3c112cf1f319d35');
 assert.equal(state.VOICE_MAP['Voice 653'],state.VOICE_MAP['Miss-A']);
 assert.equal(picker.tags['Miss-A (Amber A)'],'Miss-A');
 assert.equal(picker.tags['Kadiana (Expressive)'],'Kadiana');
 assert.equal(picker.tags['Kade (HQ)'],'Kade');
 assert.doesNotMatch(JSON.stringify(picker),/referenceKey|metadataKey|source_path|reference_transcript/);
});
test('moving an old name updates all picker memberships and auditions without changing the new name or audio',()=>{
 const {rows,state,picker,auditions}=fresh();const row=rows.find(r=>r.label==='Abigail Bell')||rows.find(r=>r.categories[0].startsWith('Women,'));
 const old=row.aliases[0],saved=JSON.stringify({...row,categories:[]});
 const result=applyReport(state,report(old,'a kid or a teen'));
 assert.equal(result.ok,true);assert.ok(row.categories.every(c=>c.startsWith('Kids and teens,')));
 assert.equal(JSON.stringify({...row,categories:[]}),saved);
 assert.equal(audienceFor(auditions.get(old).categories),'kids');
 assert.equal(audienceFor(auditions.get('fish:'+row.id).categories),'kids');
 for(const section of picker.categories)assert.equal(section.voices.includes(row.label),row.categories.includes(section.name));
 assert.ok(POOLS.kids.long.includes(createScenePicker()(row)));
 assert.equal(applyReport(state,report(old,'a kid or a teen')).already,true);
});
test('tagless personal names and all explicit groups work; ambiguous reports stay open',()=>{
 for(const [heard,group] of [['a kid or a teen','Kids and teens'],['a man','Men'],['a woman','Women'],['a character or cartoon','Characters']]){
  const {rows,state}=fresh();const row=rows.find(r=>r.label==='Kade (HQ)');
  assert.equal(applyReport(state,report(row.label,heard)).ok,true);
  assert.ok(row.categories.every(c=>c.startsWith(group+',')));assert.equal(row.label,'Kade (HQ)');
 }
 const {rows,state}=fresh();const row=rows[0];const before=JSON.stringify(row);
 assert.equal(applyReport(state,report(row.label,'a mystery')).ok,false);assert.equal(JSON.stringify(row),before);
});
test('a newer resolved correction wins over an older still-open report across restarts',async()=>{
 for(let restart=0;restart<2;restart++){
  const {rows,state}=fresh();const row=rows.find(r=>r.aliases?.length);const posted=[];
  const old=report(row.aliases[0],'a man',1),recent=report(row.label,'a kid or a teen',2,'resolved');
  const runner=makeRunner({state,port:1,secret:'offline',log(){},warn(){},jev:null,fetchImpl:async(url,opts)=>{
   if(opts.method==='POST'){posted.push(JSON.parse(opts.body));return {ok:true,json:async()=>({})};}
   return {ok:true,json:async()=>url.includes('status=all')?[recent,old]:[old]};
  }});
  await runner.replayResolved();await runner.sweepOpen();
  assert.equal(audienceFor(row.categories),'kids');assert.match(posted[0].note,/newer report/);
 }
});
test('newest report wins when the API returns open reports newest-first and aliases differ',async()=>{
 const {rows,state}=fresh();const row=rows.find(r=>r.aliases?.length);const posted=[];
 const old=report(row.aliases[0],'a kid or a teen',1),recent=report(row.label,'a man',2);
 const runner=makeRunner({state,port:1,secret:'offline',log(){},warn(){},jev:{enabled(){throw Error('no model needed');}},fetchImpl:async(url,opts)=>{
  if(opts.method==='POST'){posted.push(JSON.parse(opts.body));return {ok:true,json:async()=>({})};}
  return {ok:true,json:async()=>[recent,old]};
 }});
 await runner.sweepOpen();assert.equal(posted.length,2);assert.ok(row.categories.every(c=>c.startsWith('Men,')));
 assert.equal(audienceFor(row.categories),'adults');
});
test('name collisions fail atomically rather than taking over a retained binding',()=>{
 const row=structuredClone(require('./selected-voices.json').voices[0]);
 row.aliases.push('Miss-A');const map={'Miss-A':'inworld:legacy'},auditions=new Map();
 assert.throws(()=>installSelectedBindings([row],map,auditions),/collision/);
 assert.deepEqual(map,{'Miss-A':'inworld:legacy'});assert.equal(auditions.size,0);
});
test('a retained personal name cannot move the new family voice through a display tag',()=>{
 const {rows,state}=fresh();const row=rows.find(r=>r.label==='Miss-A (Amber A)');const before=JSON.stringify(row);
 assert.equal(applyReport(state,report('Miss-A','a man')).ok,false);
 assert.equal(JSON.stringify(row),before);
 assert.equal(state.VOICE_MAP['Miss-A'],'default-e-m11vgtr9l-m7afw4kmnw__miss_a');
});
test('moving a voice can restore a valid but currently empty tone section',()=>{
 const {rows,state,picker}=fresh();const row=rows.find(r=>r.categories.includes('Women, Warm & Soothing'));
 picker.categories=picker.categories.filter(c=>c.name!=='Characters, Warm & Soothing');
 assert.equal(applyReport(state,report(row.label,'a character or cartoon')).ok,true);
 assert.ok(picker.categories.find(c=>c.name==='Characters, Warm & Soothing').voices.includes(row.label));
});
