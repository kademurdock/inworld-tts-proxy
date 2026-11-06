'use strict';
// Nov 6 2026: a stray %%% must not turn the next tag into speech (steering-balance.js). Kiana's last message
// to Kade held "%%%\n%%%warm and curious%%% So what's the shape of it?" and the voice said "warm and curious".
// A red team then showed the first fix judged the WORDS of a tag too hard and broke tags that used to work
// (`%%%excited!%%%`, `%%%\nwarm%%%`, `%%%%%% ... %%%wry%%%`); the tests below pin both sides of that trade.
const test = require('node:test');
const assert = require('node:assert/strict');
const { balanceSteeringRuns, setRepairLogger, tagBody, unclosedLine } = require('./steering-balance');

const pairs = (s) => [...s.matchAll(/%%%([^%]*)%%%/g)].map((m) => m[1]);
const strip = (s) => s.replace(/%%%[^%]*%%%/g, '');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const speech = (s) => squash(strip(balanceSteeringRuns(s)));

test('the incident: an empty %%% line before a real tag no longer flips it into speech', () => {
  const msg = "%%%to correct with respect%%%\nYeah, you're right, that's on me. The paper trail is thin.\n\n%%%\n%%%warm and curious%%% So what's the shape of it? How far back have you gotten?";
  const out = balanceSteeringRuns(msg);
  assert.deepEqual(pairs(out), ['to correct with respect', 'warm and curious']);
  assert.ok(!/%\s*%/.test(strip(out)), 'no delimiter left over: ' + JSON.stringify(strip(out)));
  assert.doesNotMatch(strip(out), /warm and curious/, 'the direction is a tag, not words in the speech');
  assert.match(strip(out), /So what's the shape of it\? How far back have you gotten\?/);
});

test('well-formed messages come back exactly as they were', () => {
  for (const s of [
    'no tags at all, just 50% of the words',
    '%%%warm and curious%%% So what do you think?',
    '%%%amused%%%\nOne.\n\n%%%a little worried%%%\nTwo. %%%a beat%%% Three.',
    'Before. %%%soft%%% middle %%%reset%%% after.',
    '%%%interested like she\'s leaning into a good question%%% Go on.',
    '%%%excited!%%% Wow. %%%whispering?%%% Really.',
  ]) assert.equal(balanceSteeringRuns(s), s, s);
  assert.equal(balanceSteeringRuns(''), '');
  assert.equal(balanceSteeringRuns(null), '');
  // a padded tag is handed on in the canonical shape the rest of applySteeringTags converts
  assert.equal(balanceSteeringRuns('%%% padded %%% words %%% also padded %%% more.'), '%%%padded%%% words %%%also padded%%% more.');
});

test('strays of every shape are dropped and the tags after them still read as tags', () => {
  const tag = '%%%warm and curious%%% So what now?';
  for (const [name, input] of [
    ['empty line', `Before.\n\n%%%\n${tag}`],
    ['blank between', `Before.\n%%% %%%${tag.slice(3)}`],
    ['two strays', `Before.\n%%%\n%%%\n${tag}`],
    ['longer stray', `Before.\n%%%%%\n${tag}`],
    ['stray after the tag', `${tag}\n%%%\nAfter.`],
    ['doubled opener', `Before.\n%%%%%%warm and curious%%% So what now?`],
    ['doubled closer', `Before.\n%%%warm and curious%%%%%% So what now?`],
    ['stray at the very start', `%%%\n${tag}`],
    ['stray at the very end', `${tag}\n%%%`],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), ['warm and curious'], name + ': ' + JSON.stringify(out));
    assert.doesNotMatch(strip(out), /warm and curious/, name);
    assert.ok(!/%\s*%/.test(strip(out)), name + ' leaves a delimiter: ' + JSON.stringify(strip(out)));
    assert.match(strip(out), /So what now\?/, name);
  }
});

test('glued runs read as closer + opener: two tags back to back, kept apart so nothing downstream mis-pairs them', () => {
  const out = balanceSteeringRuns('%%%warm%%%%%%curious%%% Hello there.');
  assert.deepEqual(pairs(out), ['warm', 'curious']);
  assert.equal(strip(out).trim(), 'Hello there.');
  assert.doesNotMatch(out, /%{4,}/, 'no run of four or more percent signs is ever emitted: ' + JSON.stringify(out));
  assert.deepEqual(pairs(balanceSteeringRuns('%%% warm %%%%%% sad %%% Hello there.')), ['warm', 'sad']);
});

test('a tag that hugs its words is a tag whatever the words are (the first fix rejected these and spoke them)', () => {
  const HUG = ['excited!', 'whispering?', 'SHOUTING!', 'gasp!', 'reset!', 'excited?!', '(excited!)', 'hmm... thinking it over',
    'Dry. Deadpan.', 'gentle Mr. Rogers voice', 'Mr. Rogers', 'Warm and curious.', 'Hesitant...', 'a. b', 'a beat. then warm',
    'тихо', 'απαλά', '温柔地', 'warm and a little amused, like she is leaning back with a smile in her voice while she thinks about how to put this gently and slowly',
    'x'.repeat(390)];
  for (const body of HUG) {
    const out = balanceSteeringRuns(`%%%${body}%%% Oh my gosh, look at that.`);
    assert.deepEqual(pairs(out), [body], body.slice(0, 30));
    assert.equal(squash(strip(out)), 'Oh my gosh, look at that.', body.slice(0, 30));
  }
  // one that wraps keeps its words, joined on one line
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm and\ncurious%%% So what now?')), ['warm and curious']);
  // and its closer is never freed to pair with the next opener across the speech between them
  const two = balanceSteeringRuns('%%%excited!%%% one two %%%calm%%% three four five.');
  assert.deepEqual(pairs(two), ['excited!', 'calm']);
  assert.equal(squash(strip(two)), 'one two three four five.');
});

test('a line break next to a delimiter is padding, not part of the direction', () => {
  for (const [name, input, body, after] of [
    ['break after the opener', '%%%\nwarm%%% Hello there.', 'warm', 'Hello there.'],
    ['break after the opener, longer', '%%%\nwarm and curious%%% Hello there.', 'warm and curious', 'Hello there.'],
    ['fence', 'Before.\n%%%\nwarm and curious\n%%%\nHello there.', 'warm and curious', 'Before. Hello there.'],
    ['fence, two lines', '%%%\nwarm and\ncurious\n%%% Hello there.', 'warm and curious', 'Hello there.'],
    ['break before the closer', '%%%warm and curious\n%%% Hello there.', 'warm and curious', 'Hello there.'],
    ['after a sentence', 'Yes.\n%%%\nwarm%%% Hello there.', 'warm', 'Yes. Hello there.'],
    ['CRLF fence', '%%%\r\nwarm\r\n%%% Hello there.', 'warm', 'Hello there.'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), [body], name + ': ' + JSON.stringify(out));
    assert.equal(squash(strip(out)), after, name);
  }
});

test('an empty tag of six or more is dropped whole and never opens a tag of its own', () => {
  let out = balanceSteeringRuns('%%%%%% I walked in and sat down %%%wry%%% quietly.');
  assert.deepEqual(pairs(out), ['wry']);
  assert.equal(squash(strip(out)), 'I walked in and sat down quietly.');
  out = balanceSteeringRuns('I walked in %%%%%% and sat down %%%%%% quietly.');
  assert.deepEqual(pairs(out), []);
  assert.equal(squash(out), 'I walked in and sat down quietly.');
  out = balanceSteeringRuns('I walked in %%%%%% and sat down %%% quietly.');
  assert.equal(squash(out), 'I walked in and sat down quietly.');
  out = balanceSteeringRuns('I walked in %%%%%% and sat down %%%soft%%% quietly.');
  assert.deepEqual(pairs(out), ['soft']);
  assert.equal(squash(strip(out)), 'I walked in and sat down quietly.');
});

