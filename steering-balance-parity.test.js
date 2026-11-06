'use strict';
// Nov 6 2026: "never worse than the old pairing". Two red teams and a code reviewer converged on the same finding:
// the balancer can only be judged against what the pairing did BEFORE it existed, on the shapes the platform
// really produces. This file runs the SHIPPED applySteeringTags twice, once with the balancer switched off (the
// old pairing, byte for byte) and once with the real one, and checks two things on ground-truth messages:
//   1. production-shaped replies (tight lowercase tags, the only shape in 7,148 real directions) come out
//      EXACTLY as the old pairing had them, and
//   2. with ONE stray run of any size at any position, the balancer is never wrong where the old pairing was right.
// (steering.reset.test.js loads the function the same way: a slice of the real server.js, never a copy.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sounds = require('./sounds');
const { balanceSteeringRuns } = require('./steering-balance');

const consoleLines = [];
function loadApplySteeringTags(balance) {
  const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const helperStart = src.indexOf('const CARRY_TEMPO_STRIP =');
  const start = src.indexOf('function applySteeringTags(text) {');
  assert.ok(helperStart > -1 && start > helperStart, 'applySteeringTags and its helper must be in server.js');
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > -1, 'could not bracket-match applySteeringTags');
  const ctx = {
    STEERING_OPEN: '%%%', STEERING_CLOSE: '%%%', STEER_CARRY_MAX: 2,
    soundsIsDirectionTag: sounds.isDirectionTag, soundsIsResetTag: sounds.isResetTag,
    balanceSteeringRuns: balance,
    vocalizeDirection: (s) => s,
    sanitizeDirectionText: (s) => String(s).replace(/\s{2,}/g, ' ').trim(),
    module: {}, exports: {}, process: { env: {} },
    console: { log: (...args) => consoleLines.push(args.join(' ')) },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(helperStart, end) + '\nthis.fn = applySteeringTags;', ctx);
  return ctx.fn;
}
const oldPairing = loadApplySteeringTags((s) => s);          // the balancer switched off
const withBalancer = loadApplySteeringTags(balanceSteeringRuns);

// what a listener hears: the [bracketed] directions and <tags> are not speech
const speechOf = (out) => String(typeof out === 'string' ? out : (out && out.text) || '').replace(/\[[^\]]*\]/g, ' ').replace(/<\/?[a-z]+>/gi, ' ');
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9']+/g) || []).join(' ');

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const PROSE = ["Yeah, you're right.", 'That is on me.', 'The paper trail is thin.', 'So what is the shape of it?', 'How far back have you gotten?', 'Two different problems.', 'I would go and look.', 'Not a chance.', 'Okay then, let us see.', 'I saved you the blue one.', "Everybody wanted blue, so I put it under my notebook before they came over."];
const DIRS = ['warm and curious', 'to correct with respect', 'a little amused', 'quietly', 'interested like she is leaning in', 'dry and flat', 'soft but sure', 'pleased', 'owning it', 'a beat'];

// A reply the way the real corpus has them: each paragraph opens on a tight lowercase tag, then speech.
function productionReply(r) {
  const paragraphs = [];
  const said = [];
  for (let p = 0, n = 1 + Math.floor(r() * 4); p < n; p++) {
    const sentences = [];
    for (let s = 0, m = 1 + Math.floor(r() * 3); s < m; s++) { const x = PROSE[Math.floor(r() * PROSE.length)]; sentences.push(x); said.push(x); }
    paragraphs.push({ dir: DIRS[Math.floor(r() * DIRS.length)], text: sentences.join(' ') });
  }
  return { paragraphs, said: said.join(' ') };
}
const render = (paragraphs, sep = '\n\n') => paragraphs.map((p) => `%%%${p.dir}%%% ${p.text}`).join(sep);

