'use strict';
// Nov 6 2026 (red teams, steering-balance review): rescueLooseDirections turned "(laughs)" and "*sighs*" into a %%% tag
// wherever it found them, INSIDE a %%% tag too, so `%%%dry (softly) and flat%%%` became `%%%dry %%%softly%%% and flat%%%`.
// The pairing that follows could repair only the shapes where the nested span closed the body; in the others the words
// after it ("and flat") were handed to the voice as speech. A [bracket] inside a body did the same through the other
// door: `%%%soft [sigh] but sure%%%` became the direction "soft [sigh" and the speech "but sure]".
// Now a direction inside a tag is just words of that tag (a clock or a silent gesture still goes, as it does outside),
// and the one chokepoint that makes a direction doc-conformant also drops brackets. The real functions are sliced out of
// server.js; the second half goes through the real HTTP handler on both providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
function between(a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  assert.ok(i > -1 && j > i, `server.js no longer holds ${a} .. ${b}`);
  return src.slice(i, j);
}
const ctx = { STEERING_OPEN: '%%%', STEERING_CLOSE: '%%%', process: { env: {} } };
vm.createContext(ctx);
vm.runInContext([
  between('const PHYSICAL_TO_VOCAL = [', 'const looseJev = require("./loose-jev")'),   // the word list and the rescue
  between('const TAG_SANITIZE_ON', 'const STEER_CARRY_MAX'),                             // sanitizeDirectionText
  'this.fns = { rescue: rescueLooseDirections, sanitize: sanitizeDirectionText };',
].join('\n'), ctx);
const { rescue, sanitize } = ctx.fns;

// ── the rescue ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('a direction inside a tag is words of that tag: nothing nests, and nothing after it is left over as speech', () => {
  for (const [input, want] of [
    ['%%%warm (laughs)%%% Hello there.', '%%%warm laughs%%% Hello there.'],
    ['%%%warm (laughs) and kind%%% Hello there.', '%%%warm laughs and kind%%% Hello there.'],
    ['%%%(laughs) warm%%% Hello there.', '%%%laughs warm%%% Hello there.'],
    ['%%%dry (softly) and flat%%% Hello there.', '%%%dry softly and flat%%% Hello there.'],
    ['%%%(softly)%%% Hello there.', '%%%softly%%% Hello there.'],
    ['%%%warm *sighs* and kind%%% Hello there.', '%%%warm sighs and kind%%% Hello there.'],
    ['%%%warm *a little amused*%%% Hello there.', '%%%warm a little amused%%% Hello there.'],
    ['%%%*sighs* warm%%% Hello there.', '%%%sighs warm%%% Hello there.'],
    ['%%%warm (softly) and *wryly* kind%%% Hello there.', '%%%warm softly and wryly kind%%% Hello there.'],
    ['%%%warm (rolls her eyes) and kind%%% Hello there.', '%%%warm rolls her eyes and kind%%% Hello there.'],  // the tag pass turns it into vocal colour
    // a six-sign run closes one tag and opens the next, so a span right behind it is still inside a tag
    ['%%%a%%%%%%(softly) b%%% hi', '%%%a%%%%%%softly b%%% hi'],
    // the typo forms the tag pass tolerates (two to five percent signs) are tags here too
    ['%%warm (laughs) and kind%% Hello there.', '%%warm laughs and kind%% Hello there.'],
    ['%%%%warm (laughs) and kind%%%% Hello there.', '%%%%warm laughs and kind%%%% Hello there.'],
    ['%%%%%warm (laughs) and kind%%%%% Hello there.', '%%%%%warm laughs and kind%%%%% Hello there.'],
    // what is not a direction is left exactly as written, in a tag or out of it
    ['%%%warm (twice) and kind%%% Hello there.', '%%%warm (twice) and kind%%% Hello there.'],
    ['%%%warm *really* kind%%% Hello there.', '%%%warm *really* kind%%% Hello there.'],
  ]) assert.equal(rescue(input), want, input);
});