test('polarity: a spare %%% ahead of a tag cannot take that tag\'s opener as its closer', () => {
  for (const [name, input, body, want] of [
    ['two spaced strays', 'Hi %%% %%% there %%%wry%%% x', 'wry', 'Hi there x'],
    ['strays on lines', 'I walked in %%%\n%%% and sat down %%%wry%%% quietly.', 'wry', 'I walked in and sat down quietly.'],
    ['spaced stray, sentence, tag', 'hey. %%% i hope you are well. %%%warm%%% okay then.', 'warm', 'hey. i hope you are well. okay then.'],
    ['stray line, sentence, padded tag', 'Hello.\n%%%\nThe paper trail is thin. %%% soft but sure %%%\nOkay then.', 'soft but sure', 'Hello. The paper trail is thin. Okay then.'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), [body], name + ': ' + JSON.stringify(out));
    assert.equal(squash(strip(out)), want, name);
  }
});

test('speech between strays stays speech; a capitalised direction on its own stays a direction', () => {
  // strays or separators on the lines around real speech: nothing is swallowed
  assert.equal(speech('Para one is here.\n%%%\nThat is on me.\n%%%\nPara three is here.'), 'Para one is here. That is on me. Para three is here.');
  assert.equal(speech('Before.\n%%\nSo what is the shape of it?\n%%\nAfter.'), 'Before. So what is the shape of it? After.');
  assert.equal(speech('%%% Two sentences here. And another one. %%% Then more.'), 'Two sentences here. And another one. Then more.');
  assert.equal(speech('I said %%% yes, I did. %%%wry%%% Then I left.'), 'I said yes, I did. Then I left.');
  // a direction that happens to be capitalised or punctuated, padded or fenced, is still a direction
  for (const input of ['%%% Warm and curious. %%% Oh my gosh.', '%%%whispering? %%% Oh my gosh.', '%%% Hesitant... %%% Oh my gosh.']) {
    assert.equal(pairs(balanceSteeringRuns(input)).length, 1, input);
    assert.equal(speech(input), 'Oh my gosh.', input);
  }
  assert.equal(speech('%%%\nwhispering?\n%%% Oh my gosh.'), 'Oh my gosh.');
  // a style that pads every tag keeps every tag
  assert.deepEqual(pairs(balanceSteeringRuns('%%% Warm and curious. %%% Hello. %%% Soft. %%% Bye.')), ['Warm and curious.', 'Soft.']);
});

test('a reply that writes tight tags: a loose sentence between two runs is two strays, however short the sentence', () => {
  // real replies: the model writes %%%pleased%%% and the strays land inline around ordinary sentences
  const msg = "%%%pleased%%% I saved you the blue one. %%% Everybody wanted blue, so I put it under my notebook before they came over. %%% You can trade me if you'd rather have green.";
  const out = balanceSteeringRuns(msg);
  assert.deepEqual(pairs(out), ['pleased']);
  assert.equal(squash(strip(out)), "I saved you the blue one. Everybody wanted blue, so I put it under my notebook before they came over. You can trade me if you'd rather have green.");
  assert.equal(speech('%%%curious%%% Do you think the fish knows? %%% It keeps coming over. %%% Maybe we are the show.'), 'Do you think the fish knows? It keeps coming over. Maybe we are the show.');
  // with no tight tag anywhere, the same loose pair is the model's own padded style
  assert.deepEqual(pairs(balanceSteeringRuns('Hello. %%% Yeah, you are right. %%% Bye.')), ['Yeah, you are right.']);
});

test('a forgotten closer is closed when speech follows, and conversation is never taken for a direction', () => {
  for (const [name, input, body, want] of [
    ['speech right after', '%%%warm Hello there, friend.', 'warm', 'Hello there, friend.'],
    ['longer direction', 'Okay. %%%warm and curious So what now?', 'warm and curious', 'Okay. So what now?'],
    ['after a sentence, line break', 'Okay. %%%warm\nGo on.', 'warm', 'Okay. Go on.'],
    ['behind spaced strays', 'Hi.\n%%% %%%warm\nBye.', 'warm', 'Hi. Bye.'],
    ['alone at the end', 'Hello there. %%%warm', 'warm', 'Hello there.'],
    ['two openers, one closer', '%%%warm %%%sad%%% Hello there, friend.', 'sad', 'Hello there, friend.'],
    ['a short reply with no full stop', '%%%warm Thanks Kade', 'warm', 'Thanks Kade'],
    ['an unpunctuated line', '%%%warm and curious So what do you think', 'warm and curious', 'So what do you think'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.ok(pairs(out).includes(body), name + ': ' + JSON.stringify(out));
    assert.doesNotMatch(strip(out), /\bwarm\b/, name + ' speaks the direction: ' + JSON.stringify(out));
    assert.equal(squash(strip(out)), want, name);
  }
  // a stray glued to lowercase speech has the same shape: the first word tells them apart
  for (const input of ['%%%yeah Kade, I think so.', 'Okay.\n%%%okay so what do You think?', '%%%well Honestly it is fine.', '%%%you know what Kade said.', '%%%I think so too, Kade.',
    '%%%yeah Thanks Kade', '%%%okay\nSo what now?', '%%%you know\nit is fine']) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), [], input);
    assert.equal(squash(out.replace(/%+/g, '')), squash(input.replace(/%+/g, '')), input);
  }
  // all-lowercase speech after the words, or a long direction: nothing shows where the direction ends, so nothing is guessed
  assert.deepEqual(pairs(balanceSteeringRuns('Hi. %%%warm and so then we went home')), []);
  assert.deepEqual(pairs(balanceSteeringRuns('Hi. %%%interested like she is leaning in Hello there.')), []);
});

test('the tail of a tag cut in half by a chunker comes back as a direction, and speech is never taken for one', () => {
  for (const [name, input, body, want] of [
    ['cut inside the body', 'curious%%% So what is the shape of it?', 'curious', 'So what is the shape of it?'],
    ['cut right after the opener', 'warm and curious%%% So what is the shape of it?', 'warm and curious', 'So what is the shape of it?'],
    ['the tail starts with a connective', 'and hopeful%%% I practiced that bit all week.', 'and hopeful', 'I practiced that bit all week.'],
    ['the tail starts with a pronoun', 'she is leaning in%%% Go on, I am listening.', 'she is leaning in', 'Go on, I am listening.'],
    ['a forgotten opener is the same shape', 'to correct with respect%%% Yeah, that is on me.', 'to correct with respect', 'Yeah, that is on me.'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), [body], name + ': ' + JSON.stringify(out));
    assert.equal(squash(strip(out)), want, name);
  }
  // but speech with a stray glued to it stays speech: a capital start, a sentence, an interjection, I or you
  for (const input of ['Hello there friend%%% how are you', 'yeah%%% I know what you mean', 'Okay.%%% Next one', 'I think so%%% maybe', 'you know%%% it is fine', 'two. words%%% here', 'a b c d e f g h i j k%%% too long to be a direction']) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
  }
});

test('a bare closer, the iPhone re-stamp and a prep-glued punctuation line never swallow the speech after them', () => {
  for (const [input, want] of [
    ['%%% I spent twenty minutes looking for my', 'I spent twenty minutes looking for my'],        // a chunk that starts on a bare closer
    ['%%%\n%%% Talk soon', 'Talk soon'],                                                           // the iPhone stamps its carried "\n" direction
    ['%%% Okay\n\nHere is the plan.', 'Okay Here is the plan.'],
    ['%%%yeah Thanks Kade', 'yeah Thanks Kade'],
    ['Hello there.\n\n%%%...and then\n\nThe end.', 'Hello there. ...and then The end.'],           // the preparation step glued a newline away
    ['Hello there.\n\n%%%, and then we go.', 'Hello there. , and then we go.'],
  ]) assert.equal(speech(input), want, input);
  const stamped = balanceSteeringRuns('%%%\n%%%warm%%% Okay then.\n\nTalk soon');
  assert.deepEqual(pairs(stamped), ['warm']);
  assert.equal(squash(strip(stamped)), 'Okay then. Talk soon');
});

