'use strict';
// Nov 6 2026: Kiana's last message to Kade had "%%%\n%%%warm and curious%%%" and the voice said "warm and
// curious" aloud. Through the real HTTP handler, Inworld (buffered and streamed) and Fish, the words of a
// direction must reach the provider only as a direction, however a stray %%% line sits in front of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INCIDENT = "%%%to correct with respect%%%\nYeah, you're right, that's on me. The paper trail for that house is thin.\n\n%%%\n%%%warm and curious%%% So what's the shape of it? How far back have you gotten on your mama's side?";
const OTHERS = [
  ['stray after the tag', "%%%warm and curious%%% So what now?\n%%%\nAnd then more words after it."],
  ['two strays', "Before the tag.\n%%%\n%%%\n%%%warm and curious%%% So what now? And a little more."],
  ['glued closer and opener', "%%%to correct with respect%%%%%%warm and curious%%% So what now? And a little more."],
  ['closer forgotten on its own line', "Before the tag.\n%%%warm and curious\nSo what now? And a little more."],
];

async function withServer(port, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-balance-'));
  const receipt = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(receipt, '');
  const env = { ...process.env, PORT: String(port), INWORLD_API_KEY: 'offline', FISH_API_KEY: 'offline', PROVIDER_RECEIPT: receipt };
  for (const k of ['INWORLD_WRITER', 'INWORLD_TALK_FILLERS', 'INWORLD_TALK_SOUNDS', 'FISH_TALK_FILLERS', 'FISH_TALK_SOUNDS', 'FISH_DEFAULT_DIRECTION', 'TTS_TALK_CALM']) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-fixtures/provider.cjs'), 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (x) => { log += x; });
  child.stderr.on('data', (x) => { log += x; });
  const rows = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  try {
    let ready = false;
    for (let i = 0; i < 160 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).status < 500; } catch { /* booting */ }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    // what the provider was handed for one message: every request's text and instruction
    const handed = async (input, body) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
      return rows().slice(before).map((x) => ({ text: x.body.text, instruction: x.body.instruction || null }));
    };
    return await run({ handed, log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

const speechOf = (reqs) => reqs.map((q) => q.text).join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ');

test('Inworld: the incident reaches the provider as two directions and clean speech, buffered and streamed', async () => {
  await withServer(31958, async ({ handed }) => {
    for (const stream of [false, true]) {
      const reqs = await handed(INCIDENT, { voice: 'alloy', stream });
      const instructions = reqs.map((q) => q.instruction);
      assert.deepEqual(instructions, ['to correct with respect', 'warm and curious'], 'stream=' + stream + ' ' + JSON.stringify(reqs));
      assert.doesNotMatch(speechOf(reqs), /warm and curious/, 'the direction is not spoken: ' + JSON.stringify(reqs));
      assert.doesNotMatch(reqs.map((q) => q.text).join(' '), /%/);
      assert.match(speechOf(reqs), /So what's the shape of it\? How far back have you gotten on your mama's side\?/);
    }
  });
});

test('Inworld: strays and a forgotten closer, in other shapes, never leave direction words in the speech', async () => {
  await withServer(31959, async ({ handed }) => {
    for (const [name, input] of OTHERS) {
      const reqs = await handed(input, { voice: 'alloy' });
      assert.doesNotMatch(speechOf(reqs), /warm and curious|to correct with respect/, name + ': ' + JSON.stringify(reqs));
      assert.doesNotMatch(reqs.map((q) => q.text).join(' '), /%/, name);
      assert.ok(reqs.some((q) => q.instruction === 'warm and curious' || /\[warm and curious\]/.test(q.text)), name + ' kept its direction: ' + JSON.stringify(reqs));
      assert.match(speechOf(reqs), /So what now\?/, name);
    }
  });
});

// The first version of the fix judged the WORDS of a tag too hard: a red team found these used to work and
// began to be read aloud. Each: [name, message, words that must never be spoken, speech that must survive].
const SHAPES = [
  ['exclamation', '%%%excited!%%% Oh my gosh, look at that.', /\bexcited\b/i, /Oh my gosh, look at that\./],
  ['question', '%%%whispering?%%% Oh my gosh, look at that.', /\bwhispering\b/i, /Oh my gosh, look at that\./],
  ['line break after the opener', '%%%\nwarm%%% Hi there friend.', /\bwarm\b/i, /Hi there friend\./],
  ['fence', 'Before the tag.\n%%%\nwarm and curious\n%%%\nSo what is the shape of it?', /\bcurious\b/i, /Before the tag\..*So what is the shape of it\?/],
  ['abbreviation', '%%%gentle Mr. Rogers voice%%% Oh my gosh, look at that.', /\brogers\b/i, /Oh my gosh, look at that\./],
  ['empty tag, then a tag', '%%%%%% I walked in and sat down %%%wry%%% quietly.', /\bwry\b/i, /I walked in and sat down\s+quietly\./],
  ['closer forgotten, speech follows', '%%%warm Hello there, friend. And a little more to say.', /\bwarm\b/i, /Hello there, friend\. And a little more to say\./],
  ['stray line before a padded tag', 'Hello.\n%%%\nThe paper trail is thin. %%% soft but sure %%%\nOkay then.', /soft but sure/i, /Hello\..*The paper trail is thin\..*Okay then\./],
  // normalizeForSpeech used to turn "2019 %" into "2019 percent" and eat the first % of the delimiter that followed
  ['a number right before a tag', 'In 2019 %%%wistful%%% it was simpler.', /\bwistful\b|percent/i, /In 2019\s+it was simpler\./],
  ['a number and a line break right before a tag', 'Room 12\n%%%warm%%% Come in.', /\bwarm\b|percent/i, /Room 12\s+Come in\./],
  ['a real percentage beside a tag still says percent', 'Sales are up 50% this year. %%%warm%%% Nice.', /\bwarm\b/i, /Sales are up 50 percent this year\.\s+Nice\./],
  // the apps cut a reply in pieces; the second piece of a tag cut in half must not speak the direction
  ['the tail of a tag cut in half', 'curious%%% So what is the shape of it? And how far back have you gotten?', /\bcurious\b/i, /So what is the shape of it\? And how far back have you gotten\?/],
  ['a bare closer at the start of a piece', '%%% I spent twenty minutes looking for my', /^$/, /I spent twenty minutes looking for my/],
  // the iPhone re-stamps its carried bare newline (`%%%\n%%% `) in front of the next pieces; a stray later in the
  // piece closed it around the sentence and the provider was handed nothing (the old pairing spoke every word)
  ['the iPhone re-stamp and a stray at the end of the piece', '%%%\n%%% See you soon. %%%', /^$/, /See you soon\./],
  ['the iPhone re-stamp and a stray glued to the sentence', "%%%\n%%% Some of them are labeled in his handwriting, but the names don't match anything I know.%%%", /^$/, /labeled in his handwriting, but the names don't match anything I know\./],
  ['the iPhone re-stamp and a stray between two sentences', '%%%\n%%% You made it. %%% I saved you the chair by the heater.', /^$/, /You made it\. I saved you the chair by the heater\./],
  // a forgotten closer after a long direction with speech that has a capital: the words leak (as before), the speech is kept
  ['a forgotten closer after five words, speech after it', '%%%fond and a little emotional She walked in without looking back', /^$/, /She walked in without looking back/],
  // a chunker that cuts a delimiter in the middle leaves ONE lone %, which the voice would say as "percent"
  ['a lone percent sign at the start of a piece (the cut closer)', "% I saved you the blue one. It's under my notebook so nobody takes it.", /^$/, /I saved you the blue one\. It's under my notebook so nobody takes it\./],
  ['a lone percent sign at the end of a piece (the cut opener)', '%%%warm%%% Two different problems.\n\n%', /\bwarm\b/i, /Two different problems\./],
  // two strays in one reply: a closer written with extra percent signs, then another stray
  ['a closer with extra percent signs, then a second stray', '%%%happy%%%%%%% Yes.%%%', /\bhappy\b/i, /Yes\./],
  ['doubled-percent strays far apart', '%%%pleased%%% Hello %%there friend.\n\nHow are you%% today?', /\bpleased\b/i, /Hello there friend\.\s+How are you today\?/],
  // the incident's stray line one character short, and a tag round nothing but a beat of dots
  ['a lone percent sign on a line of its own', 'Hello.\n\n%\n%%%warm%%% Hi there.', /\bwarm\b/i, /Hello\.\s+Hi there\./],
  ['a tag round no letters', 'Before it. %%%...%%% After it, with a few more words.', /\.\.\./, /Before it\.\s+After it, with a few more words\./],
];

async function checkShapes(handed, body, label) {
  for (const [name, input, gone, kept] of SHAPES) {
    const reqs = await handed(input, body);
    const heard = speechOf(reqs);
    assert.doesNotMatch(heard, gone, `${label} ${name} speaks its direction: ${JSON.stringify(reqs)}`);
    assert.match(heard.replace(/\s+/g, ' '), kept, `${label} ${name} lost its speech: ${JSON.stringify(reqs)}`);
    assert.doesNotMatch(reqs.map((q) => q.text).join(' '), /%/, `${label} ${name} sent a delimiter`);
  }
}

test('Inworld: tags with punctuation, line breaks, empty tags and a forgotten closer reach the provider as directions', async () => {
  await withServer(31961, async ({ handed }) => {
    for (const stream of [false, true]) await checkShapes(handed, { voice: 'alloy', stream }, 'inworld stream=' + stream);
  });
});

test('Fish: the same shapes keep their directions out of the speech', async () => {
  await withServer(31962, async ({ handed }) => {
    await checkShapes(handed, { voice: 'fish:fixture' }, 'fish');
  });
});

test('Fish: the same incident leaves the direction in brackets and none of its words in the speech', async () => {
  await withServer(31960, async ({ handed }) => {
    const reqs = await handed(INCIDENT, { voice: 'fish:fixture' });
    const joined = reqs.map((q) => q.text).join(' ');
    assert.match(joined, /\[warm and curious\]/);
    assert.doesNotMatch(joined.replace(/\[[^\]]*\]/g, ' '), /warm and curious/, joined);
    assert.doesNotMatch(joined, /%/);
  });
});
