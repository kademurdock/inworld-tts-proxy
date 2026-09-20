/* loose-jev.test.js — Part 236 (Sep 20 2026).
 *
 * The Jev second opinion on loose stage directions. The word list and the
 * rescue are sliced out of the SHIPPED server.js (house rule from
 * steering.reset.test.js: a test against a transcription proves nothing), and
 * jev is a stand-in passed by parameter, so nothing here touches the network.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const { createLooseResolver, findUnknownSpans, isCandidate } = require('./loose-jev');

function loadServerHalf() {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const start = src.indexOf('const PHYSICAL_TO_VOCAL = [');
  const end = src.indexOf('const looseJev = require("./loose-jev")');
  assert.ok(start > -1 && end > start, 'loose-direction block not found in server.js');
  const ctx = { STEERING_OPEN: '%%%', STEERING_CLOSE: '%%%' };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.looks = looksLikeDirection;\nthis.rescue = rescueLooseDirections;', ctx);
  return ctx;
}
const server = loadServerHalf();

/* A stand-in Jev. `answers` maps a span to [label, pSpoken]. */
function fakeJev(answers, opts = {}) {
  const calls = [];
  return {
    calls,
    enabled: (flag) => opts.enabled !== false && flag === 'KADE_JEV_LOOSE',
    looseDirections: async (items) => {
      calls.push(items);
      if (opts.fail) throw new Error('HTTP 500');
      if (opts.hangMs) await new Promise((r) => setTimeout(r, opts.hangMs));
      return items.map(({ span }) => {
        const [label, pSpoken] = answers[span] || ['spoken', 1];
        return { label, confidence: 0.9, probabilities: { spoken: pSpoken } };
      });
    },
  };
}
const resolver = (jev, extra) => createLooseResolver({ looksLikeDirection: server.looks, jev, ...extra });

const LINE = '(quietly furious) You told me you had handled it. Serve it (warm) with butter. (softly) Goodnight.';

test('rescue with no verdicts is exactly the old rescue', () => {
  const old = server.rescue(LINE);
  assert.strictEqual(old, '(quietly furious) You told me you had handled it. Serve it (warm) with butter. %%%softly%%% Goodnight.');
  assert.strictEqual(server.rescue(LINE, null), old);
  assert.strictEqual(server.rescue(LINE, undefined), old);
  assert.strictEqual(server.rescue(LINE, new Map()), old);
});

test('key unset / kill switch: resolve is null, Jev is never called, output is the old output', async () => {
  const jev = fakeJev({ 'quietly furious': ['delivery', 0] }, { enabled: false });
  const v = await resolver(jev).resolve(LINE);
  assert.strictEqual(v, null);
  assert.strictEqual(jev.calls.length, 0);
  assert.strictEqual(server.rescue(LINE, v), server.rescue(LINE));
});

test('the real jev.js reports disabled with the key unset, and with each kill switch', () => {
  const real = require('./jev');
  const saved = { k: process.env.TYPESAFE_API_KEY, a: process.env.KADE_JEV, l: process.env.KADE_JEV_LOOSE };
  try {
    delete process.env.TYPESAFE_API_KEY; delete process.env.KADE_JEV; delete process.env.KADE_JEV_LOOSE;
    assert.strictEqual(real.enabled('KADE_JEV_LOOSE'), false, 'no key');
    process.env.TYPESAFE_API_KEY = 'x';
    assert.strictEqual(real.enabled('KADE_JEV_LOOSE'), true);
    process.env.KADE_JEV_LOOSE = '0';
    assert.strictEqual(real.enabled('KADE_JEV_LOOSE'), false, 'feature kill');
    assert.strictEqual(real.enabled('KADE_JEV_VOICEMOVE'), true, 'one feature kill leaves the other on');
    delete process.env.KADE_JEV_LOOSE; process.env.KADE_JEV = '0';
    assert.strictEqual(real.enabled('KADE_JEV_LOOSE'), false, 'global kill');
  } finally {
    for (const [name, v] of [['TYPESAFE_API_KEY', saved.k], ['KADE_JEV', saved.a], ['KADE_JEV_LOOSE', saved.l]]) {
      if (v === undefined) delete process.env[name]; else process.env[name] = v;
    }
  }
});

test('Jev failure: old behaviour, and the failure is not cached', async () => {
  const jev = fakeJev({}, { fail: true });
  const r = resolver(jev);
  const v = await r.resolve(LINE);
  assert.strictEqual(v, null);
  assert.strictEqual(server.rescue(LINE, v), server.rescue(LINE));
  assert.strictEqual(r.cache.size, 0);
});

test('Jev timeout: resolve gives up at the cap and the old behaviour stands', async () => {
  const jev = fakeJev({ 'quietly furious': ['delivery', 0] }, { hangMs: 400 });
  const t0 = Date.now();
  const v = await resolver(jev, { timeoutMs: 60 }).resolve(LINE);
  assert.ok(Date.now() - t0 < 300, 'resolve must not wait for a slow Jev');
  assert.strictEqual(v, null);
  assert.strictEqual(server.rescue(LINE, v), server.rescue(LINE));
});

test('known-vocab spans never reach Jev', async () => {
  const jev = fakeJev({});
  const text = '(softly) Hello. (a beat) *sighs* (slightly amused, a little smug) *rolls her eyes* (nods) Fine.';
  assert.deepStrictEqual(findUnknownSpans(text, server.looks), []);
  assert.strictEqual(await resolver(jev).resolve(text), null);
  assert.strictEqual(jev.calls.length, 0);
});

