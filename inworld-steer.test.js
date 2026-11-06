'use strict';
// Nov 5 2026: tempo-neutral steering (inworld-steer.js). A feeling word slows Inworld by a measured
// amount; chat speech is sent at the listener's rate times that cost, never past the cap or Inworld's 1.5.
const test = require('node:test');
const assert = require('node:assert/strict');
const { steerSettings, directionCost, directionsOf, steerFactor, steeredRate, WORDS, PHRASES } = require('./inworld-steer');

const ON = steerSettings({ INWORLD_STEER_RATE: '1' });

test('off unless INWORLD_STEER_RATE=1; the cap and the fallback move without a deploy', () => {
  assert.equal(steerSettings({}).on, false);
  assert.equal(steerSettings({ INWORLD_STEER_RATE: '0' }).on, false);
  assert.deepEqual([ON.on, ON.maxBoost, ON.fallback], [true, 1.25, 1.12]);
  const t = steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_STEER_MAX_BOOST: '1.4', INWORLD_STEER_DEFAULT: '1.2' });
  assert.deepEqual([t.maxBoost, t.fallback], [1.4, 1.2]);
  // nonsense is held inside what Inworld accepts
  const wild = steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_STEER_MAX_BOOST: '9', INWORLD_STEER_DEFAULT: '0.2' });
  assert.deepEqual([wild.maxBoost, wild.fallback], [1.5, 1]);
  assert.equal(steeredRate(1, 'hesitant', 'x', steerSettings({})), 1, 'off: the rate is the listener\'s');
});

test('a direction that costs too much speed is dropped, not sent; off by default', () => {
  const { steeredInstruction } = require('./inworld-steer');
  assert.equal(ON.dropAbove, 0);
  assert.equal(steeredInstruction('hesitant', ON), 'hesitant', 'off: nothing is dropped');
  const drop = steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_STEER_DROP_ABOVE: '1.4' });
  assert.equal(drop.dropAbove, 1.4);
  for (const d of ['hesitant', 'uncertain', 'uneasy', 'sad', 'tired', 'sleepy', 'thinking out loud', 'worried and trying not to be']) {
    assert.equal(steeredInstruction(d, drop), null, d + ' costs ' + directionCost(d, drop));
  }
  for (const d of ['amused', 'pleased', 'fond', 'curious', 'calm', 'thoughtful', 'nostalgic', 'disappointed', 'warm', 'matter of fact', 'a brand new feeling']) {
    assert.equal(steeredInstruction(d, drop), d, d + ' costs ' + directionCost(d, drop));
  }
  assert.equal(steeredInstruction(null, drop), null);
  assert.equal(steeredInstruction('', drop), '');
  // steering off: the instruction always goes, whatever the threshold says
  assert.equal(steeredInstruction('hesitant', steerSettings({ INWORLD_STEER_DROP_ABOVE: '1.4' })), 'hesitant');
  // a threshold of 1 or under means never (a cost of exactly 1 must not wipe out every direction)
  assert.equal(steeredInstruction('amused', steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_STEER_DROP_ABOVE: '1' })), 'amused');
});

test('INWORLD_TALK_RATE is the one dial for overall chat pace: 1 changes nothing, it multiplies, and it stays in range', () => {
  assert.equal(ON.talkRate, 1);
  const slower = steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_TALK_RATE: '0.9' });
  assert.equal(slower.talkRate, 0.9);
  assert.equal(steeredRate(1, null, 'no steering here', slower), 0.9, 'an unsteered piece is slowed evenly');
  assert.equal(steeredRate(1, 'amused', 'x', slower), Math.round(0.9 * WORDS.amused * 1000) / 1000, 'a steered one gets both');
  assert.equal(steeredRate(1.2, 'hesitant', 'x', slower), Math.round(1.2 * 0.9 * 1.25 * 1000) / 1000);
  assert.equal(steeredRate(1.4, 'hesitant', 'x', steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_TALK_RATE: '1.3' })), 1.5, 'Inworld\'s limit');
  assert.equal(steeredRate(0.5, null, 'x', steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_TALK_RATE: '0.7' })), 0.5, 'and its floor');
  // nonsense is held to what makes sense; off means off whatever the dial says
  assert.equal(steerSettings({ INWORLD_TALK_RATE: '9' }).talkRate, 1.3);
  assert.equal(steerSettings({ INWORLD_TALK_RATE: '0.1' }).talkRate, 0.7);
  assert.equal(steerSettings({ INWORLD_TALK_RATE: 'fast' }).talkRate, 1);
  assert.equal(steeredRate(1, null, 'x', steerSettings({ INWORLD_TALK_RATE: '0.8' })), 1, 'steering off: the dial does nothing');
});