test('a full stop after a few lowercase words means a sentence, so a stray in front of one is never a direction', () => {
  for (const [input, want] of [
    ['%%%great.', 'great.'],
    ['%%%great, thanks.', 'great, thanks.'],
    ['%%%sorry Mom, that was rude.', 'sorry Mom, that was rude.'],
    ['Hello there.\n%%%alright then.', 'Hello there. alright then.'],
    ['%%%sorry, Mom said so.', 'sorry, Mom said so.'],
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
    assert.equal(speech(input), want, input);
  }
});

test('red team round 2: each confirmed failure of the first rewrite stays fixed', () => {
  // the tail of a cut tag needs the speech a tag leads into after it (a capital or a line break): lowercase
  // words, a stray and lowercase speech are just speech
  for (const input of ['see you%%% soon.', 'thinking about it%%% okay then.', 'the price is about half%%% of it', 'see you tomorrow%%%']) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
  }
  assert.equal(speech('see you%%% soon.'), 'see you soon.');
  // a cut between the percent signs of a delimiter leaves one percent sign at an end of the piece
  assert.deepEqual(pairs(balanceSteeringRuns('%curious%%% So what now?')), ['curious']);
  assert.deepEqual(pairs(balanceSteeringRuns('Hello there. %%%warm and curious%')), ['warm and curious']);
  assert.equal(speech('%curious%%% So what now?'), 'So what now?');
  assert.equal(balanceSteeringRuns('Sales are up 50%'), 'Sales are up 50%');                         // a real percentage is left alone
  assert.equal(balanceSteeringRuns('It is 50 % of it %%%warm%%% Hi'), 'It is 50 % of it %%%warm%%% Hi');
  // a stray glued to a capitalised line, or in front of a lowercase fragment, is no unclosed direction
  assert.equal(speech('Hi.\n%%%Talk soon'), 'Hi. Talk soon');
  assert.equal(speech('Hello there.\n\n%%% ha'), 'Hello there. ha');
  // doubled percent signs in prose never pair (the old pairing paired a non-triple run only when it hugged its words)
  assert.deepEqual(pairs(balanceSteeringRuns('half%% of it, then %% some')), []);
  assert.equal(speech('It is about half%% of the time and often%% not.'), 'It is about half of the time and often not.');
  assert.deepEqual(pairs(balanceSteeringRuns('%%warm%% Hi there.')), ['warm']);                     // but a hugging pair of two still is a tag
  // two forgotten closers in a row are two directions with their speech, not one tag
  const two = balanceSteeringRuns('%%%amused Thanks.\n\n%%%calm Bye.');
  assert.deepEqual(pairs(two), ['amused', 'calm']);
  assert.equal(squash(strip(two)), 'Thanks. Bye.');
  // the reply-style rule is for sentences of four words or more: a short capitalised direction stays a direction
  assert.deepEqual(pairs(balanceSteeringRuns('%%%dry%%% Fine. %%% Warm. %%% Done.')), ['dry', 'Warm.']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%dry%%% Fine. %%% excited! %%% Done.')), ['dry', 'excited!']);
  // polarity does not fire on a well-formed reply whose second tag is glued to the sentence before it
  const glued = balanceSteeringRuns('%%%warm %%%Hi.%%%sad%%% Bye.');
  assert.deepEqual(pairs(glued), ['warm', 'sad']);
  assert.equal(squash(strip(glued)), 'Hi. Bye.');
  // a forgotten closer: a comma or colon after the words, a lone % as the closer, a tag just before
  for (const [input, body, want] of [
    ['%%%warm, So what now?', 'warm', 'So what now?'],
    ['%%%warm: So what now?', 'warm', 'So what now?'],
    ['%%%pleased% I saved you the blue one.', 'pleased', 'I saved you the blue one.'],
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [body], input);
    assert.equal(speech(input), want, input);
  }
  assert.deepEqual(pairs(balanceSteeringRuns('%%%soft%%% %%%warm So what now?')), ['soft', 'warm']);
});

test('speech is never swallowed: an opener followed by a sentence, or by a long line, is only a stray', () => {
  assert.equal(strip(balanceSteeringRuns('%%% Hello there, how are you.\nNext line.')).replace(/\s+/g, ' ').trim(), 'Hello there, how are you. Next line.');
  const long = 'This is a long line of ordinary speech that goes on well past eighty characters without any punctuation at all really';
  assert.equal(strip(balanceSteeringRuns('%%%' + long + '\nNext.')).replace(/\s+/g, ' ').trim(), long + ' Next.');
  assert.equal(strip(balanceSteeringRuns('Before %%% after')).replace(/\s+/g, ' ').trim(), 'Before after');
});

test('a tag whose closer was forgotten, alone on a short line, is still a direction', () => {
  const out = balanceSteeringRuns('Before.\n%%%warm and curious\nSo what now? It is up to you.\n\n%%%soft%%% And after.');
  assert.deepEqual(pairs(out), ['warm and curious', 'soft']);
  assert.doesNotMatch(strip(out), /warm and curious/);
  assert.match(strip(out), /So what now\? It is up to you\./);
  assert.match(strip(out), /And after\./);
  const own = balanceSteeringRuns('Before.\n%%%warm and curious\n%%%\nSo what now?');
  assert.deepEqual(pairs(own), ['warm and curious']);
  assert.doesNotMatch(strip(own), /warm and curious/);
  assert.match(strip(own), /So what now\?/);
  assert.doesNotMatch(strip(balanceSteeringRuns('Before.\n%%%warm and curious')), /warm and curious/);
});

test('a dropped stray never fuses the words around it, and a real percentage is left alone', () => {
  assert.equal(balanceSteeringRuns('I hope%%%you are well.'), 'I hope you are well.');
  assert.equal(balanceSteeringRuns('50% of it, and 100% of the rest'), '50% of it, and 100% of the rest');
  assert.equal(squash(balanceSteeringRuns('Hello %%% there')), 'Hello there');
});

test('repairs are reported to an optional logger, and a logger can never break a message', () => {
  const seen = [];
  setRepairLogger((s) => seen.push(s));
  try {
    balanceSteeringRuns('%%%warm%%% Hello.');   // well-formed: nothing to report
    balanceSteeringRuns('just words');
    assert.deepEqual(seen, []);
    balanceSteeringRuns('Hi.\n\n%%%\n%%%warm%%% So.');
    balanceSteeringRuns('%%%warm Hello there, friend.');
    assert.deepEqual(seen, [{ strays: 1, closed: 0 }, { strays: 0, closed: 1 }]);
    setRepairLogger(() => { throw new Error('boom'); });
    assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n%%%\n%%%warm%%% So.')), ['warm']);
  } finally {
    setRepairLogger(null);
  }
});

test('a big message with thousands of tags or strays is balanced in well under a second or two', () => {
  const t0 = Date.now();
  balanceSteeringRuns('%%%warm%%% a '.repeat(20000));
  balanceSteeringRuns('hello there %%% friend\n%%%\n'.repeat(20000));
  balanceSteeringRuns('%'.repeat(300000));
  balanceSteeringRuns('%%%' + ' '.repeat(100000) + 'warm%%% Hello there.');
  assert.ok(Date.now() - t0 < 4000, 'took ' + (Date.now() - t0) + ' ms');
});

test('pins: behaviours a mutation sweep of the code showed nothing was holding', () => {
  // sentenceStart is real: an opener in the middle of a sentence is not a forgotten closer
  assert.equal(speech('I think %%%quietly Kade is here.'), 'I think quietly Kade is here.');
  // the speech a tag leads into must come after a space or a line break: glued speech is no cut tail
  assert.deepEqual(pairs(balanceSteeringRuns('curious%%%So what is the shape of it?')), []);
  // a closer-shaped run of six or more at the start is not a tail either
  assert.deepEqual(pairs(balanceSteeringRuns('warm%%%%%%%% So what')), []);
  // a forgotten-closer head ends at a parenthesis, a quote, an inverted mark or any capital letter (not a multiplication sign)
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm (laughs) Hello')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm "Hello" she said')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm ¿Y tú?')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('Okay. %%%warm × 5')), []);
  // a closer only counts as the opener of the next tag when a space comes before it
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm%%%Hello there.%%% sad%%% x')), ['warm', 'sad']);
  // a lone % at an edge: dropped when it hugs its word, left alone beside a digit or after a space
  assert.equal(balanceSteeringRuns('%\n%%%warm%%% Hi'), '\n%%%warm%%% Hi');
  assert.equal(balanceSteeringRuns('Hi %%%warm%%% there.%'), 'Hi %%%warm%%% there.');
  assert.equal(balanceSteeringRuns('Hi %%%warm%%% It grew by ninety %'), 'Hi %%%warm%%% It grew by ninety %');
  assert.equal(balanceSteeringRuns('Up 5%\n%%%warm%%% Hi'), 'Up 5%\n%%%warm%%% Hi');
  // a sentence can start after a colon, an ellipsis or a tag
  for (const [input, body] of [['x: %%%warm Hello', 'warm'], ['Okay… %%%warm Hello there.', 'warm'], ['%%%soft%%% %%%warm Hello there.', 'warm']]) {
    assert.ok(pairs(balanceSteeringRuns(input)).includes(body), input);
  }
  // an indented or CRLF line start is a line start
  assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n  %%%warm\nBye.')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('Hi.\r\n%%%warm\r\nBye.')), ['warm']);
  // one word of any length is not a direction: a 500-letter word after an opener stays speech
  assert.deepEqual(pairs(balanceSteeringRuns('%%%' + 'a'.repeat(500))), []);
  // a tab or a no-break space between words hides nothing from the speech-opener check
  assert.deepEqual(pairs(balanceSteeringRuns('%%%so\tb')), []);
  assert.deepEqual(pairs(balanceSteeringRuns('Okay.\n%%%yeah\u00a0Kade, I think so')), []);
  assert.equal(pairs(balanceSteeringRuns('%%%warm\tand\tcurious Hello')).length, 1);        // a direction whose words are tab-separated is one
  assert.equal(speech('%%%warm\tand\tcurious Hello'), 'Hello');
  // an abbreviation's full stop is not a sentence end, and a padded direction that names someone is an ordinary tag:
  // both were tags for the old pairing, and the balancer must never be worse than that
  assert.deepEqual(pairs(balanceSteeringRuns('%%% gentle Mr. Rogers voice %%% Hello there, friend.')), ['gentle Mr. Rogers voice']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%% warm, like talking to Kade. %%% Hello there, friend.')), ['warm, like talking to Kade.']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%% in a Southern drawl. %%% Hi.')), ['in a Southern drawl.']);
  // but with the opener hugging its words that shape is a forgotten closer followed by speech
  assert.deepEqual(pairs(balanceSteeringRuns('%%%amused Thanks.\n\n%%%calm Bye.')), ['amused', 'calm']);
  // a question closed by what plainly opens the next tag is speech, like a sentence is
  assert.equal(speech('Okay. %%% What is the shape of it? %%%warm Hello there.'), 'Okay. What is the shape of it? Hello there.');
  // no space before punctuation where a dropped stray sat
  assert.equal(balanceSteeringRuns('Hello%%%, friend'), 'Hello, friend');
  // a fenced capitalised body: a direction in a reply with no tight tag, speech when the reply writes tight tags or the line is a sentence
  assert.deepEqual(pairs(balanceSteeringRuns('Okay.\n%%%\nWhispering\n%%%\nSo what now?')), ['Whispering']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm%%% Hello.\n%%%\nWhispering\n%%%\nSo what now?')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('Okay.\n%%%\nYes.\n%%%\nSo what now?')), []);
  assert.deepEqual(pairs(balanceSteeringRuns('Okay.\n%%%\nGood morning Sam\n%%%\nBye.')), []);
  // a lowercase fragment that ends in a full stop is no direction, so a stray in a sentence does not pair with a later tag
  assert.equal(speech('I would go %%% and look.\n\n%%% warm %%% Two.'), 'I would go and look. Two.');
});