test('only the unknown spans are asked, each with its line', async () => {
  const jev = fakeJev({});
  await resolver(jev).resolve('(softly) Hello there.\n(quietly furious) You told me.\nServe it (warm) with butter.');
  assert.strictEqual(jev.calls.length, 1, 'one request for the whole message');
  assert.deepStrictEqual(jev.calls[0], [
    { span: 'quietly furious', line: '(quietly furious) You told me.' },
    { span: 'warm', line: 'Serve it (warm) with butter.' },
  ]);
});

test('an unknown span labelled delivery under the gate is lifted; one labelled spoken stays spoken', async () => {
  const jev = fakeJev({ 'quietly furious': ['delivery', 0.01], warm: ['spoken', 0.95] });
  const v = await resolver(jev).resolve(LINE);
  assert.deepStrictEqual([...v], [['quietly furious', 'delivery']]);
  assert.strictEqual(server.rescue(LINE, v),
    '%%%quietly furious%%% You told me you had handled it. Serve it (warm) with butter. %%%softly%%% Goodnight.');
});

test('a direction label that is not sure enough stays spoken (the gate is on P(spoken))', async () => {
  const jev = fakeJev({ 'quietly furious': ['delivery', 0.3] });
  const v = await resolver(jev).resolve(LINE);
  assert.strictEqual(v.size, 0);
  assert.strictEqual(server.rescue(LINE, v), server.rescue(LINE));
});

test('a missing probability counts as spoken', async () => {
  const jev = fakeJev({});
  jev.looseDirections = async (items) => items.map(() => ({ label: 'delivery', confidence: 1 }));
  const v = await resolver(jev).resolve('(quietly furious) You told me.');
  assert.strictEqual(v.size, 0);
});

test('timing, physical and silent verdicts drop the span; asterisk form too', async () => {
  const jev = fakeJev({ 'long silence': ['timing', 0], 'adjusts glasses': ['physical', 0], 'stares at the floor': ['silent', 0.02] });
  const text = 'I do not know. (long silence) Maybe. *adjusts glasses* Let me read that. (stares at the floor) Okay.';
  const v = await resolver(jev).resolve(text);
  assert.strictEqual(server.rescue(text, v), 'I do not know.  Maybe.  Let me read that.  Okay.');
});

test('the same words judged two ways in one message: neither is lifted', async () => {
  const jev = fakeJev({});
  jev.looseDirections = async (items) => items.map(({ line }) => (/^\(warm\)/.test(line)
    ? { label: 'delivery', confidence: 1, probabilities: { spoken: 0.02 } }
    : { label: 'spoken', confidence: 1, probabilities: { spoken: 0.95 } }));
  const text = '(warm) Oh honey, come here.\nServe it (warm) with butter.';
  const v = await resolver(jev).resolve(text);
  assert.strictEqual(v.size, 0);
  assert.strictEqual(server.rescue(text, v), text);
});

test('a verdict never reaches the same words in a shape we refused to ask about', async () => {
  // "*real*" is emphasis and is never asked; "(real)" lifted elsewhere must not eat it.
  const jev2 = fakeJev({ real: ['delivery', 0] });
  const t2 = '(real) Hello. That was a *real* surprise.';
  const v2 = await resolver(jev2).resolve(t2);
  assert.strictEqual(v2.size, 0);
  assert.strictEqual(server.rescue(t2, v2), t2);
});

test('cache hit avoids a second call, for lifted and for spoken verdicts alike', async () => {
  const jev = fakeJev({ 'quietly furious': ['delivery', 0.01], warm: ['spoken', 0.95] });
  const r = resolver(jev);
  const a = await r.resolve(LINE);
  const b = await r.resolve(LINE);
  assert.strictEqual(jev.calls.length, 1);
  assert.deepStrictEqual([...a], [...b]);
  // same span in a NEW line is a new question; the old line still rides the cache
  await r.resolve(LINE + '\nKeep it (warm) in the oven.');
  assert.strictEqual(jev.calls.length, 2);
  assert.deepStrictEqual(jev.calls[1], [{ span: 'warm', line: 'Keep it (warm) in the oven.' }]);
});

test('pre-filters: speech on its face is never sent', () => {
  for (const s of ['about 3 cups', 'RSVP', 'Script:', 'x', 'see https://a.b/c', 'she said it A BEAT and then she left the room', '%%cough%%', 'really?']) {
    assert.strictEqual(isCandidate(s, false), false, s);
  }
  assert.strictEqual(isCandidate('can', true), false, 'single *word* emphasis belongs to emphasisFromMarkdown');
  assert.strictEqual(isCandidate('winces', true), true);
  assert.strictEqual(isCandidate('quietly furious', false), true);
  assert.strictEqual(isCandidate('warm', false), true);
});

test('at most eight spans ride one request; the rest are left spoken', async () => {
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  const answers = {};
  for (const w of words) answers[w + ' mood'] = ['delivery', 0];
  const jev = fakeJev(answers);
  const text = words.map((w) => `(${w} mood) Line.`).join('\n');
  const v = await resolver(jev).resolve(text);
  assert.strictEqual(jev.calls[0].length, 8);
  assert.strictEqual(v.size, 8);
  assert.ok(!v.has('india mood') && !v.has('juliet mood'));
});

test('resolve never throws, whatever it is handed', async () => {
  const r = resolver(fakeJev({}));
  for (const bad of [undefined, null, 42, {}, '', 'no spans here']) assert.strictEqual(await r.resolve(bad), null);
  const broken = createLooseResolver({ looksLikeDirection: () => { throw new Error('boom'); }, jev: fakeJev({}) });
  assert.strictEqual(await broken.resolve('(quietly furious) Hi.'), null);
});