test('a clock or a silent gesture inside a tag still goes, as it does outside one', () => {
  for (const [input, want] of [
    ['%%%warm (a beat) and kind%%% Hello there.', '%%%warm  and kind%%% Hello there.'],
    ['%%%warm (nods)%%% Hello there.', '%%%warm %%% Hello there.'],
    ['%%%(a beat)%%% Hello there.', '%%%%%% Hello there.'],
    ['Hello (a beat) there.', 'Hello  there.'],
    ['Hello (nods) there.', 'Hello %%%nods%%% there.'],           // outside a tag the tag pass drops it, as before
  ]) assert.equal(rescue(input), want, input);
});

test('outside a tag the same spans become tags exactly as they always did', () => {
  for (const [input, want] of [
    ['Hello (laughs) there.', 'Hello %%%laughs%%% there.'],
    ['Hello *sighs* there.', 'Hello %%%sighs%%% there.'],
    ['(softly) Hello there.', '%%%softly%%% Hello there.'],
    ['%%%warm%%% Hello (laughs) there.', '%%%warm%%% Hello %%%laughs%%% there.'],
    ['%%%warm%%% Hello there. %%%dry%%% Okay (softly) then.', '%%%warm%%% Hello there. %%%dry%%% Okay %%%softly%%% then.'],
    ['%%%a%%% hello (laughs) there %%%b%%% okay', '%%%a%%% hello %%%laughs%%% there %%%b%%% okay'],       // between two tags is speech
    ['%%%a%%%%%%b%%% hello (laughs) there', '%%%a%%%%%%b%%% hello %%%laughs%%% there'],                   // a six-sign junction closes one tag and opens the next
    ['It is 50% sure (laughs) ok.', 'It is 50% sure %%%laughs%%% ok.'],                                    // a single percent sign is a percentage, not a delimiter
    ['(softly)(softly)(softly) *sighs* %%%warm and kind%%% ok', '%%%softly%%%%%%softly%%%%%%softly%%% %%%sighs%%% %%%warm and kind%%% ok'],  // the asterisk pass reads the text the parenthesis pass left
    ['%%%a%%% (laughs)\n(softly) Hello.', '%%%a%%% %%%laughs%%%\n%%%softly%%% Hello.'],
    ['', ''],
  ]) assert.equal(rescue(input), want, JSON.stringify(input));
  assert.equal(rescue('No directions at all here, 50% sure.'), 'No directions at all here, 50% sure.');
});

test('the line decides: a tag opened on an earlier line does not reach this one, and a stray line before the tag changes nothing', () => {
  for (const [input, want] of [
    ['%%%warm and kind\n(laughs) Hello there.', '%%%warm and kind\n%%%laughs%%% Hello there.'],                  // the closer was forgotten
    ['%%%warm and kind\n*sighs* Hello there.', '%%%warm and kind\n%%%sighs%%% Hello there.'],
    ['%%%warm and kind\r\n(laughs) Hello there.', '%%%warm and kind\r\n%%%laughs%%% Hello there.'],
    // the asterisk pass reads the text the parenthesis pass left, so conversions in front of a tag change no offset
    ['(laughs) (softly) Hi. %%%warm *sighs* kind%%% Okay (nods) ok *wryly* done.', '%%%laughs%%% %%%softly%%% Hi. %%%warm sighs kind%%% Okay %%%nods%%% ok %%%wryly%%% done.'],
    ['%%%\n%%%warm%%% Hello (laughs) there.', '%%%\n%%%warm%%% Hello %%%laughs%%% there.'],                      // the incident's stray line
    ['Hello.\n\n%%%\n%%%warm (laughs)%%% Hello (softly) there.', 'Hello.\n\n%%%\n%%%warm laughs%%% Hello %%%softly%%% there.'],
    ['%%%warm%%% One (laughs).\n\n%%%dry (softly)%%% Two (sighs).', '%%%warm%%% One %%%laughs%%%.\n\n%%%dry softly%%% Two %%%sighs%%%.'],
  ]) assert.equal(rescue(input), want, JSON.stringify(input));
});

