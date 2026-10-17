'use strict';
// Oct 17 2026: the Inworld voice writer (inworld-writer.js). Kade: "we should have a writer that
// does the same thing for inworld, like turns text into the documented inworld style." These hold
// its promise: the words never change, a character's own tags stay put, and any doubt speaks plain.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWriter, vet, vetInstruction, applyEdits, writerOn } = require('./inworld-writer');
const { talkSoundsByParagraph } = require('./pace');

const PIECE = 'They want me to keep him off the stairs for a week, which is going to be a whole thing. Anyway, how did your appointment go? I keep thinking about it.';
const ON = { INWORLD_WRITER: '1', OPENROUTER_KEY: 'test-key' };
const GOOD = { instruction: 'say with warm relief like telling a close friend good news', stress: ['going to be a WHOLE thing'], turn: '[sound lighter and curious] Anyway, how did' };

function stub(replies) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}) };
    if (next && next.refused) return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'content_filter', message: { content: 'The request was rejected because it was considered high risk' } }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(next) } }] }) };
  };
  return { fetcher, calls };
}
const quiet = () => {};

test('a good answer becomes a brief, one capital and one turn; MiMo Flash, zero retention, thinking off', async () => {
  const { fetcher, calls } = stub([GOOD]);
  const w = createWriter({ fetcher, source: ON, log: quiet });
  const r = await w.writePiece({ text: PIECE, instruction: null });
  assert.equal(r.status, 'written');
  assert.equal(r.instruction, 'say with warm relief like telling a close friend good news');
  assert.equal(r.text, 'They want me to keep him off the stairs for a week, which is going to be a WHOLE thing. [sound lighter and curious] Anyway, how did your appointment go? I keep thinking about it.');
  const body = calls[0].body;
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.equal(body.model, 'xiaomi/mimo-v2.6-flash');
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.equal(body.provider.zdr, true);
  assert.equal(body.provider.data_collection, 'deny');
  assert.deepEqual(body.provider.order, ['Io Net', 'Makora', 'DeepInfra']);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const pro = stub([GOOD]);
  await createWriter({ fetcher: pro.fetcher, source: { ...ON, INWORLD_WRITER_MODEL: 'xiaomi/mimo-v2.6-pro' }, log: quiet }).writePiece({ text: PIECE });
  assert.deepEqual(pro.calls[0].body.provider.order, ['DeepInfra'], 'Pro goes to its zero-retention host');
});

test('the model never returns the text, so a snippet that does not match is simply skipped', () => {
  assert.equal(applyEdits(PIECE, { stress: ['going to be a HUGE thing'], turn: '[warmer] Anyway, how did you' }), PIECE);
  // A snippet found twice is ambiguous: skipped.
  const twice = 'It was a long day. It was a long night too, honestly, and I am tired.';
  assert.equal(applyEdits(twice, { stress: ['It WAS a long'] }), twice);
  // A turn never lands at the very start.
  assert.equal(applyEdits(PIECE, { turn: '[excited] They want me' }), PIECE);
});

test('a changed word, a moved or lost tag, or too much markup speaks the piece plain', () => {
  assert.equal(vet(PIECE, PIECE.replace('whole', 'big')).ok, false);
  assert.equal(vet(PIECE, PIECE.replace('Anyway', '[a] Anyway').replace('I keep', '[b] I keep')).ok, false);
  assert.equal(vet(PIECE, PIECE.replace('stairs', 'STAIRS').replace('whole', 'WHOLE').replace('appointment', 'APPOINTMENT')).ok, false);
  const own = '[warm] ' + PIECE.replace('Anyway', '[reset] Anyway');
  assert.equal(vet(own, own.replace('[reset] Anyway', 'Anyway')).ok, false, 'the character\'s reset must survive');
  assert.equal(vet(own, own.replace('[reset] Anyway', 'Anyway').replace('I keep', '[reset] I keep')).ok, false, 'and stay where it was');
  assert.equal(vet(PIECE, PIECE.replace('They', '[excited] They')).ok, false, 'never a direction at the start');
});

test('sounds, speed and volume the model adds anyway are dropped; short common words stay lower case', () => {
  const v = vet(PIECE, PIECE.replace('Anyway', '[sigh] [whispering] Anyway').replace('I keep', '[talking faster] I keep').replace('your', 'YOUR').replace('week', 'WEEK'));
  assert.equal(v.ok, true);
  assert.equal(v.text, PIECE.replace('week', 'WEEK'));
  assert.equal(vetInstruction('Say softly, with warm sympathy at a measured pace'), 'say with warm sympathy');
  assert.equal(vetInstruction('whisper it lovingly'), null);
  assert.equal(vetInstruction('say with a light laugh'), null);
  assert.equal(vetInstruction('warm'), null, 'a bare label is not a brief');
});

