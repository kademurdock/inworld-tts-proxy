'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
test('provider wire retains delivery through paragraph splits and isolates auditions and voices',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tts-continuity-')),receipt=path.join(dir,'requests.jsonl');fs.writeFileSync(receipt,'');
 const child=spawn(process.execPath,['--require',path.join(__dirname,'test-fixtures/provider.cjs'),'server.js'],{cwd:__dirname,env:{...process.env,PORT:'31861',INWORLD_API_KEY:'offline',FISH_API_KEY:'offline',PROVIDER_RECEIPT:receipt},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 const rows=()=>fs.readFileSync(receipt,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const say=async(input,voice='alloy',session='seat-one',extra={})=>{
  const before=rows().length;
  const r=await fetch('http://127.0.0.1:31861/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json','x-kade-tts-session':session},body:JSON.stringify({input,voice,...extra})});
  assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>44);
  return rows().slice(before).map(r=>r.body);
 };
 const prior=b=>(b.synthesisContext?.previousRequests||[]).map(r=>r.text).join(' ');
 try{
  let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch('http://127.0.0.1:31861/')).status<500;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,log);
  await say('Our conversation is about growing tomatoes.');
  const preview=await say('Hi there. This is how I sound.');
  assert.equal(prior(preview[0]),'','audition must start fresh');
  const after=await say('They need more sunlight.');
  assert.equal(prior(after[0]),'Our conversation is about growing tomatoes.','audition never enters chat context');
  const differentVoice=await say('This is a different person.','echo');
  assert.equal(prior(differentVoice[0]),'','voices on a seat do not share context');
  assert.equal(prior((await say('Private words.','alloy','seat-two'))[0]),'','seats remain isolated');
  const before=rows().length,first=say('Context first request.','alloy','overlap');
  for(let i=0;i<50&&rows().length===before;i++)await new Promise(r=>setTimeout(r,5));
  await say('Context second request.','alloy','overlap');
  await first;
  assert.equal(prior((await say('Context third request.','alloy','overlap'))[0]),
    'Context first request. Context second request.','prefetch completion order never reverses context');
  const words=Array.from({length:14},(_,i)=>`Sentence ${i+1} keeps the same warm feeling throughout this long paragraph.`).join(' ');
  for(const voice of ['alloy','fish:fixture']){
   const calls=await say('%%%warm and amused%%% '+words,voice,'long-'+voice);
   assert.ok(calls.length>=2);
   for(const b of calls)assert.match(b.instruction||b.text,/warm and amused/,'overflow chunks retain active feeling');
   if(voice==='alloy')assert.match(prior(calls[1]),/Sentence/,'earlier words remain context');
  }
 }finally{if(child.exitCode===null&&!child.signalCode){child.kill();await new Promise(r=>child.once('exit',r));}}
});