test('KADE_STEERING_BALANCE=0 is the kill switch: every text goes on untouched, exactly the old pairing', () => {
  const incident = 'Before.\n\n%%%\n%%%warm and curious%%% So what now?';
  assert.deepEqual(pairs(balanceSteeringRuns(incident)), ['warm and curious']);
  const was = process.env.KADE_STEERING_BALANCE;
  process.env.KADE_STEERING_BALANCE = '0';
  try {
    assert.equal(balanceSteeringRuns(incident), incident);
    assert.equal(balanceSteeringRuns('curious%%% So what now?'), 'curious%%% So what now?');
    process.env.KADE_STEERING_BALANCE = '1';
    assert.deepEqual(pairs(balanceSteeringRuns(incident)), ['warm and curious']);   // only "0" switches it off
  } finally {
    if (was === undefined) delete process.env.KADE_STEERING_BALANCE; else process.env.KADE_STEERING_BALANCE = was;
  }
});

test('a request too big to be speech is handed on untouched, so it can never hold up other listeners', () => {
  const big = '%%a'.repeat(300000);                        // 900,000 characters
  const t0 = Date.now();
  assert.equal(balanceSteeringRuns(big), big);
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n%%%\n%%%warm%%% So.' + ' word'.repeat(1000))), ['warm']); // still balanced just under it
});

test('a forgotten-closer line needs a run that hugs it: a spaced run before a casual line is just a stray', () => {
  for (const [input, want] of [
    ['Hi.\n%%% lol thats wild\nOkay then.', 'Hi. lol thats wild Okay then.'],
    ['Hi.\n%%% omg wait what', 'Hi. omg wait what'],
    ['%%%warm%%% Hello.\n%%% see you tomorrow', 'Hello. see you tomorrow'],
  ]) assert.equal(speech(input), want, input);
  assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n%%%warm and curious\nOkay then.')), ['warm and curious']); // the hugging form still is one
});

test('the helpers: what counts as a direction body and as an unclosed line', () => {
  assert.equal(tagBody('warm and curious'), 'warm and curious');
  assert.equal(tagBody('  quietly  '), 'quietly');
  for (const bad of ['', ' ', '\n', '12', ' two\nlines ', 'x'.repeat(500)]) assert.equal(tagBody(bad), null, JSON.stringify(bad.slice(0, 12)));
  assert.equal(tagBody('two\nlines'), 'two lines', 'a body that hugs both delimiters may wrap');
  assert.equal(tagBody('excited!'), 'excited!');
  assert.equal(tagBody('тихо'), 'тихо');
  assert.equal(unclosedLine('warm and curious\nSo what?'), 'warm and curious');
  assert.equal(unclosedLine('Hello there.\nNext'), null);
  assert.equal(unclosedLine('\nwarm'), null);
  assert.equal(unclosedLine('fond and a little emotional She walked in'), null, 'a capital means speech runs on');
  assert.equal(unclosedLine('fond and a little emotional\nSo what now?'), 'fond and a little emotional', 'five words alone on a line');
});