test('a long line and many spans are scanned once: the rescue stays linear', () => {
  const line = '%%%warm%%% ' + '(laughs) ok '.repeat(12000);               // 12,000 spans on one line
  const t0 = Date.now();
  const out = rescue(line);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.equal((out.match(/%%%laughs%%%/g) || []).length, 12000);
  const dense = '%%%a (b) %%% '.repeat(12000);
  const t1 = Date.now();
  rescue(dense);
  assert.ok(Date.now() - t1 < 1000, `took ${Date.now() - t1} ms`);
});

test('the second opinion (a Jev verdict) follows the same rule: words inside a tag, a tag outside, nothing for a clock', () => {
  const verdicts = new Map([['wistfully hopeful', 'delivery'], ['hand on the table', 'physical'], ['two seconds', 'timing']]);
  assert.equal(rescue('(wistfully hopeful) Hello there.', verdicts), '%%%wistfully hopeful%%% Hello there.');
  assert.equal(rescue('%%%warm (wistfully hopeful)%%% Hello there.', verdicts), '%%%warm wistfully hopeful%%% Hello there.');
  assert.equal(rescue('%%%warm *wistfully hopeful* kind%%% Hello there.', verdicts), '%%%warm wistfully hopeful kind%%% Hello there.');
  assert.equal(rescue('%%%warm (hand on the table)%%% Hello there.', verdicts), '%%%warm %%% Hello there.');
  assert.equal(rescue('Hello (two seconds) there.', verdicts), 'Hello  there.');
  assert.equal(rescue('Hello (hand on the table) there.', verdicts), 'Hello  there.');
});

// ── the brackets ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('a [bracket] inside a direction is words of it: a direction never carries a bracket of its own', () => {
  for (const [input, want] of [
    ['soft [sigh] but sure', 'soft sigh but sure'],
    ['warm [laughs]', 'warm laughs'],
    ['[laugh]', 'laugh'],
    ['[warm and kind]', 'warm and kind'],
    ['dry [softly]  and [flat]', 'dry softly and flat'],
    // everything else about the sanitiser is as it was
    ['Dry, flat.', 'dry and flat'],
    ["Interested like she's leaning in!", "interested like she's leaning in"],
    ['soft (but sure)', 'soft but sure'],
  ]) assert.equal(sanitize(input), want, input);
});

// ── through the real handler ─────────────────────────────────────────────────────────────────────────────────────────
async function withServer(port, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-nesting-'));
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
    const handed = async (input, body) => {
      const before = rows().length;
      const r = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, ...body }) });
      assert.equal(r.status, 200, log.slice(-1500));
      await r.arrayBuffer();
      return rows().slice(before).map((x) => ({ text: x.body.text, instruction: x.body.instruction || null }));
    };
    return await run({ handed });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}
const speechOf = (reqs) => reqs.map((q) => q.text).join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const SPEECH = 'Hello there, friend. How are you doing today?';

// [name, message, the instruction Inworld is given, a regex the text must match, a regex that must not match the speech]
const NESTED = [
  ['a sound at the end', '%%%warm (laughs)%%% ' + SPEECH, 'warm laughs'],
  ['a sound in the middle', '%%%warm (laughs) and kind%%% ' + SPEECH, 'warm laughs and kind'],
  ['a sound at the start', '%%%(laughs) warm%%% ' + SPEECH, 'laughs warm'],
  ['a manner in the middle', '%%%dry (softly) and flat%%% ' + SPEECH, 'dry softly and flat'],
  ['a manner alone', '%%%(softly)%%% ' + SPEECH, 'softly'],
  ['an asterisk span in the middle', '%%%warm *sighs* and kind%%% ' + SPEECH, 'warm sighs and kind'],
  ['an asterisk span of three words', '%%%warm *a little amused*%%% ' + SPEECH, 'warm a little amused'],
  ['a clock in the middle', '%%%warm (a beat) and kind%%% ' + SPEECH, 'warm and kind'],
  ['a bracket in the middle', '%%%soft [sigh] but sure%%% ' + SPEECH, 'soft sigh but sure'],
  ['a bracket at the end', '%%%warm [laughs]%%% ' + SPEECH, 'warm laughs'],
  ['a bracket round the whole direction', '%%%[warm and kind]%%% ' + SPEECH, 'warm and kind'],
];