test('Kade: casual best friends, not a drama script; big words come out, a big turn is dropped', () => {
  assert.equal(vetInstruction('talking on the phone with a close friend and bursting with good news'), 'talking on the phone with a close friend with good news');
  assert.equal(vetInstruction('chatting with your best friend, hugely relieved'), 'chatting with your best friend and relieved');
  const v = vet(PIECE, PIECE.replace('Anyway', '[absolutely overjoyed now] Anyway'));
  assert.equal(v.ok, true);
  assert.equal(v.text, PIECE);
});

test('paragraphs and spacing come through exactly; the character\'s own direction wins over the brief', async () => {
  const two = 'Okay so I finally called the vet about Biscuit.\n\nThey want me to keep him off the stairs for a week, which is going to be a whole thing. Anyway, how did your appointment go?';
  const { fetcher, calls } = stub([{ ...GOOD, turn: '' }]);
  const r = await createWriter({ fetcher, source: ON, log: quiet }).writePiece({ text: two, instruction: 'grinning about it' });
  assert.equal(r.text, two.replace('whole', 'WHOLE'));
  assert.equal(r.instruction, 'grinning about it');
  assert.match(calls[0].body.messages[1].content, /already has its own direction/);
});

test('a written piece gets the same sound in the same place as its plain words', () => {
  const pieces = [
    ['Phew, what a relief. The test came back clean and I could finally breathe again after a whole week of waiting.', 'clean', 'I could', /^\[breathe\] Phew/],
    ['That was honestly hilarious. I cannot believe he wore the costume to the meeting, and nobody said a single word about it.', 'costume', 'I cannot', /hilarious\. \[chuckle\]/],
  ];
  for (const [plain, word, at, sound] of pieces) {
    const written = plain.replace(word, word.toUpperCase()).replace(at, `[sound lighter] ${at}`);
    const a = talkSoundsByParagraph(plain, { engine: 'inworld' });
    const b = talkSoundsByParagraph(written, { engine: 'inworld', seedText: plain });
    assert.match(a, sound);
    assert.equal(b.replace('[sound lighter] ', '').replace(word.toUpperCase(), word), a);
  }
});

test('short pieces, quotes and lists are never sent; off means off', async () => {
  const { fetcher, calls } = stub([]);
  const w = createWriter({ fetcher, source: ON, log: quiet });
  assert.equal((await w.writePiece({ text: 'Okay so I finally called the vet about Biscuit.' })).status, 'short');
  assert.equal((await w.writePiece({ text: `She said "${PIECE}" to me and then left.` })).status, 'read');
  assert.equal(calls.length, 0);
  assert.equal(writerOn({ INWORLD_WRITER: '1' }), false, 'no key, no writer');
  const pieces = [{ text: PIECE, instruction: null }];
  assert.equal(await createWriter({ fetcher, source: { OPENROUTER_KEY: 'k' }, log: quiet }).writePieces(pieces), pieces);
  assert.equal(calls.length, 0);
});

test('a repeat is served from the cache; out of credit or a refusal rests the writer', async () => {
  let t = 0;
  const { fetcher, calls } = stub([GOOD, 402]);
  const w = createWriter({ fetcher, source: ON, log: quiet, now: () => t });
  assert.equal((await w.writePiece({ text: PIECE })).status, 'written');
  assert.equal((await w.writePiece({ text: PIECE })).status, 'cached');
  assert.equal(calls.length, 1);
  const other = { text: PIECE.replace('stairs', 'couch') };
  assert.match((await w.writePiece(other)).status, /kept plain \(HTTP 402\)/);
  assert.equal((await w.writePiece(other)).status, 'paused');
  t += 11 * 60 * 1000;
  const refused = stub([{ refused: true }]);
  const r = await createWriter({ fetcher: refused.fetcher, source: ON, log: quiet }).writePiece({ text: PIECE });
  assert.equal(r.text, PIECE);
  assert.equal(r.instruction, null);
  assert.match(r.status, /^kept plain/);
});

test('a slow answer times out and speaks plain', async () => {
  const fetcher = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const w = createWriter({ fetcher, source: { ...ON, INWORLD_WRITER_TIMEOUT_MS: '30' }, log: quiet });
  const r = await w.writePiece({ text: PIECE, instruction: null });
  assert.equal(r.text, PIECE);
  assert.equal(r.status, 'kept plain (timed out)');
});

test('several pieces are written together and logged in one line', async () => {
  const lines = [];
  const { fetcher } = stub([GOOD]);
  const w = createWriter({ fetcher, source: ON, log: (l) => lines.push(l) });
  const out = await w.writePieces([{ text: 'Short one.', instruction: null }, { text: PIECE, instruction: null }]);
  assert.deepEqual(out[0], { text: 'Short one.', instruction: null });
  assert.match(out[1].text, /WHOLE thing/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[TTS\] inworld writer: written \d+ms$/);
});
