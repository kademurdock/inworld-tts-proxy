'use strict';
// Oct 16 2026: Brisk and Quick speed Fish up without stretching the words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fishPace, fishPacedText, fishSentencePauses, capFishPauses } = require('./pace');

const RATE = 24000;
// tone(ms) is loud speech-like audio, gap(ms) is near-silence.
function clip(parts) {
  const out = [];
  for (const [kind, ms] of parts) {
    const n = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < n; i++) out.push(kind === 'tone' ? Math.round(8000 * Math.sin(i / 3)) : (i % 2 ? 20 : -20));
  }
  return Buffer.from(new Int16Array(out).buffer);
}
const ms = buf => (buf.length / 2 / RATE) * 1000;

test('Brisk and Quick skip the added sentence pauses; slower paces keep them', () => {
  assert.equal(fishSentencePauses(1), true);
  assert.equal(fishSentencePauses(undefined), true);
  assert.equal(fishSentencePauses(0.75), true);
  assert.equal(fishSentencePauses(0.9), true);
  assert.equal(fishSentencePauses(1.2), false);
  assert.equal(fishSentencePauses(1.5), false);
  assert.equal(fishSentencePauses(1.25), false, 'old clients sending 1.25 get Brisk');
});

test('Brisk and Quick wording asks for speed, with no numeric promise', () => {
  assert.match(fishPacedText('Hi.', 1.2), /^\[speaking quickly/);
  assert.match(fishPacedText('Hi.', 1.5), /^\[fast-talking/);
  assert.equal(fishPacedText('Hi.', 1), 'Hi.');
  for (const rate of [1.2, 1.5]) assert.doesNotMatch(fishPace(rate).direction, /\d|percent/);
});

test('long silences inside a clip are shortened to the pace cap; speech is untouched', () => {
  const src = clip([['gap', 200], ['tone', 500], ['gap', 900], ['tone', 400], ['gap', 150], ['tone', 300], ['gap', 300]]);
  const brisk = capFishPauses(src, 1.2, RATE);
  const quick = capFishPauses(src, 1.5, RATE);
  // 900 ms gap -> 600 (Brisk) / 400 (Quick) since Oct 17; 150 ms gap stays; edges stay.
  assert.ok(Math.abs(ms(src) - ms(brisk) - 300) <= 10, `brisk removed ${ms(src) - ms(brisk)} ms`);
  assert.ok(Math.abs(ms(src) - ms(quick) - 500) <= 10, `quick removed ${ms(src) - ms(quick)} ms`);
  // The loud samples survive byte for byte: count samples above the tone threshold.
  const loud = buf => new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2).filter(v => Math.abs(v) > 1000).length;
  assert.equal(loud(brisk), loud(src));
  assert.equal(loud(quick), loud(src));
});

test('Natural and slower paces, and silent or tiny clips, are returned as they are', () => {
  const src = clip([['tone', 300], ['gap', 900], ['tone', 300]]);
  for (const rate of [1, 0.9, 0.75, undefined]) assert.equal(capFishPauses(src, rate, RATE), src);
  const silent = clip([['gap', 500]]);
  assert.equal(capFishPauses(silent, 1.5, RATE).length, silent.length);
  assert.equal(capFishPauses(Buffer.alloc(2), 1.5, RATE).length, 2);
});

// Oct 16 2026: the casual Fish brief (FISH_DEFAULT_DIRECTION) and the two pause switches.
function withEnv(vars, fn) {
  const before = {};
  for (const k of Object.keys(vars)) { before[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(vars)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
}

test('the casual brief is off unless set, and only chat speech asks for it', () => {
  withEnv({ FISH_DEFAULT_DIRECTION: undefined }, () => {
    assert.equal(fishPacedText('Hi.', 1, { talk: true }), 'Hi.');
  });
  withEnv({ FISH_DEFAULT_DIRECTION: 'talking off the cuff with a friend' }, () => {
    assert.equal(fishPacedText('Hi.', 1, { talk: true }), '[talking off the cuff with a friend] Hi.');
    assert.equal(fishPacedText('Hi.', 1), 'Hi.', 'books, previews and scenes do not pass talk');
    assert.equal(fishPacedText('Hi.', 1.2, { talk: true }),
      '[speaking quickly, letting the sentences flow together with short pauses] [talking off the cuff with a friend] Hi.');
  });
});

test("a character's own opening direction wins over the casual brief; an opening sound does not", () => {
  withEnv({ FISH_DEFAULT_DIRECTION: '[talking off the cuff with a friend]' }, () => {
    assert.equal(fishPacedText('[sad, quiet] I know.', 1, { talk: true }), '[sad, quiet] I know.');
    assert.equal(fishPacedText('[laughs] Okay.', 1, { talk: true }), '[talking off the cuff with a friend] [laughs] Okay.',
      'brackets typed into the setting are not doubled');
  });
});

test('FISH_SENTENCE_PAUSES=0 drops the added pause at every pace', () => {
  withEnv({ FISH_SENTENCE_PAUSES: '0' }, () => {
    for (const rate of [0.75, 0.9, 1, 1.2, 1.5]) assert.equal(fishSentencePauses(rate), false);
  });
  withEnv({ FISH_SENTENCE_PAUSES: undefined }, () => assert.equal(fishSentencePauses(1), true));
});

test('FISH_NATURAL_PAUSE_CAP_MS caps Natural only; slower paces keep their gaps', () => {
  const src = clip([['tone', 300], ['gap', 900], ['tone', 300]]);
  withEnv({ FISH_NATURAL_PAUSE_CAP_MS: '450' }, () => {
    const natural = capFishPauses(src, 1, RATE);
    assert.ok(Math.abs(ms(src) - ms(natural) - 450) <= 10, `natural removed ${ms(src) - ms(natural)} ms`);
    for (const rate of [0.9, 0.75]) assert.equal(capFishPauses(src, rate, RATE), src);
    const brisk = capFishPauses(src, 1.2, RATE);
    assert.ok(Math.abs(ms(src) - ms(brisk) - 300) <= 10, 'Brisk keeps its own 600 ms cap');
  });
});

// Oct 16 2026: spoken-only filler words (FISH_TALK_FILLERS=1), chat speech only.
const { fishTalkFillers } = require('./pace');
const strip = s => s.replace(/\b(?:So, um,|So,|Um,|Uh,|I mean,|Well,|You know,) /, '').toLowerCase();

test('fillers are off unless switched on, and only chat speech gets them', () => {
  const text = 'I went to the store today. I bought eggs and milk and bread for the whole week.';
  withEnv({ FISH_TALK_FILLERS: undefined, FISH_DEFAULT_DIRECTION: undefined }, () => {
    assert.equal(fishPacedText(text, 1, { talk: true }), text);
  });
  withEnv({ FISH_TALK_FILLERS: '1', FISH_DEFAULT_DIRECTION: undefined }, () => {
    assert.equal(fishPacedText(text, 1), text, 'books, previews and scenes do not pass talk');
    assert.notEqual(fishPacedText(text, 1, { talk: true }), text);
  });
});

test('a filler only adds words: never the first sentence, never more than one, same every time', () => {
  const samples = [
    'Oh, that\'s so good to hear! I was honestly a little worried about you after yesterday. Did you ever call your sister back, or are you still waiting on her?',
    'The starter is basically flour and water. You feed it every day for about a week. Then it is ready to bake with.',
    'Did you call Kade back? I think she was waiting on you all day long.',
  ];
  for (const s of samples) {
    const out = fishTalkFillers(s);
    assert.equal(fishTalkFillers(s), out, 'deterministic');
    assert.equal(strip(out), s.toLowerCase(), `only a filler was added: ${out}`);
    const firstSentence = s.split(/(?<=[.!?])\s/)[0];
    assert.ok(out.startsWith(firstSentence), 'the first sentence is untouched');
    assert.ok((out.match(/\b(?:Um|Uh|I mean|Well|You know|So),/g) || []).length <= 1);
  }
  assert.match(fishTalkFillers(samples[2]), /\? (?:Uh|Um|I mean|Well|You know), I think/, '"I" keeps its capital');
});

test('lists, abbreviations, discourse openers and bracket tags are left alone', () => {
  for (const s of ['1. Preheat the oven to four hundred.\n2. Mix the flour and the water together.',
    '- Eggs and milk for the week.\n- Bread from the corner bakery.',
    'Mr. Smith came by today with the mail.',
    'That was fun. Anyway, I hope you got home safe and sound tonight. But tell me how the drive went later.']) {
    assert.equal(fishTalkFillers(s), s);
  }
  const tagged = 'That was a long day at work. [short pause] <emphasis>You</emphasis> deserve a break tonight. [sighs] I made you some soup to warm up with.';
  const out = fishTalkFillers(tagged);
  assert.ok(out.includes('[short pause]') && out.includes('<emphasis>You</emphasis>') && out.includes('[sighs]'));
  assert.doesNotMatch(out, /\[[^\]]*(?:Um|Uh|I mean|Well|You know|So),/, 'never inside a tag');
});

test('with the brief and fillers both on, the brief leads and the words follow', () => {
  withEnv({ FISH_TALK_FILLERS: '1', FISH_DEFAULT_DIRECTION: 'talking off the cuff with a friend' }, () => {
    const out = fishPacedText('I went to the store today. I bought eggs and milk and bread for the whole week.', 1, { talk: true });
    assert.match(out, /^\[talking off the cuff with a friend\] I went to the store today\. (?:Um|Uh|I mean|Well|You know), I bought/);
  });
});

test('paragraphs of one reply take turns through the fillers instead of repeating one', () => {
  const { fishTalkSeed } = require('./pace');
  const reply = 'First paragraph. Second paragraph.';
  const seed = fishTalkSeed(reply);
  const para = 'The game ran long last night. We got home after midnight and slept in.';
  const picked = [0, 1, 2, 3].map(turn => fishTalkFillers(para, { turn, seed }).match(/night\. (\w+(?: \w+)?),/)[1]);
  for (let i = 1; i < picked.length; i++) assert.notEqual(picked[i], picked[i - 1], picked.join(' / '));
});

test('quoted passages are read, not chatted: no fillers in them', () => {
  const quoted = 'She wrote back this morning. "I will be there by noon, so save me a seat near the front."';
  assert.equal(fishTalkFillers(quoted), quoted);
  assert.equal(fishTalkFillers('He said “wait for me” and then he ran off down the road toward the barn.'),
    'He said “wait for me” and then he ran off down the road toward the barn.');
});

test('Inworld paragraphs each get a turn, and the listener switch wins over the defaults', () => {
  const { talkFillersByParagraph, wantsFillers } = require('./pace');
  const two = 'The game ran long last night. We got home after midnight and slept in.\n\nThe game ran long last night. We got home after midnight and slept in.';
  const out = talkFillersByParagraph(two, { turn: 0, seed: 7 });
  const [a, b] = out.split('\n\n').map(p => p.match(/night\. (\w+(?: \w+)?),/)[1]);
  assert.notEqual(a, b);
  withEnv({ INWORLD_TALK_FILLERS: undefined }, () => {
    assert.equal(wantsFillers(true, 'INWORLD_TALK_FILLERS'), false);
    assert.equal(wantsFillers({ fillers: true }, 'INWORLD_TALK_FILLERS'), true);
  });
  withEnv({ FISH_TALK_FILLERS: '1' }, () => {
    assert.equal(wantsFillers({ turn: 0 }, 'FISH_TALK_FILLERS'), true);
    assert.equal(wantsFillers({ fillers: false }, 'FISH_TALK_FILLERS'), false);
    assert.equal(fishPacedText('I went to the store today. I bought eggs and milk and bread for the week.', 1, { talk: { fillers: false } }),
      'I went to the store today. I bought eggs and milk and bread for the week.');
  });
});

// Oct 16 2026: little human sounds (FISH_TALK_SOUNDS / INWORLD_TALK_SOUNDS), spoken only.
const { talkSounds, wantsSounds } = require('./pace');
const SOUND_TAG = /\[(?:inhale|breathe|small laugh|chuckle|sigh|clear throat|quietly clears throat)\]/g;

test('a sound is spelled for its engine, placed by the words, at most one, and only adds a tag', () => {
  // Lines whose seeded roll places a laugh, a breath and a throat clear (Oct 16 listening clips).
  const funny = 'Wait, that is actually hilarious. I cannot believe the cat did that to your cake. Was anybody home when it happened, or did you just walk in and find it all over the floor?';
  const samples = [funny,
    'So here is what I was thinking about for the trip. If we leave early on Saturday morning and split the driving between the three of us, nobody has to be behind the wheel for more than a couple of hours at a time. Let me know if that works for you.',
    'Hmm, I wanted to tell you something about the garden this year. The tomatoes came in, and there are way more than we can eat by ourselves.',
    'Phew, I am so tired just hearing about it. Your boss called three meetings in a row and none of them needed to happen.'];
  let placed = 0;
  for (const s of samples) {
    for (const engine of ['fish', 'inworld']) {
      const out = talkSounds(s, { engine });
      assert.equal(talkSounds(s, { engine }), out, 'deterministic');
      const added = out.match(SOUND_TAG) || [];
      assert.ok(added.length <= 1, out);
      assert.equal(out.replace(SOUND_TAG, '').replace(/\s+/g, ' ').trim(), s, 'only a tag was added');
      if (added.length) placed++;
      if (engine === 'inworld') assert.doesNotMatch(out, /\[(?:inhale|small laugh)\]/, 'Inworld only gets its own sound words');
      if (engine === 'fish') assert.doesNotMatch(out, /\[(?:breathe|chuckle)\]/);
    }
  }
  assert.ok(placed >= 4, `placed ${placed}`);
  assert.match(talkSounds(funny, { engine: 'fish' }), /hilarious\. \[small laugh\] I cannot/, 'a laugh follows the funny line');
  assert.match(talkSounds(funny, { engine: 'inworld' }), /hilarious\. \[chuckle\] I cannot/);
  assert.match(talkSounds(samples[1], { engine: 'fish' }), /^\[inhale\] So here/);
  const { soundSpelling } = require('./pace');
  withEnv({ FISH_SOUND_THROAT: undefined }, () => assert.equal(soundSpelling('fish').throat, '[quietly clears throat]'));
  assert.equal(soundSpelling('inworld').throat, '[clear throat]', "Inworld's own sound word");
  assert.doesNotMatch(talkSounds(samples[3], { engine: 'fish' }), /\[sigh\] Phew/, 'a line that already sighs gets no sigh tag');
});

test('sounds stay out of lists, quotes, short lines and spots where the character already wrote one', () => {
  for (const s of ['- Eggs and milk for the week.\n- Bread from the corner bakery on Main.',
    'She wrote back this morning. "That is hilarious, I am so tired of this, honestly."', 'Ha, okay.']) {
    assert.equal(talkSounds(s), s);
  }
  for (let i = 0; i < 30; i++) {
    const s = `Okay that is honestly hilarious number ${i}. [laughs] I cannot believe the cat did that to your cake today.`;
    assert.doesNotMatch(talkSounds(s), /\[small laugh\] \[laughs\]|\[laughs\] \[small laugh\]/);
  }
});

test('the listener switch turns sounds off with fillers; sounds true/false wins; env is the default', () => {
  withEnv({ FISH_TALK_SOUNDS: '1' }, () => {
    assert.equal(wantsSounds(true, 'FISH_TALK_SOUNDS'), true);
    assert.equal(wantsSounds({ fillers: false }, 'FISH_TALK_SOUNDS'), false);
    assert.equal(wantsSounds({ fillers: false, sounds: true }, 'FISH_TALK_SOUNDS'), true);
    assert.equal(wantsSounds({ sounds: false }, 'FISH_TALK_SOUNDS'), false);
  });
  withEnv({ FISH_TALK_SOUNDS: undefined }, () => assert.equal(wantsSounds({ fillers: true }, 'FISH_TALK_SOUNDS'), false));
});

test('fillers are only hesitation sounds (um, uh), never placed discourse words', () => {
  const texts = ['I went to the store today. I bought eggs and milk and bread for the whole week.',
    'Did you call Kade back? I think she was waiting on you all day long.',
    'The game ran long last night. We got home after midnight and slept in.'];
  for (const t of texts) for (let turn = 0; turn < 4; turn++) {
    const out = fishTalkFillers(t, { turn, seed: 11 });
    assert.doesNotMatch(out, /\b(?:Well|You know|I mean|So),/i, out);
  }
});