// ── delta round (Nov 6, the chunker attacker): the iPhone's re-stamped bare newline and a late stray ─────────
test('the iPhone re-stamp %%%\\n%%% is an empty pair: a stray later in the piece cannot close it around the sentence', () => {
  // the stamp is the end of an empty tag, not the opener of a padded tag around the sentence after it; the old
  // pairing dropped the pair and spoke every word, and so must we, whatever kind of stray follows
  for (const [input, want] of [
    ['%%%\n%%% See you soon. %%%', 'See you soon.'],
    ["%%%\n%%% Some of them are labeled in his handwriting, but the names don't match anything I know.%%%", "Some of them are labeled in his handwriting, but the names don't match anything I know."],
    ['%%%\n%%% You made it. %%% I saved you the chair by the heater.', 'You made it. I saved you the chair by the heater.'],
    ['%%%\n%%% Hello%%% there.', 'Hello there.'],
    ['%%%\n%%% "Yes," she said. %%%', '"Yes," she said.'],
    ['%%%\n%%% 5 minutes later. %%%', '5 minutes later.'],
    ['Hello there.\n\n%%%\n%%% Okay then. More.\n\n%%%\nEnd.', 'Hello there. Okay then. More. End.'],
    ['%%%\n%%% Talk soon', 'Talk soon'],                                       // the stamp alone, as before
    ['%%% \n %%% Talk soon. %%%', 'Talk soon.'],                                // blanks around the line break
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
    assert.equal(speech(input), want, input);
  }
  // an opener that hugs its words is a tag, so a stray line before one is still only a stray (the Kiana shape),
  // and a stray line before a padded direction written in lowercase is still repaired
  assert.deepEqual(pairs(balanceSteeringRuns('%%%\n%%%warm%%% Okay then.')), ['warm']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%\n%%% a little amused %%% Hello there.')), ['a little amused']);
  // six or more is the empty-tag rule above, and a letter between the runs makes it a span to judge, not an empty pair
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm%%% Fine. %%%\n%%% Okay then. %%%dry%%% Done.')), ['warm', 'dry']);
});

test('a forgotten closer whose line has a capital in it is speech after a stray, not a direction', () => {
  for (const [input, want] of [
    ['%%%fond and a little emotional She walked in without looking back', 'fond and a little emotional She walked in without looking back'],
    ['%%%matter of fact and friendly So for the beans, you want the onion in first, and ', 'matter of fact and friendly So for the beans, you want the onion in first, and'],
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);     // the direction words leak, as with the old pairing, but no speech is lost
    assert.equal(speech(input), want, input);
  }
  assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n%%%warm and curious\nSo what now?')), ['warm and curious']); // an all-lowercase line still is one
});

// ── final review (Nov 6): a forgotten closer at the start of a line, and the lone percent sign ────────────────
test('a forgotten closer at the start of a line swallows no speech that runs on after the words', () => {
  // the whole-line rule takes plain lowercase words only, nine at most, four at the very end of a text; a capital,
  // a dash, a bracket, an emoji or a long line means the speech runs on, and then the direction is just spoken
  // (as the old pairing did) instead of the speech being lost with it
  for (const input of [
    '%%%warm and so then we went home',                                                // seven words at the end of the text
    '%%%interested like she is leaning in Hello there',
    '%%%warm - Thanks Kade',
    '%%%warm [laughs] Thanks Kade',
    '%%%warm \u{1F600} Thanks Kade',
    '%%%warm and so then we went home today to see\nSo what now?',                     // ten words, even with a line break after
    'Okay, that makes sense.\n\n%%%interested like she is leaning in Hello there my friend',
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
    assert.equal(speech(input), squash(input.replace(/%%%/g, '')), 'every word is spoken: ' + input);
  }
  // but a direction alone on its line, with the speech on the next, is still closed (up to nine words)
  assert.deepEqual(pairs(balanceSteeringRuns('%%%fond and a little emotional\nSo what now?')), ['fond and a little emotional']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%one two three four five six seven eight nine\nSo what now?')), ['one two three four five six seven eight nine']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%one two three four five six seven eight nine ten\nSo what now?')), []);
  // and four words at the very end of a text, five not
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm and soft again')), ['warm and soft again']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%warm and soft again now')), []);
  // the helper: one word of 80 letters is a line, 81 is not
  assert.equal(unclosedLine('a'.repeat(80) + '\nx'), 'a'.repeat(80));
  assert.equal(unclosedLine('a'.repeat(81) + '\nx'), null);
  for (const bad of ['warm - Thanks\nx', 'warm [laughs]\nx', 'warm \u{1F600}\nx', 'Warm\nx', 'warm.\nx', '5 more\nx']) assert.equal(unclosedLine(bad), null, JSON.stringify(bad));
  assert.equal(unclosedLine('warm 5 more\nx'), 'warm 5 more');
  assert.equal(unclosedLine('one two three four five six seven eight nine ten\nx'), null);
  assert.equal(unclosedLine('one two three four five'), null, 'five words at the very end of a text');
  assert.equal(unclosedLine('one two three four'), 'one two three four');
});

test('a lone percent sign at an end of a piece that holds a tag: the rest of a delimiter goes, a percentage stays', () => {
  const kept = [
    'It rose 50%',
    '%%%warm%%% It rose 50%',
    '%%%warm%%% It rose 50 %',
    '%%%warm%%% It grew by ninety %',
    '%%%warm%%% It grew by ninety%',
    '%%%warm%%% It grew by seventeen %',
    '%%%warm%%% It grew by ninety	%',
    '%%%warm%%% Half %',
    '%%%warm%%% A quarter%',
    '%5 more\n%%%warm%%% x',
    '%%%warm%%% It was 100%\n',
  ];
  for (const s of kept) assert.equal(balanceSteeringRuns(s), s, s);
  for (const [input, want] of [
    ['%%%watchful%%% Fog came %', '%%%watchful%%% Fog came '],
    ['%%%warm%%% Two problems.\n\n%', '%%%warm%%% Two problems.\n\n'],
    ['%%%warm%%% It was a bone %', '%%%warm%%% It was a bone '],           // `bone` ends in `one` but is not a number
    ['%%%warm%%% Hello there. %', '%%%warm%%% Hello there. '],
    ['%curious%%% So what now?', '%%%curious%%% So what now?'],
    ['% So what now? %%%warm%%% Hi', ' So what now? %%%warm%%% Hi'],
  ]) assert.equal(balanceSteeringRuns(input), want, input);
});

test('a logger that returns a rejected promise cannot break a message either', async () => {
  const seen = [];
  const onRejection = (e) => seen.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    setRepairLogger(() => Promise.reject(new Error('logger down')));
    assert.deepEqual(pairs(balanceSteeringRuns('Hi.\n%%%\n%%%warm%%% So.')), ['warm']);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, []);
  } finally {
    setRepairLogger(null);
    process.off('unhandledRejection', onRejection);
  }
});