test('the table is a measurement: upbeat words cost nothing, moody ones a lot, nothing under 1', () => {
  for (const [w, v] of [...Object.entries(WORDS), ...Object.entries(PHRASES)]) assert.ok(v >= 1 && v < 2.2, `${w}: ${v}`);
  for (const w of ['bright', 'upbeat', 'encouraging', 'excited', 'cheerful', 'eager', 'friendly']) assert.ok(WORDS[w] <= 1.05, w);
  for (const w of ['amused', 'pleased', 'curious', 'warm']) assert.ok(WORDS[w] > 1.04 && WORDS[w] < 1.15, w);
  for (const w of ['hesitant', 'uncertain', 'uneasy', 'sleepy', 'sad', 'tired', 'careful']) assert.ok(WORDS[w] >= 1.4, w);
  assert.ok(Object.keys(WORDS).length >= 100 && Object.keys(PHRASES).length >= 30);
});

test('a direction costs its word; a measured phrase costs what it measured; modifiers are ignored', () => {
  assert.equal(directionCost('amused', ON), WORDS.amused);
  assert.equal(directionCost('Amused!', ON), WORDS.amused, 'case and punctuation do not matter');
  assert.equal(directionCost('a little amused', ON), WORDS.amused, '"a little" is a modifier');
  assert.equal(directionCost('calm and matter of fact', ON), PHRASES['calm and matter of fact']);
  assert.equal(directionCost('', ON), 1);
  assert.equal(directionCost(null, ON), 1);
  assert.equal(directionCost('a little', ON), 1, 'nothing but modifiers');
});

test('several known words blend their largest and their average; unknown words cost the fallback', () => {
  const blend = (...ws) => { const v = ws.map((w) => WORDS[w]); return (Math.max(...v) + v.reduce((a, b) => a + b, 0) / v.length) / 2; };
  assert.ok(Math.abs(directionCost('fond and sleepy', ON) - blend('fond', 'sleepy')) < 1e-9);
  assert.ok(Math.abs(directionCost('relieved and unsettled', ON) - blend('relieved', 'unsettled')) < 1e-9);
  assert.equal(directionCost('zzzqx wibble', ON), ON.fallback);
  assert.equal(directionCost('zzzqx wibble', steerSettings({ INWORLD_STEER_RATE: '1', INWORLD_STEER_DEFAULT: '1.3' })), 1.3);
  // a known word beside an unknown one is judged on the known one
  assert.equal(directionCost('amused zzzqx', ON), WORDS.amused);
});

test('the request carries its instruction and any inline direction; sounds and [reset] are not directions', () => {
  assert.deepEqual(directionsOf('amused', 'So I said [hesitant] well maybe [laugh] ok [reset] fine'), ['amused', 'hesitant']);
  assert.deepEqual(directionsOf(null, 'plain words'), []);
  assert.equal(steerFactor(null, 'Ha [laugh] ok [sigh] fine [reset] go', ON), 1);
  assert.equal(steerFactor(null, 'So I said [hesitant] well maybe', ON), ON.maxBoost, 'inline counts, capped');
  assert.equal(steerFactor('amused', 'and then [curious] huh', ON), Math.max(WORDS.amused, WORDS.curious));
});

test('the rate sent is the listener\'s times the cost, capped at the boost cap and at Inworld\'s 1.5', () => {
  assert.equal(steeredRate(1, 'amused', 'x', ON), WORDS.amused);
  assert.equal(steeredRate(1, 'hesitant', 'x', ON), 1.25, 'never asked to race: the cap');
  assert.equal(steeredRate(1.1, 'amused', 'x', ON), Math.round(1.1 * WORDS.amused * 1000) / 1000, 'the listener\'s own speed is multiplied, not replaced');
  assert.equal(steeredRate(1.3, 'hesitant', 'x', ON), 1.5, 'Inworld\'s own limit');
  assert.equal(steeredRate(0.75, 'hesitant', 'x', ON), 0.938, 'rounded to three places');
  assert.equal(steeredRate(1, null, 'no steering here', ON), 1, 'nothing steered, nothing changed');
  assert.equal(steeredRate(1.2, 'encouraging', 'x', ON), 1.212, 'a free word barely moves it');
});
