const fs=require('fs');
const pcm=Buffer.alloc(24000);for(let i=0;i<12000;i++)pcm.writeInt16LE(Math.round(Math.sin(i/10)*3000),i*2);
const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
global.fetch=async(url,options)=>{
 const u=String(url);
 if(!['https://api.inworld.ai/tts/v1/voice','https://api.inworld.ai/tts/v1/voice:stream','https://api.fish.audio/v1/tts'].includes(u))throw Error('External network blocked by fixture');
 fs.appendFileSync(process.env.PROVIDER_RECEIPT,JSON.stringify({url:u,body:JSON.parse(options.body)})+'\n');
 if(u.endsWith(':stream'))return new Response(JSON.stringify({result:{audioContent:wav.toString('base64')}})+'\n', {headers:{'Content-Type':'application/x-ndjson'}});
 return u.includes('fish.audio')?new Response(pcm):Response.json({audioContent:wav.toString('base64')});
};