test('Inworld: a direction nested in a tag reaches the voice as one direction, and none of its words as speech', async () => {
  await withServer(31973, async ({ handed }) => {
    for (const [name, input, instruction] of NESTED) {
      const reqs = await handed(input, { voice: 'alloy' });
      assert.equal(reqs.length, 1, name + ' ' + JSON.stringify(reqs));
      assert.equal(reqs[0].instruction, instruction, `${name}: ${JSON.stringify(reqs)}`);
      assert.equal(reqs[0].text, SPEECH, `${name}: ${JSON.stringify(reqs)}`);
    }
    // a sound that is the whole tag is a sound, as before
    const lone = await handed('%%%[laugh]%%% ' + SPEECH, { voice: 'alloy' });
    assert.deepEqual(lone, [{ text: '[laugh] ' + SPEECH, instruction: null }]);
    // outside a tag they are what they were
    const outside = await handed('Hello (laughs) there. *Sighs* Okay then (softly) friend.', { voice: 'alloy' });
    assert.equal(outside.map((q) => q.text).join(' '), 'Hello [laughs] there. [sighs] Okay then [softly] friend.');
  });
});

test('Fish: the same nested directions never put a bracket or a direction word into the speech', async () => {
  await withServer(31974, async ({ handed }) => {
    for (const [name, input] of NESTED) {
      const reqs = await handed(input, { voice: 'fish:fixture' });
      const joined = reqs.map((q) => q.text).join(' ');
      assert.equal(speechOf(reqs), SPEECH, `${name}: ${JSON.stringify(reqs)}`);
      assert.equal((joined.match(/\[/g) || []).length, (joined.match(/\]/g) || []).length, `${name} unbalanced: ${joined}`);
      assert.doesNotMatch(joined, /\[[^\]]*\[|\][^\[]*\]/, `${name} nests: ${joined}`);
      assert.doesNotMatch(joined, /%/, name);
    }
  });
});

// A seeded fuzz of the same: a tag of two marker words with any of the nested forms between them, then speech.
// No marker may ever be heard, the speech must come through whole, and no bracket may be left over.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
test('fuzz: tags with nested directions, brackets and clocks never leak a word into the speech (Inworld and Fish)', async () => {
  const r = rng(20261106);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const NEST = ['(laughs)', '(softly)', '*sighs*', '*wryly*', '*a little amused*', '(a beat)', '(nods)', '[sigh]', '[laugh]', '[warm]', '(twice)', '(rolls her eyes)', '(wistfully)', '*softly*'];
  const cases = [];
  for (let k = 0; k < 90; k++) {
    const nests = [];
    for (let n = 1 + Math.floor(r() * 2); n > 0; n--) nests.push(pick(NEST));
    const parts = [`zq${k}a`, nests[0], `zq${k}b`];
    if (nests[1]) parts.push(nests[1], `zq${k}c`);
    if (r() < 0.3) parts.shift();                                            // the nested span first
    if (r() < 0.3) parts.pop();                                              // ... or last
    cases.push({ k, input: `%%%${parts.join(' ')}%%% ${SPEECH}` });
  }
  for (const [port, voice] of [[31975, 'alloy'], [31976, 'fish:fixture']]) {
    await withServer(port, async ({ handed }) => {
      for (const { k, input } of cases) {
        const reqs = await handed(input, { voice });
        const heard = speechOf(reqs);
        const joined = reqs.map((q) => q.text).join(' ');
        // (a marker word may sit in a [direction] or in the instruction, that is where it belongs; the speech must be exactly the speech)
        assert.equal(heard, SPEECH, `${voice}: ${JSON.stringify([input, reqs])}`);
        assert.doesNotMatch(heard, new RegExp(`zq${k}[abc]`), `${voice} spoke a marker: ${JSON.stringify([input, reqs])}`);
        assert.equal((joined.match(/\[/g) || []).length, (joined.match(/\]/g) || []).length, `${voice} unbalanced: ${JSON.stringify([input, reqs])}`);
        assert.doesNotMatch(joined, /%/, input);
      }
    });
  }
});