test('pins from the final review: the newest rules at their edges (a hand mutation sweep found nothing holding them)', () => {
  const NB = '\u00a0';
  const w = (n, word) => Array.from({ length: n }, (_, i) => word || 'w' + i).join(' ');
  const plain = (s) => s.replace(/\u00a0/g, ' ');
  for (const [input, wantPairs, wantSpeech] of [
    // fences and sentences: capitals, questions, ellipses, other alphabets
    ['Okay.\n%%%\nReally?\n%%%\nSo what now?', [], 'Okay. Really? So what now?'],
    ['Okay.\n%%%\nGood morning\n%%%\nBye.', ['Good morning'], 'Okay. Bye.'],
    ['Okay.\n%%%\nwhat is that?\n%%%\nBye.', [], 'Okay. what is that? Bye.'],
    ['Okay.\n%%%\nHesitant...\n%%%\nSo what now?', ['Hesitant...'], 'Okay. So what now?'],
    ['%%%pleased%%% Hi.\n%%%\nÉcoute\n%%%\nBye.', ['pleased'], 'Hi. Écoute Bye.'],
    ['I said %%% It is. Go now %%% yes', [], 'I said It is. Go now yes'],
    ['I said %%% Yes it is. Éric left today %%% yes', [], 'I said Yes it is. Éric left today yes'],
    ['I said %%% It is. ¿Que tal? %%% yes', [], 'I said It is. ¿Que tal? yes'],
    ['I said %%% He said. “Yes” Then more %%% yes', [], 'I said He said. “Yes” Then more yes'],
    ['I said %%% He said "stop." Then left today %%% yes', [], 'I said He said "stop." Then left today yes'],
    // a forgotten closer with speech after it: blanks, capitals and marks of other alphabets, word shapes
    ['Hi. %%%warm' + NB + 'and' + NB + 'curious' + NB + 'Hello there.', ['warm and curious'], 'Hi. Hello there.'],
    ['Hi. %%%warm' + NB, ['warm'], 'Hi.'],
    ['%%%warm' + NB + 'Hello there', ['warm'], 'Hello there'],
    ['%%%warm ÉPICO', ['warm'], 'ÉPICO'],
    ['%%%warm ¡Gracias!', ['warm'], '¡Gracias!'],
    ['%%%warm ' + 'x'.repeat(45) + ' Hello', [], 'warm ' + 'x'.repeat(45) + ' Hello'],
    ['%%%a b c d Hello there.', ['a b c d'], 'Hello there.'],
    ['%%%a b c d e Hello there.', [], 'a b c d e Hello there.'],
    ['%%%yeah\tso Hello', [], 'yeah so Hello'],
    ['%%%i’m sure, Kade.', [], 'i’m sure, Kade.'],
    ['Hi. %%%amused ¡Gracias! %%% Bye.', ['amused'], 'Hi. ¡Gracias! Bye.'],
    ['Hi. %%%amused Éxito. %%% Bye.', ['amused'], 'Hi. Éxito. Bye.'],
    // the tail of a cut tag
    ['curious' + NB + 'and' + NB + 'soft%%% Hello', ['curious and soft'], 'Hello'],
    ['curious%%% ¿Y tu?', ['curious'], '¿Y tu?'],
    ['curious%%% Él dijo', ['curious'], 'Él dijo'],
    ['yeah\tso%%% Hello', [], 'yeah so Hello'],
    ['a'.repeat(40) + ' ' + 'a'.repeat(40) + ' ' + 'a'.repeat(38) + '%%% Hello', ['a'.repeat(40) + ' ' + 'a'.repeat(40) + ' ' + 'a'.repeat(38)], 'Hello'],      // 120 characters
    ['a'.repeat(40) + ' ' + 'a'.repeat(40) + ' ' + 'a'.repeat(39) + '%%% Hello', [], 'a'.repeat(40) + ' ' + 'a'.repeat(40) + ' ' + 'a'.repeat(39) + ' Hello'], // 121
    ['curious%%%' + ' '.repeat(7) + 'Hello there', ['curious'], 'Hello there'],
    ['curious%%%' + ' '.repeat(8) + 'Hello there', [], 'curious Hello there'],
    ['soft%%%%%\n\nHello', ['soft'], 'Hello'],
    ['soft%%%%%%\n\nHello', [], 'soft Hello'],
    // a stray next to a typographic apostrophe is part of the word, so no space goes in
    ['you%%%’re right', [], 'you’re right'],
    ['you’%%%re right', [], 'you’re right'],
    // the sizes: 70 words / 400 characters tight, 24 words / 200 characters loose, 80 characters on a line, 3 lines in a fence
    ['%%%' + w(70) + '%%% Hi.', [w(70)], 'Hi.'],
    ['%%%' + w(71) + '%%% Hi.', [], w(71) + ' Hi.'],
    ['%%%' + 'x'.repeat(400) + '%%% Hi.', ['x'.repeat(400)], 'Hi.'],
    ['%%%' + 'x'.repeat(401) + '%%% Hi.', [], 'x'.repeat(401) + ' Hi.'],
    ['Hi. %%% ' + w(24, 'a') + ' %%% Bye.', [w(24, 'a')], 'Hi. Bye.'],
    ['Hi. %%% ' + w(25, 'a') + ' %%% Bye.', [], 'Hi. ' + w(25, 'a') + ' Bye.'],
    ['Hi. %%% ' + 'x'.repeat(200) + ' %%% Bye.', ['x'.repeat(200)], 'Hi. Bye.'],
    ['Hi. %%% ' + 'x'.repeat(201) + ' %%% Bye.', [], 'Hi. ' + 'x'.repeat(201) + ' Bye.'],
    ['%%%' + 'a'.repeat(80), ['a'.repeat(80)], ''],
    ['%%%' + 'a'.repeat(81), [], 'a'.repeat(81)],
    ['Hi.\n%%%\na\nb\nc\n%%%\nBye.', ['a b c'], 'Hi. Bye.'],
    ['Hi.\n%%%\na\nb\nc\nd\n%%%\nBye.', [], 'Hi. a b c d Bye.'],
    // the reply's own style: a pair of twelve words is prose, not a tight tag, so it does not make the reply "tight"
    ['%%%' + w(12) + '%%% Hi. %%% This is a four word sentence. %%% Bye.', [w(12), 'This is a four word sentence.'], 'Hi. Bye.'],
    ['%%%pleased%%% Hi there. %%% Hello there. %%%\nWarm\n%%% Bye now.', ['pleased', 'Hello there.'], 'Hi there. Warm Bye now.'],
    ['%%%Everybody wanted blue and so I put it away.%%% Hi there. %%% Everybody wanted green, so I put it under my notebook. %%% Bye now.',
      ['Everybody wanted blue and so I put it away.', 'Everybody wanted green, so I put it under my notebook.'], 'Hi there. Bye now.'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out).map(plain), wantPairs, JSON.stringify(input).slice(0, 80));
    assert.equal(plain(squash(strip(out))), wantSpeech, JSON.stringify(input).slice(0, 80));
  }
  // the size guard sits at 150,000 characters: a text just under it is balanced, one over it goes on untouched
  const filler = (n) => 'x '.repeat(n / 2);
  const under = 'Hi.\n%%%\n%%%warm%%% So. ' + filler(149000);
  const over = 'Hi.\n%%%\n%%%warm%%% So. ' + filler(151000);
  assert.deepEqual(pairs(balanceSteeringRuns(under)), ['warm']);
  assert.equal(balanceSteeringRuns(over), over);
});

// ── delta round, batch 2: two strays in one reply, and the layouts the new rules turned away ────────────────
test('two strays in one reply: a long closer, far-apart doubled signs, lowercase exclamations, half fences', () => {
  const filler = 'I have been meaning to tell you about the pie and the long road and the weather and the cat and the dog and the bird and the fish and the whole big day';
  for (const [input, wantPairs, wantSpeech] of [
    // a tag closer extended by a stray, then a second stray: nothing for the extra signs to open, so no sentence is lost
    ['%%%happy zqaa%%%%%%% Yes.%%%', ['happy zqaa'], 'Yes.'],
    ['%%%calm zqab%%%%%%% The ferry had not begun boarding %%% yet.', ['calm zqab'], 'The ferry had not begun boarding yet.'],
    ['%%%warm and curious%%%%%% So what now?', ['warm and curious'], 'So what now?'],
    // but two tags written back to back are still two tags (a word touches the run, or the first one is padded)
    ['%%%warm zq1x%%%%%%sad zq2x%%% Hello there, friend.', ['warm zq1x', 'sad zq2x'], 'Hello there, friend.'],
    ['%%% warm %%%%%% sad %%% Hello there.', ['warm', 'sad'], 'Hello there.'],
    // two doubled strays that hug words are a tag only within 160 characters on one line, as the old normaliser had it
    ['%%%pleased zqaa%%% Hello %%there friend.\n\nHow are you%% today?', ['pleased zqaa'], 'Hello there friend. How are you today?'],
    ['Hello %%there friend, ' + filler + ' and the rest of the tale. How are you%% today?', [], 'Hello there friend, ' + filler + ' and the rest of the tale. How are you today?'],
    ['Hello %%there friend%% today', ['there friend'], 'Hello today'],
    ['%%warm%% Hi there.', ['warm'], 'Hi there.'],
    // an abbreviation: a lowercase direction keeps it, a capitalised sentence with one is speech
    ['%%% gentle Mr. Rogers voice %%% Oh my gosh, look at that.', ['gentle Mr. Rogers voice'], 'Oh my gosh, look at that.'],
    ['%%%\ngentle Mr. Rogers voice\n%%%\nOh my gosh, look at that.', ['gentle Mr. Rogers voice'], 'Oh my gosh, look at that.'],
    ['I said %%% Dr. Smith went home today. %%% yes', [], 'I said Dr. Smith went home today. yes'],
    // a lowercase direction ending in ! or ? and closed with a space before the closer is a direction; a capitalised one is not
    ['%%% so very excited zqaa! %%%Hello there.', ['so very excited zqaa!'], 'Hello there.'],
    ['%%%wow, what a day zqaa? %%%Hello there.', ['wow, what a day zqaa?'], 'Hello there.'],
    ['Hi. %%% So what is that? %%%warm%%% Hello there.', ['warm'], 'Hi. So what is that? Hello there.'],
    // a capitalised line with a line break on only ONE side is speech; a fence (both sides) keeps the benefit of the doubt
    ['Right.\n%%%\nThe %%%% library was warm even though the snow was coming down outside.', [], 'Right. The library was warm even though the snow was coming down outside.'],
    ['Hi.%%%\nHello there %%% soft zqbb %%% Bye.', ['soft zqbb'], 'Hi. Hello there Bye.'],
    ['Okay.\n%%%\nHello\n%%%\nSo what now?', ['Hello'], 'Okay. So what now?'],
    // an inverted mark or a quote in front of the first letter is as capitalised as the letter
    ['Okay.\n%%%\n¿Qué tal?\n%%%\nBien.', [], 'Okay. ¿Qué tal? Bien.'],
    ['Okay.\n%%%\n"Yes, indeed."\n%%%\nBien.', [], 'Okay. "Yes, indeed." Bien.'],
    // a Spanish greeting is speech, as an English one is
    ['%%%hola ¿cómo estás?', [], 'hola ¿cómo estás?'],
    ['%%%gracias ¡Hasta luego!', [], 'gracias ¡Hasta luego!'],
    // a closing quote or a spaced dash is not the inside of a word: the words around a stray keep their space
    ["He said 'yes'%%%Then he left.", [], "He said 'yes' Then he left."],
    ["She said 'no' -%%%Then she left.", [], "She said 'no' - Then she left."],
    ["you'%%%re right", [], "you're right"],
    ['a well-%%%known name', [], 'a well-known name'],
    // the tail of a cut tag with a no-break space in front of the speech
    ['curious%%%\u00a0So what is the shape of it?', ['curious'], 'So what is the shape of it?'],
    // a line start only counts as a sentence start when the line before ended its sentence
    ["%%%nervous zqaf%%% First \n%%%day's Monday. I've changed my outfit three times already.", ['nervous zqaf'], "First day's Monday. I've changed my outfit three times already."],
    ['Hello.\n%%%warm Hello there.', ['warm'], 'Hello. Hello there.'],
    ['%%%warm Hello there.', ['warm'], 'Hello there.'],
    ['Well,\n%%%warm Hello there.', [], 'Well, warm Hello there.'],
  ]) {
    const out = balanceSteeringRuns(input);
    assert.deepEqual(pairs(out), wantPairs, JSON.stringify(input).slice(0, 90));
    assert.equal(squash(strip(out)), wantSpeech, JSON.stringify(input).slice(0, 90));
  }
});

