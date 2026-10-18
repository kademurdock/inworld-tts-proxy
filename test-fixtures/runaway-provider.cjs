// A Fish stand-in that runs on (fish-runaway.test.js). Every request is written to PROVIDER_RECEIPT.
// Text containing RUNAWAY_ALWAYS gets a 40 s tone every time; text containing RUNAWAY_ONCE gets it
// on its first take only; everything else gets 1 s.
const fs = require('fs');
function tone(seconds) {
  const n = Math.round(24000 * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
  return pcm;
}
const long = tone(40);
const short = tone(1);
const takes = new Map();
global.fetch = async (url, options) => {
  if (String(url) !== 'https://api.fish.audio/v1/tts') throw Error('External network blocked by fixture');
  const { text } = JSON.parse(options.body);
  fs.appendFileSync(process.env.PROVIDER_RECEIPT, JSON.stringify({ text }) + '\n');
  const take = (takes.get(text) || 0) + 1;
  takes.set(text, take);
  const always = process.env.RUNAWAY_ALWAYS && text.includes(process.env.RUNAWAY_ALWAYS);
  const once = process.env.RUNAWAY_ONCE && text.includes(process.env.RUNAWAY_ONCE) && take === 1;
  return new Response(always || once ? long : short);
};
