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
   assert.match(direction,delivery==='CREATIVE'?/unhurried/:/natural conversational pace/);
   assert.match(b.text,/\[laugh\]/);
   if(voice.startsWith('fish')){assert.equal(b.temperature,delivery==='STABLE'?.5:.75);assert.equal(b.prosody.speed,1.2);}
   else {assert.equal(b.deliveryMode,delivery);assert.equal(b.audioConfig.speakingRate,1.2);assert.equal(url.endsWith(':stream'),stream);}
  }
  const count=rows().length;
  const r=await fetch('http://127.0.0.1:31860/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:'alloy',delivery:'BALANCED',speed:1.1,input:'[[Voice 327]] %%%quick and delighted%%% We won! [[Voice 1]] %%%warm and unhurried%%% I knew we could.'})});
  assert.equal(r.status,200);await r.arrayBuffer();const calls=rows().slice(count);assert.equal(calls.length,2);
  assert.ok(calls.some(r=>r.body.temperature===.75));assert.ok(calls.some(r=>r.body.deliveryMode==='BALANCED'));
  for(const {body:b} of calls)assert.match(b.instruction||b.text,/natural conversational pace/);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));}
});