test('a balancer that throws leaves the old pairing in charge: a bug in it can never silence a voice', () => {
  const broken = loadApplySteeringTags(() => { throw new Error('balancer down'); });
  const msg = '%%%warm%%% Hello there.\n\n%%%\n%%%dry%%% Okay then.';
  const before = consoleLines.length;
  assert.deepEqual(broken(msg), oldPairing(msg));
  assert.match(consoleLines.slice(before).join('\n'), /steering-balance failed, old pairing used: balancer down/);
});

test('a lone percent sign at an end of a piece reaches the balancer and is dropped, a real percentage stays', () => {
  // a chunker that cuts a %%% delimiter in the middle leaves ONE lone % in a piece with no %% run at all; the
  // text goes through applySteeringTags before normalizeForSpeech, and the voice would say it as "percent"
  for (const input of ["% I saved you the blue one. It's under my notebook so nobody takes it.", 'Two different problems.\n\n%']) {
    assert.match(speechOf(oldPairing(input)), /%/, 'the old pairing hands the lone % on: ' + input);
    assert.doesNotMatch(speechOf(withBalancer(input)), /%/, 'the balancer drops it: ' + input);
  }
  for (const input of ['Sales are up 50%', 'It grew by ninety %', 'Revenue was 3.5 %', 'no percent signs at all']) {
    assert.equal(speechOf(withBalancer(input)).replace(/\s+/g, ' '), speechOf(oldPairing(input)).replace(/\s+/g, ' '), 'a real percentage is left alone: ' + input);
  }
});

test('production-shaped replies come out of the balancer exactly as the old pairing had them', () => {
  const r = rng(20261108);
  for (let trial = 0; trial < 3000; trial++) {
    const { paragraphs } = productionReply(r);
    for (const sep of ['\n\n', '\n', ' ']) {
      const msg = render(paragraphs, sep);
      assert.equal(balanceSteeringRuns(msg), msg, JSON.stringify(msg));
      assert.deepEqual(withBalancer(msg), oldPairing(msg), JSON.stringify(msg));
    }
  }
});

test('one stray run of any size at any position is never worse than the old pairing, on production-shaped replies', () => {
  const r = rng(20261109);
  let both = 0, saved = 0, hurt = 0;
  const examples = [];
  for (let trial = 0; trial < 2500; trial++) {
    const { paragraphs, said } = productionReply(r);
    const clean = render(paragraphs);
    const want = words(said);
    // every stray the platform could plausibly produce: own line, spaced, glued, before and after tags, any size
    const sizes = [2, 3, 4, 5, 6];
    const size = sizes[Math.floor(r() * sizes.length)];
    const stray = '%'.repeat(size);
    const cuts = [];
    // the words of a direction: a stray INSIDE them splits the direction (a two-percent one the old pairing simply
    // ignored), and what the right answer is then is a matter of opinion; the incident, and every stray seen in
    // the wild, sits BETWEEN the tags and the speech
    const insideBody = new Set();
    for (const m of clean.matchAll(/%%%[^%]*%%%/g)) for (let p = m.index + 4; p < m.index + m[0].length - 3; p++) insideBody.add(p);
    for (let at = 0; at <= clean.length; at++) {
      const before = clean[at - 1], here = clean[at];
      if (insideBody.has(at)) continue;
      if (before === '%' || here === '%') continue;                 // not inside a delimiter run
      // not in the middle of a word: a stray between two letters is `No%%%t` to the old pairing (the word stays
      // whole) but `hope%%%you` to a reader (two words), and no model produces either
      if (/[A-Za-z0-9]/.test(before || '') && /[A-Za-z0-9]/.test(here || '')) continue;
      cuts.push(at);
    }
    for (let k = 0; k < 6; k++) {
      const at = cuts[Math.floor(r() * cuts.length)];
      let style = Math.floor(r() * 4);
      // a line break belongs at the end of a sentence, after a tag or at the start: models do not break a line in the
      // middle of one (which would also make a line that starts in the middle of speech, a different matter)
      const prevSolid = clean.slice(0, at).trimEnd().slice(-1);
      if ((style === 0 || style === 3) && prevSolid && !/[.?!%]/.test(prevSolid)) style = 2;
      const piece = style === 0 ? '\n' + stray + '\n' : style === 1 ? ' ' + stray + ' ' : style === 2 ? stray : '\n' + stray;
      const msg = clean.slice(0, at) + piece + clean.slice(at);
      const okOld = words(speechOf(oldPairing(msg))) === want;
      const okNew = words(speechOf(withBalancer(msg))) === want;
      if (okOld && okNew) both++;
      else if (!okOld && okNew) saved++;
      else if (okOld && !okNew) { hurt++; if (examples.length < 3) examples.push(msg); }
    }
  }
  assert.equal(hurt, 0, `${hurt} messages the old pairing got right and the balancer got wrong; first: ${JSON.stringify(examples[0])}`);
  assert.ok(saved > 1000, `the balancer should repair a great many of them (repaired ${saved}, both right ${both})`);
});

