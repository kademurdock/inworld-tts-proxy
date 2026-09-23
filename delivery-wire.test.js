'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
test('real HTTP handler preserves delivery and speed in buffered, streamed, Fish and scene requests',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tts-wire-')),receipt=path.join(dir,'requests.jsonl');fs.writeFileSync(receipt,'');
 const child=spawn(process.execPath,['--require',path.join(__dirname,'test-fixtures/provider.cjs'),'server.js'],{cwd:__dirname,env:{...process.env,PORT:'31860',INWORLD_API_KEY:'offline',FISH_API_KEY:'offline',PROVIDER_RECEIPT:receipt},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 const rows=()=>fs.readFileSync(receipt,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 try{
  let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch('http://127.0.0.1:31860/')).status<500;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,log);
  const input='%%%warm and unhurried%%% This IS a sentence. %%%laugh%%% Another one!';
  for(const [voice,stream,delivery] of [['alloy',false,'BALANCED'],['alloy',true,'BALANCED'],['fish:fixture',false,'BALANCED'],['fish:fixture',false,'STABLE'],['alloy',false,'CREATIVE']]){
   const count=rows().length;
   const r=await fetch('http://127.0.0.1:31860/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,voice,stream,delivery,speed:1.2})});
   assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>44);
   const calls=rows().slice(count);assert.equal(calls.length,1);
   const {body:b,url}=calls[0],direction=b.instruction||b.text;
   // Tempo words leave directions entirely since Sep 20 (AUTHOR_TEMPO_STRIP); the feeling stays.
   assert.match(direction,/warm/);assert.doesNotMatch(direction,/unhurried/);
   assert.match(b.text,/\[laugh\]/);
   if(voice.startsWith('fish')){assert.equal(b.temperature,delivery==='STABLE'?.5:.9);assert.equal(b.prosody.speed,1.2);}
   else {assert.equal(b.deliveryMode,delivery);assert.equal(b.audioConfig.speakingRate,1.2);assert.equal(url.endsWith(':stream'),stream);}
  }
  const count=rows().length;
  const r=await fetch('http://127.0.0.1:31860/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:'alloy',delivery:'BALANCED',speed:1.1,input:'[[Voice 327]] %%%quick and delighted%%% We won! [[Voice 1]] %%%warm and unhurried%%% I knew we could.'})});
  assert.equal(r.status,200);await r.arrayBuffer();const calls=rows().slice(count);assert.equal(calls.length,2);
  assert.ok(calls.some(r=>r.body.temperature===.9));assert.ok(calls.some(r=>r.body.deliveryMode==='BALANCED'));
  for(const {body:b} of calls){assert.match(b.instruction||b.text,/delighted|warm/);assert.doesNotMatch(b.instruction||b.text,/unhurried|quick/);}
  // Sep 23 2026: Balanced with no direction of its own gets the lively baseline; a direction
  // the character wrote always wins; Steady and Lively get none; no delivery means Balanced.
  const {LIVELY_BASELINE}=require('./speech-prosody');
  for(const [delivery,input,want] of [['BALANCED','Plain words, nothing steering them.',LIVELY_BASELINE],[undefined,'Plain words again.',LIVELY_BASELINE],
    ['BALANCED','%%%whispering, sad%%% Plain words.','whispering, sad'],['STABLE','Plain words.',undefined],['CREATIVE','Plain words.',undefined]]){
   for(const stream of [false,true]){
    const before=rows().length;
    const r2=await fetch('http://127.0.0.1:31860/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,voice:'alloy',stream,...(delivery?{delivery}:{})})});
    assert.equal(r2.status,200);await r2.arrayBuffer();
    const [call]=rows().slice(before);
    if(want==='whispering, sad'){assert.match(call.body.instruction||'',/whisper/);assert.notEqual(call.body.instruction,LIVELY_BASELINE);}
    else assert.equal(call.body.instruction,want,JSON.stringify([delivery,input,stream]));
    assert.equal(call.body.deliveryMode,delivery||'BALANCED');
   }
  }
  const beforeFish=rows().length;
  const f=await fetch('http://127.0.0.1:31860/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'Plain words.',voice:'fish:fixture'})});
  assert.equal(f.status,200);await f.arrayBuffer();
  assert.equal(rows().slice(beforeFish)[0].body.temperature,.9,'fish default is 0.9');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));}
});