// ── the pipeline attacker's findings, and a hang the timing check found ─────────────────────────────────────────
test('a lone percent sign on a line of its own, a pair round no letters and the fuse space beside numbers and contractions', () => {
  // the incident's stray line one character short
  assert.equal(speech('Hello.\n\n%\n%%%warm%%% Hi there.'), 'Hello. Hi there.');
  assert.deepEqual(pairs(balanceSteeringRuns('Hello.\n\n%\n%%%warm%%% Hi there.')), ['warm']);
  assert.equal(speech('Hello.\r\n \t% \t\r\nBye.'), 'Hello. Bye.');
  assert.equal(balanceSteeringRuns('Sales:\n50 %\nUp.'), 'Sales:\n50 %\nUp.', 'a percentage with its number stays');
  assert.equal(balanceSteeringRuns('Growth\n%%\nUp'), 'Growth\n\nUp', 'a doubled sign on its own line is a stray run, as before');
  // a pair of three-sign runs round a short body with no letter is an empty tag (the old pairing dropped it)
  for (const [input, want] of [
    ['Before it. %%%...%%% After it, with a few more words.', 'Before it. After it, with a few more words.'],
    ['Before it. %%%?!%%% After it.', 'Before it. After it.'],
    ['Before it. %%%3%%% After it.', 'Before it. After it.'],
    ['Before it. %%% ... %%% After it.', 'Before it. After it.'],
  ]) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
    assert.equal(speech(input), want, input);
  }
  // the two runs must hug the body on one line: a stray, punctuation and a real opener on the next paragraph are not an empty tag
  assert.deepEqual(pairs(balanceSteeringRuns('%%%happy%%% Okay %%%% %%%.\n\n%%%quietly%%% Okay.')), ['happy', 'quietly']);
  assert.deepEqual(pairs(balanceSteeringRuns('%%%pleased%%% Okay%%% %%% .\n\n%%%quietly%%% Yes.')), ['pleased', 'quietly']);
  // only a tight pair on one line, of exactly three signs each side: padded, line-broken and four-sign bodies are left as they were
  assert.equal(speech('Before it. %%%.. %%% and then.'), 'Before it. .. and then.');
  assert.equal(speech('Before it. %%% ..%%% and then.'), 'Before it. .. and then.');
  assert.equal(speech('Before it. %%%..\n..%%% and then.'), 'Before it. .. .. and then.');
  assert.equal(speech('Before it. %%%%...%%%% and then.'), 'Before it. ... and then.');
  assert.equal(speech('Chapter%%%5 begins'), 'Chapter 5 begins', 'a stray between a word and a number still gets its space');
  // ... up to forty characters; a longer body is not "nothing" (the empty-pair rule needs a capital after it, so a lowercase word does)
  assert.equal(speech('Before it. %%%' + '.'.repeat(40) + '%%% and then.'), 'Before it. and then.');
  assert.equal(speech('Before it. %%%' + '.'.repeat(41) + '%%% and then.'), 'Before it. ' + '.'.repeat(41) + ' and then.');
  // a stray inside a number or in front of the tail of a contraction glues, as the old pairing had it
  assert.equal(speech('The total was 10%%%000 dollars.'), 'The total was 10000 dollars.');
  assert.equal(speech("It does%%%n't matter."), "It doesn't matter.");
  assert.equal(speech("It does%%%N’T matter."), 'It doesN’T matter.');
  assert.equal(speech('It does%%%not matter.'), 'It does not matter.', 'but two words still get their space');
  // more words that start speech and no real direction
  for (const input of ['Okay then.\n%%%goodness me', 'Okay then.\n%%%great question', 'Okay then.\n%%%just kidding', 'Okay then.\n%%%now what']) {
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], input);
  }
  assert.deepEqual(pairs(balanceSteeringRuns('Okay then.\n%%%good humoured\nHi')), ['good humoured'], '`good` starts real directions');
});

test('a text with a hundred thousand blanks and a percent sign is balanced in a blink, not in minutes', () => {
  // /[ \t]+$/ on "<149,000 blanks>x" backtracks over the whole run from every start: minutes. Every text with a %
  // in it comes through trimLonePercent, so these shapes are checked against the clock.
  const big = 149000;
  const t0 = Date.now();
  for (const text of [' '.repeat(big) + 'x%', ' \t'.repeat(big / 2) + 'x%', 'x' + ' '.repeat(big) + '%', ' '.repeat(big) + '%', '\n'.repeat(big) + '%',
    ' '.repeat(big) + 'x%', 'a'.repeat(big) + '%', '% '.repeat(big / 2)]) balanceSteeringRuns(text);
  assert.ok(Date.now() - t0 < 3000, `eight pathological texts took ${Date.now() - t0} ms`);
});

// ── what a hand mutation sweep of the batch-2 rules found nothing holding ───────────────────────────────────────
test('pins from the second sweep: the empty pair, the doubled-sign limits, abbreviations, the fuse space, the end percent', () => {
  const abbreviations = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'vs', 'etc', 'No'];
  for (const a of abbreviations) {
    const input = `%%% gentle ${a}. Rogers voice %%% Oh my gosh, look at that.`;
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [`gentle ${a}. Rogers voice`], input);
  }
  // an abbreviation needs a word boundary in front of it: `xNo.` is a word that ends a sentence
  assert.deepEqual(pairs(balanceSteeringRuns('I said %%% gentle xNo. Rogers voice %%% yes')), []);
  // the empty pair takes any run of blanks after the second run, and a six-percent run that a word touches is no pair
  for (const gap of ['   ', '\t', '     ']) {
    const input = `%%%\n%%%${gap}See you soon. %%%`;
    assert.deepEqual(pairs(balanceSteeringRuns(input)), [], JSON.stringify(input));
    assert.equal(speech(input), 'See you soon.', JSON.stringify(input));
  }
  assert.equal(speech('%%%%%%5 %%% Hello there.'), '5 Hello there.');
  const seen = [];
  setRepairLogger((r) => seen.push(r));
  try {
    balanceSteeringRuns('%%%\n%%% See you soon. %%%');
    assert.deepEqual(seen, [{ strays: 3, closed: 0 }], 'the empty pair counts as two strays');
  } finally { setRepairLogger(null); }
  // a forgotten-closer line may hold commas, apostrophes (straight or curly) and hyphens
  assert.equal(unclosedLine("warm, like it's nothing\nHi"), "warm, like it's nothing");
  assert.equal(unclosedLine('warm, like it’s nothing\nHi'), 'warm, like it’s nothing');
  assert.equal(unclosedLine('soft-spoken and slow\nHi'), 'soft-spoken and slow');
  // the doubled-sign limit is 160 characters: 160 pairs, 161 does not; digits alone are no tag
  const body160 = 'a' + 'b'.repeat(159);
  assert.deepEqual(pairs(balanceSteeringRuns(`Hi %%${body160}%% there`)), [body160]);
  assert.deepEqual(pairs(balanceSteeringRuns(`Hi %%${body160}b%% there`)), []);
  assert.deepEqual(pairs(balanceSteeringRuns('Hi %%80%% there')), []);
  assert.equal(speech('Hi %%80%% there'), 'Hi 80 there');
  // the old normaliser wanted a Latin letter in it, so a digit followed by other letters is no doubled-sign tag either
  assert.deepEqual(pairs(balanceSteeringRuns('Hi %%5 тихо%% there')), []);
  // a stray after a spaced dash is not inside a word
  assert.equal(speech('a --%%%then'), 'a -- then');
  // the end percent: a doubled run at the end of a text is a run, not a lone sign
  assert.equal(balanceSteeringRuns('%%%warm%%% Hello there %%'), '%%%warm%%% Hello there ');
  // an ellipsis is not a full stop, so a capitalised span ending in one is no sentence
  assert.deepEqual(pairs(balanceSteeringRuns('%%% Hesitant, then thinking... %%%Hello there.')), ['Hesitant, then thinking...']);
  // eleven words still make a tight tag (so the reply "writes tight tags" and a four-word loose sentence is two strays),
  // twelve are prose
  const eleven = Array.from({ length: 11 }, (_, i) => 'w' + i).join(' ');
  assert.deepEqual(pairs(balanceSteeringRuns(`%%%${eleven}%%% Hi. %%% This is a four word sentence. %%% Bye.`)), [eleven]);
});

