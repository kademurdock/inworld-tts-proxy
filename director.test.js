'use strict';
// Oct 17 2026: the Fish voice director (director.js). Kade: "Build the voice director in for Fish
// voice messages." These hold its one promise: the words never change, and any doubt speaks plain.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirector, vet, directorOn } = require('./director');

const PIECE = 'They want me to keep him off the stairs for a week, which is going to be a whole thing. Anyway, how did your appointment go? I keep thinking about it.';
const ON = { FISH_DIRECTOR: '1', OPENROUTER_KEY: 'test-key' };

function stub(replies) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}) };
    if (next && next.google) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ marked: next.google }) }] } }] }) };
    if (next && next.refused) return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'content_filter', message: { content: 'The request was rejected because it was considered high risk' } }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ marked: next }) } }] }) };
  };
  return { fetcher, calls };
}
const quiet = () => {};

test('a good markup is kept; MiMo Pro is asked with zero retention, thinking off and a JSON answer', async () => {
  const marked = 'They want me to keep him off the stairs for a week, which is going to be a <emphasis>whole</emphasis> thing. [pause] Anyway, how did your appointment go? [softer, a little worried] I keep thinking about it.';
  const { fetcher, calls } = stub([marked]);
  const d = createDirector({ fetcher, source: ON, log: quiet });
  const r = await d.directPiece(PIECE);
  assert.equal(r.status, 'directed');
  assert.equal(r.text, marked);
  const body = calls[0].body;
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.equal(body.model, 'xiaomi/mimo-v2.6-pro');
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.equal(body.provider.zdr, true);
  assert.equal(body.provider.data_collection, 'deny');
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('a host refusal is no answer; the Google route stays as a rollback', async () => {
  const refused = stub([{ refused: true }]);
  const r = await createDirector({ fetcher: refused.fetcher, source: ON, log: quiet }).directPiece(PIECE);
  assert.equal(r.text, PIECE);
  assert.match(r.status, /^kept plain/);
  const marked = PIECE.replace('whole', '<emphasis>whole</emphasis>');
  const g = stub([{ google: marked }]);
  const source = { FISH_DIRECTOR: '1', FISH_DIRECTOR_MODEL: 'gemini-3.5-flash', FISH_DIRECTOR_KEY: 'g-key' };
  assert.equal(directorOn({ FISH_DIRECTOR: '1', FISH_DIRECTOR_MODEL: 'gemini-3.5-flash', OPENROUTER_KEY: 'k' }), false, 'Google needs its own key');
  const out = await createDirector({ fetcher: g.fetcher, source, log: quiet }).directPiece(PIECE);
  assert.equal(out.text, marked);
  assert.match(g.calls[0].url, /gemini-3\.5-flash:generateContent$/);
  assert.equal(g.calls[0].body.generationConfig.thinkingConfig.thinkingBudget, 0);
});

test('a changed word, a lost tag, a broken scope or too much markup speaks the piece plain', async () => {
  const bad = [
    PIECE.replace('whole', 'big'),
    PIECE.replace('a whole thing.', 'a <emphasis>whole thing.'),
    PIECE.replace('Anyway', '[pause] Anyway').replace('I keep', '[pause] I keep'),
    PIECE.replace('They', '[excited] They'),
    PIECE.replace('whole', '<whisper>whole</whisper>'),
    PIECE.replace('Anyway', '[a] Anyway').replace('how', '[b] how').replace('I keep', '[c] I keep'),
  ];
  for (const marked of bad) {
    const { fetcher } = stub([marked]);
    const r = await createDirector({ fetcher, source: ON, log: quiet }).directPiece(PIECE);
    assert.equal(r.text, PIECE, marked);
    assert.match(r.status, /^kept plain/);
  }
  const withTag = '[warm] ' + PIECE.replace('Anyway', '<emphasis>ANYWAY</emphasis>').replace('ANYWAY', 'Anyway');
  assert.equal(vet(withTag, withTag.replace('[warm] ', '')).ok, false, 'the character\'s own direction must survive');
});

test('sounds and speed words the model adds anyway are dropped, the rest kept', () => {
  const v = vet(PIECE, PIECE.replace('Anyway', '[sigh] [talking faster] Anyway').replace('whole', '<stress>whole</stress>'));
  assert.equal(v.ok, true);
  assert.doesNotMatch(v.text, /sigh|faster/);
  assert.match(v.text, /<stress>whole<\/stress> thing\. Anyway/);
});

test('short pieces, quotes and lists are never sent; off means off', async () => {
  const { fetcher, calls } = stub([]);
  const d = createDirector({ fetcher, source: ON, log: quiet });
  assert.equal((await d.directPiece('Okay so I finally called the vet about Biscuit.')).status, 'short');
  assert.equal((await d.directPiece(`She said "${PIECE}" to me and then left.`)).status, 'read');
  assert.equal(calls.length, 0);
  assert.equal(directorOn({ FISH_DIRECTOR: '1' }), false, 'no key, no director');
  const off = createDirector({ fetcher, source: { OPENROUTER_KEY: 'k' }, log: quiet });
  assert.deepEqual(await off.directPieces([PIECE]), [PIECE]);
  assert.equal(calls.length, 0);
});

test('a repeat is served from the cache; out of credit pauses the director', async () => {
  let t = 0;
  const marked = PIECE.replace('whole', '<emphasis>whole</emphasis>');
  const { fetcher, calls } = stub([marked, 402]);
  const d = createDirector({ fetcher, source: ON, log: quiet, now: () => t });
  assert.equal((await d.directPiece(PIECE)).status, 'directed');
  assert.equal((await d.directPiece(PIECE)).status, 'cached');
  assert.equal(calls.length, 1);
  const other = PIECE.replace('stairs', 'couch');
  assert.match((await d.directPiece(other)).status, /kept plain \(HTTP 402\)/);
  assert.equal((await d.directPiece(other)).status, 'paused');
  t += 11 * 60 * 1000;
  assert.equal(calls.length, 2);
});

test('a slow answer times out and speaks plain', async () => {
  const fetcher = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const d = createDirector({ fetcher, source: { ...ON, FISH_DIRECTOR_TIMEOUT_MS: '30' }, log: quiet });
  const r = await d.directPiece(PIECE);
  assert.equal(r.text, PIECE);
  assert.equal(r.status, 'kept plain (timed out)');
});

test('several pieces are directed together and logged in one line', async () => {
  const lines = [];
  const { fetcher } = stub([PIECE.replace('whole', '<emphasis>whole</emphasis>')]);
  const d = createDirector({ fetcher, source: ON, log: (l) => lines.push(l) });
  const out = await d.directPieces(['Short one.', PIECE]);
  assert.equal(out[0], 'Short one.');
  assert.match(out[1], /<emphasis>whole<\/emphasis>/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[TTS\] director: directed \d+ms$/);
});