// The final-bytes attacker's finding: the test above is the ONE-stray case, and with two strays in one reply the
// first rewrite was worse than the old pairing on 0.37% of natural cases (a tag closer extended by a stray plus
// any second stray silenced a whole reply; two doubled strays far apart or glued to punctuation paired as a tag).
test('two stray runs (sizes 2 to 5, one possibly glued to a tag closer) are never worse than the old pairing either', () => {
  const r = rng(20261110);
  let both = 0, saved = 0, hurt = 0;
  const examples = [];
  for (let trial = 0; trial < 2500; trial++) {
    const { paragraphs, said } = productionReply(r);
    const clean = render(paragraphs);
    const want = words(said);
    const insideBody = new Set();
    const closers = [];
    for (const m of clean.matchAll(/%%%[^%]*%%%/g)) {
      for (let p = m.index + 4; p < m.index + m[0].length - 3; p++) insideBody.add(p);
      closers.push(m.index + m[0].length);
    }
    const cuts = [];
    for (let at = 0; at <= clean.length; at++) {
      const before = clean[at - 1], here = clean[at];
      if (insideBody.has(at) || before === '%' || here === '%') continue;
      if (/[A-Za-z0-9]/.test(before || '') && /[A-Za-z0-9]/.test(here || '')) continue;
      cuts.push(at);
    }
    for (let k = 0; k < 6; k++) {
      const picks = [];
      for (let j = 0; j < 2; j++) {
        const onCloser = r() < 0.3;
        const at = onCloser ? closers[Math.floor(r() * closers.length)] : cuts[Math.floor(r() * cuts.length)];
        const size = [2, 3, 4, 5][Math.floor(r() * 4)];
        let style = onCloser ? 2 : Math.floor(r() * 4);
        const prevSolid = clean.slice(0, at).trimEnd().slice(-1);
        if ((style === 0 || style === 3) && prevSolid && !/[.?!%]/.test(prevSolid)) style = 2;
        picks.push({ at, size, style });
      }
      picks.sort((a, b) => b.at - a.at);              // from the end, so the earlier positions stay valid
      let msg = clean;
      for (const { at, size, style } of picks) {
        const stray = '%'.repeat(size);
        const piece = style === 0 ? '\n' + stray + '\n' : style === 1 ? ' ' + stray + ' ' : style === 2 ? stray : '\n' + stray;
        msg = msg.slice(0, at) + piece + msg.slice(at);
      }
      const okOld = words(speechOf(oldPairing(msg))) === want;
      const okNew = words(speechOf(withBalancer(msg))) === want;
      if (okOld && okNew) both++;
      else if (!okOld && okNew) saved++;
      else if (okOld && !okNew) { hurt++; if (examples.length < 3) examples.push(msg); }
    }
  }
  assert.equal(hurt, 0, `${hurt} messages the old pairing got right and the balancer got wrong; first: ${JSON.stringify(examples[0])}`);
  assert.ok(saved > 3000, `the balancer should repair a great many of them (repaired ${saved}, both right ${both})`);
});