// ── seeded generators of messages the way models actually break them ───────────────────────────────────────
// Every tag carries a unique marker word; the invariant is that no marker is ever left in the speech, no prose
// word is lost, and no delimiter survives outside a pair.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const PROSE = ["Yeah, you're right.", 'That is on me.', 'The paper trail is thin.', 'So what is the shape of it?', 'How far back have you gotten?', 'Two different problems.', 'I would go and look.', 'Not a chance.', 'Okay then, let us see.'];
const DIRS = ['warm and curious', 'to correct with respect', 'a little amused', 'quietly', 'interested like she is leaning in', 'dry and flat', 'soft but sure'];

function build(r, n) {
  const items = [];
  let marker = 0;
  for (let k = 0; k < n; k++) {
    if (r() < 0.55) items.push({ type: 'tag', body: `${DIRS[Math.floor(r() * DIRS.length)]} zq${marker++}x` });
    items.push({ type: 'prose', text: PROSE[Math.floor(r() * PROSE.length)] });
  }
  return items;
}

// mode 'lines': every stray sits on a line of its own, wherever it lands (including on both sides of a sentence).
// mode 'mixed': strays inline or on lines, but never one on each side of a lone sentence: two independent strays
//   around one sentence on the same line read exactly like a padded tag, and the old pairing swallowed that too.
function corrupt(r, items, mode) {
  let out = '';
  let strayBeforePrevProse = false;
  const strays = ['%%%', '%%', '%%%%', '%%%%%'];
  items.forEach((it, idx) => {
    let placed = false;
    if (r() < 0.35 && !(mode === 'mixed' && idx > 0 && items[idx - 1].type === 'prose' && strayBeforePrevProse)) {
      placed = true;
      if (mode === 'lines') out += '\n' + strays[Math.floor(r() * strays.length)] + '\n';
      else out += (r() < 0.6 ? '\n' : ' ') + strays[Math.floor(r() * strays.length)] + (r() < 0.7 ? '\n' : ' ');
    }
    strayBeforePrevProse = it.type === 'prose' ? placed : false;
    if (it.type === 'prose') { out += (out && !/\s$/.test(out) ? ' ' : '') + it.text; return; }
    let open = '%'.repeat(2 + Math.floor(r() * 4));         // 2..5
    let close = '%'.repeat(2 + Math.floor(r() * 4));
    const pad = r() < 0.2 ? ' ' : '';
    if (pad) { open = '%%%'; close = '%%%'; }                // the old pairing only knew a padded tag written with three
    const lineStart = out === '' || out.endsWith('\n');
    if (lineStart && r() < 0.15) {                           // forgot the closer, tag alone on its line
      out += open + it.body + '\n';
      return;
    }
    out += (out && !/\s$/.test(out) ? (r() < 0.5 ? '\n\n' : ' ') : '') + open + pad + it.body + pad + close + (r() < 0.5 ? ' ' : '\n');
    if (r() < 0.1) out += '%'.repeat(2 + Math.floor(r() * 3)) + '\n';
  });
  return out;
}

function fuzz(mode, seed) {
  const r = rng(seed);
  let leaks = 0;
  let lost = 0;
  const examples = [];
  for (let trial = 0; trial < 4000; trial++) {
    const items = build(r, 2 + Math.floor(r() * 5));
    const msg = corrupt(r, items, mode);
    const out = balanceSteeringRuns(msg);
    const heard = strip(out);
    if (/%{4,}/.test(out)) leaks++;   // a touching pair would defeat the converter that follows
    const markers = items.filter((i) => i.type === 'tag').map((i) => i.body.match(/zq\d+x/)[0]);
    const bad = markers.filter((m) => heard.includes(m));
    const prose = items.filter((i) => i.type === 'prose').map((i) => i.text).join(' ').replace(/\s+/g, ' ');
    const left = heard.replace(/%+/g, '').replace(/\s+/g, ' ').trim();
    if (bad.length || /%/.test(heard) || left !== prose) {
      if (bad.length) leaks++; else lost++;
      if (examples.length < 3) examples.push({ msg, out });
    }
  }
  return { leaks, lost, examples };
}

test('fuzz: strays on lines of their own, wherever they land: no direction is spoken and no prose is lost (4,000)', () => {
  const { leaks, lost, examples } = fuzz('lines', 20261106);
  assert.equal(leaks + lost, 0, `${leaks} leaks, ${lost} lost/extra; first: ${JSON.stringify(examples[0])}`);
});

test('fuzz: strays inline or on lines, none on both sides of a lone sentence (4,000)', () => {
  const { leaks, lost, examples } = fuzz('mixed', 20261106);
  assert.equal(leaks + lost, 0, `${leaks} leaks, ${lost} lost/extra; first: ${JSON.stringify(examples[0])}`);
});

test('fuzz: no direction word is ever spoken, whatever the strays do (4,000, sandwiched sentences allowed)', () => {
  const { leaks, examples } = fuzz('all', 20261106);
  assert.equal(leaks, 0, `${leaks} leaks; first: ${JSON.stringify(examples[0])}`);
});

// Well-formed messages in every layout a model might use must keep exactly their tags and exactly their speech.
test('fuzz: well-formed tags in every layout keep their pairs and their speech (6,000)', () => {
  const r = rng(20261107);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const BODIES = ['warm', 'warm and curious', 'to correct with respect', 'a little amused', "interested like she's leaning in", 'dry, flat', 'soft but sure', 'laugh', 'sigh', 'quietly', 'thoughtful'];
  const layouts = [
    (b) => `%%%${b}%%%`, (b) => `%%% ${b} %%%`, (b) => `%%% ${b}%%%`, (b) => `%%%${b} %%%`,
    (b) => `%%%\n${b}\n%%%`, (b) => `%%%\n${b}%%%`, (b) => `%%%${b}\n%%%`,
  ];
  for (let trial = 0; trial < 6000; trial++) {
    const n = 1 + Math.floor(r() * 4);
    let msg = '';
    const bodies = [];
    const said = [];
    for (let k = 0; k < n; k++) {
      const body = pick(BODIES);
      bodies.push(body);
      msg += (k === 0 ? '' : pick([' ', '\n', '\n\n'])) + pick(layouts)(body);
      const p = pick(PROSE);
      said.push(p);
      msg += pick([' ', '\n', '\n\n']) + p;
    }
    const out = balanceSteeringRuns(msg);
    assert.deepEqual(pairs(out), bodies, JSON.stringify(msg));
    assert.equal(squash(strip(out)), squash(said.join(' ')), JSON.stringify(msg));
  }
});
