'use strict';
// Nov 6 2026 (red teams, steering-balance review): in a paragraph over 500 characters the sentence splitter and the chunk
// grouper dropped words and cut a [direction] in half.
//   DROP. splitSentences' pattern needed a blank or the end of the text after every stop, and when a stop had none ("3.5",
//   "example.com", "[a.b]") the engine skipped that stretch silently: "Version 3.5 is out." came back as "5 is out." and
//   the voice never said "Version 3".
//   CUT. A stop inside a [direction] ended a sentence ("[warm. smile]" became "[warm." and "smile]"), and the hard cut
//   for a sentence longer than the chunk size fell wherever the last space was, also inside a direction. The first request
//   then ended in a bracket that never closes and the next began with the rest of the direction and a stray "]": the voice
//   read "little tired" aloud as part of the speech.
// The real functions are sliced out of server.js. The pre-fix functions are kept below as the oracle: on text where the old
// ones lost nothing the new ones must give exactly the same answer.
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
const ctx = { process: { env: {} }, console };
vm.createContext(ctx);
vm.runInContext(between('const MAX_CHUNK_LEN', '// Aug 7 2026 (Kade: native "refuses') + '\nthis.fns = { splitSentences, groupSentences, chunkText };', ctx);
// (arrays made inside the vm context are of another realm: copy them into this one so that deepEqual can compare them)
const realm = (f) => (...args) => [...f(...args)];
const splitSentences = realm(ctx.fns.splitSentences);
const groupSentences = realm(ctx.fns.groupSentences);
const chunkText = realm(ctx.fns.chunkText);

// ── the oracle: the two functions as they were before the fix ───────────────────────────────────────────────────────
const OLD_ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'Mt', 'vs', 'etc', 'approx', 'Inc', 'Ltd', 'Co', 'Corp', 'Ave', 'Blvd', 'No', 'e.g', 'i.e', 'a.m', 'p.m', 'U.S', 'U.K', 'U.N'];
function oldSplitSentences(text) {
  if (!text) return [text];
  let masked = text.replace(/\.\.\.+/g, '\u0000ELLIPSIS\u0000');
  for (const abbr of OLD_ABBREVIATIONS) {
    const escaped = abbr.replace(/\./g, '\\.');
    masked = masked.replace(new RegExp(`\\b${escaped}\\.(?=\\s)`, 'gi'), (m) => m.split('.').join('\u0000DOT\u0000'));
  }
  const matches = masked.match(/[^.!?]+[.!?]+(?:["'”’»)\]}]|<\/(?:whisper|emphasis|soft|fast|slow|stress|forceful)>)*(\s+|$)|[^.!?]+$/g);
  const restore = (s) => s.split('\u0000ELLIPSIS\u0000').join('...').split('\u0000DOT\u0000').join('.');
  if (!matches) return [restore(masked).trim()].filter(Boolean);
  return matches.map((s) => restore(s).trim()).filter(Boolean);
}
function oldGroupSentences(text, maxChunkLen) {
  const sentences = oldSplitSentences(text);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChunkLen) {
      if (current) { chunks.push(current); current = ''; }
      let pos = 0;
      while (pos < sentence.length) {
        let end = Math.min(pos + maxChunkLen, sentence.length);
        if (end < sentence.length) {
          const window = sentence.slice(pos, end);
          const half = Math.floor(maxChunkLen / 2);
          const clause = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(' — '), window.lastIndexOf(' - '));
          const space = window.lastIndexOf(' ');
          if (clause > half) end = pos + clause + 1;
          else if (space > half) end = pos + space;
        }
        if (end <= pos) end = Math.min(pos + maxChunkLen, sentence.length);
        const piece = sentence.slice(pos, end).trim();
        if (piece) chunks.push(piece);
        pos = end;
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChunkLen && current) { chunks.push(current); current = sentence; } else { current = candidate; }
  }
  if (current) chunks.push(current);
  return chunks;
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const letters = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');
const balanced = (s) => { let d = 0; for (const c of s) { if (c === '[') d++; else if (c === ']') { d--; if (d < 0) return false; } } return d === 0; };
const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');

// ── nothing is dropped ──────────────────────────────────────────────────────────────────────────────────────────────
test('a stop that is not followed by a blank ends no sentence and loses no word: 3.5, example.com, a.b', () => {
  for (const [input, want] of [
    ['Version 3.5 is out. Fine.', ['Version 3.5 is out.', 'Fine.']],
    ['Visit example.com for details. Bye.', ['Visit example.com for details.', 'Bye.']],
    ['It costs 3.50 dollars!! Wow.', ['It costs 3.50 dollars!!', 'Wow.']],
    ['see (fig.2) and a.b.c done. Next.', ['see (fig.2) and a.b.c done.', 'Next.']],
    ['text [a.b] more.', ['text [a.b] more.']],
    ['A.B.C. Done.', ['A.B.C.', 'Done.']],
    // as before
    ['One. Two', ['One.', 'Two']],
    ['Dr. Smith said so... then left. Fine.', ['Dr. Smith said so... then left.', 'Fine.']],
    ['He said "stop." Then left.', ['He said "stop."', 'Then left.']],
    ['Come back!</soft> I found it.', ['Come back!</soft>', 'I found it.']],
    ['', ['']],
  ]) assert.deepEqual(splitSentences(input), want, JSON.stringify(input));
  // a run of stops or marks with nothing in front of it was never speech and is still not
  assert.deepEqual(splitSentences('?! Hello there.'), ['Hello there.']);
  assert.deepEqual(splitSentences('Hello. ?! Bye.'), ['Hello.', 'Bye.']);
  assert.deepEqual(splitSentences('Hello. ?!'), ['Hello.']);
  assert.deepEqual(splitSentences('?'), ['?']);
});

// ── a direction is never split ──────────────────────────────────────────────────────────────────────────────────────
test('a [direction] is never split by a stop inside it', () => {
  for (const [input, want] of [
    ['Hello [warm. smile] there. Then more.', ['Hello [warm. smile] there.', 'Then more.']],
    ['Wait [what? no! stop] now. Done.', ['Wait [what? no! stop] now.', 'Done.']],
    ['Hello. [warm. smile] There.', ['Hello.', '[warm. smile] There.']],
    ['[quietly. then louder] Go on.', ['[quietly. then louder] Go on.']],
    // a bracket that ends the sentence ends it, as before
    ['[Laughs.] Then he left.', ['[Laughs.]', 'Then he left.']],
    ['He said [softly: "Oh no."] and left. The end.', ['He said [softly: "Oh no."]', 'and left.', 'The end.']],
    ['Oh [what?!] Yes.', ['Oh [what?!]', 'Yes.']],
    // an unclosed bracket protects nothing
    ['Hello [there. And more.', ['Hello [there.', 'And more.']],
    ['Hello there]. And more.', ['Hello there].', 'And more.']],
  ]) assert.deepEqual(splitSentences(input), want, JSON.stringify(input));
  // ... and a bracket too long to be a direction protects nothing either, so it can never glue a whole text together
  const longSpan = '[' + 'a. '.repeat(200) + ']';
  assert.ok(splitSentences(longSpan + ' Done.').length > 100);
  // the limit is 400 characters between the brackets: a directions of 400 is whole, one of 401 is not
  const inside = (n) => '[' + 'x'.repeat(n - 3) + '. b' + ']';
  assert.deepEqual(splitSentences(inside(400) + ' Done.'), [inside(400) + ' Done.']);
  assert.deepEqual(splitSentences('Go on ' + inside(400) + ' Done.'), ['Go on ' + inside(400) + ' Done.']);
  assert.equal(splitSentences('Go on ' + inside(401) + ' Done.').length, 2);
  assert.deepEqual(splitSentences('Go [' + 'a. '.repeat(50) + 'b] Done.'), ['Go [' + 'a. '.repeat(50) + 'b] Done.']);
});

// ── the old answers are kept wherever the old function lost nothing ─────────────────────────────────────────────────
function ordinaryText(r, sentences) {
  const W = ['the', 'paper', 'trail', 'is', 'thin', 'Kade', 'said', 'we', 'could', 'go', 'look', 'at', 'it', 'again', 'tomorrow', '3', 'A', 'x1'];
  const ENDINGS = ['.', '.', '.', '!', '?', '?!', '...', '."', '.)', '!"', '.</soft>', '!!', '.”', ".'", '.’', '.»', '.}', '.]', '.</whisper>', '.</emphasis>', '.</fast>', '.</slow>', '.</stress>', '.</forceful>', '!)', '?"'];
  const SEPS = [' ', ' ', ' ', '  ', '\n', '\n\n'];
  let out = '';
  for (let s = 0; s < sentences; s++) {
    const n = 1 + Math.floor(r() * 12);
    const ws = [];
    for (let k = 0; k < n; k++) ws.push(W[Math.floor(r() * W.length)]);
    if (r() < 0.12) ws.splice(Math.floor(r() * ws.length), 0, ['Dr.', 'Mr.', 'e.g.', 'U.S.', 'approx.', 'etc.'][Math.floor(r() * 6)]);
    if (r() < 0.1) ws.splice(Math.floor(r() * ws.length), 0, 'wait...');
    out += ws.join(' ') + ENDINGS[Math.floor(r() * ENDINGS.length)] + (s < sentences - 1 || r() < 0.5 ? SEPS[Math.floor(r() * SEPS.length)] : '');
  }
  return out;
}
test('on ordinary text the new splitter and grouper answer exactly as the old ones did (30,000 texts)', () => {
  const r = rng(20261106);
  for (let trial = 0; trial < 30000; trial++) {
    const text = ordinaryText(r, 1 + Math.floor(r() * 8));
    assert.deepEqual(splitSentences(text), oldSplitSentences(text), JSON.stringify(text));
  }
  for (let trial = 0; trial < 3000; trial++) {
    const text = ordinaryText(r, 10 + Math.floor(r() * 50));
    for (const size of [500, 120]) assert.deepEqual(groupSentences(text, size), oldGroupSentences(text, size), size + ' ' + JSON.stringify(text));
  }
});

test('on any text at all no letter or digit is lost, in order; and a short [direction] always comes out whole', () => {
  const r = rng(20261107);
  const PIECES = ['the', 'paper', 'Kade', '3.5', 'a.b', 'example.com', 'Mr.', '...', '.', '!', '?', ' ', ' ', ' ', '\n', ')', '(', '"', 'x1', '. ', '! ', '? ', '[warm. smile]', '[a.b]', '[quietly]', '[what? no!]', '</soft>', '..'];
  for (let trial = 0; trial < 40000; trial++) {
    let text = '';
    for (let k = 1 + Math.floor(r() * 20); k > 0; k--) text += PIECES[Math.floor(r() * PIECES.length)] + (r() < 0.5 ? ' ' : '');
    const pieces = splitSentences(text);
    assert.equal(letters(pieces.join('')), letters(text), 'lost or reordered: ' + JSON.stringify([text, pieces]));
    for (const p of pieces) assert.ok(balanced(p) || !balanced(text), 'a direction was cut: ' + JSON.stringify([text, pieces]));
  }
});

// ── the hard cut ────────────────────────────────────────────────────────────────────────────────────────────────────
const PARA = 'Start of the thought, ' + words(88) + ' and then [warm, a little amused, still thinking it over] ' + words(20) + ' end.';
test('a sentence over the chunk size is cut in front of a [direction] that would be split, never inside it', () => {
  assert.ok(PARA.length > 500 && PARA.length < 700);
  const chunks = groupSentences(PARA, 500);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(balanced(c), 'cut inside the direction: ' + JSON.stringify(chunks));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), PARA.replace(/\s+/g, ' '));
  assert.ok(chunks.some((c) => c.startsWith('[warm, a little amused, still thinking it over]')), 'the direction opens the next chunk: ' + JSON.stringify(chunks.map((c) => c.slice(0, 40))));
  // the old grouper really did split it
  assert.ok(oldGroupSentences(PARA, 500).some((c) => !balanced(c)), 'the oracle should show the old bug');
  // chunkText takes the same road for a paragraph over the size
  for (const c of chunkText(PARA)) assert.ok(balanced(c), 'chunkText cut inside the direction');
});

test('a hard cut that would fall exactly in front of the closing bracket is moved in front of the direction', () => {
  // no blank and no clause in the back half of the window, so the plain rule cuts at 500, which is where the "]" sits
  const s = words(50) + ' [' + 'x'.repeat(249) + '] tail words here.';
  assert.equal(s.indexOf(']'), 500);
  const chunks = groupSentences(s, 500);
  for (const c of chunks) assert.ok(balanced(c), 'cut in front of the closing bracket: ' + JSON.stringify(chunks.map((x) => x.length)));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), s);
  assert.equal(chunks[0], words(50));
  assert.ok(chunks[1].startsWith('[xxx'));
  // ... or in front of the opening bracket, the last character of the window
  const t = words(50) + ' ' + 'x'.repeat(249) + '[a direction to the end] tail words here.';
  assert.equal(t.indexOf('['), 499);
  const parts = groupSentences(t, 500);
  for (const c of parts) assert.ok(balanced(c), 'cut after the opening bracket: ' + JSON.stringify(parts.map((x) => x.slice(-20))));
  assert.equal(parts.length, 2);
  assert.ok(parts[0].endsWith('xxx') && parts[1].startsWith('[a direction to the end] tail'));
});

test('a [direction] that starts the window and runs past the cut is taken whole; one too long to keep whole is cut as before', () => {
  const whole = '[' + words(110) + ']';                                    // 549 characters
  const a = groupSentences(whole + ' ' + words(30) + '.', 500);
  for (const c of a.slice(0, 1)) assert.ok(c.startsWith('[') && c.endsWith(']') && balanced(c), 'the direction comes out whole: ' + JSON.stringify(a.map((x) => x.length)));
  assert.equal(a.join(' ').replace(/\s+/g, ' '), (whole + ' ' + words(30) + '.').replace(/\s+/g, ' '));
  const huge = '[' + words(300) + ']';                                       // 1,501 characters: past twice the chunk size
  const b = groupSentences(huge + ' ' + words(10) + '.', 500);
  assert.equal(b.join(' ').replace(/\s+/g, ' '), (huge + ' ' + words(10) + '.').replace(/\s+/g, ' '), 'nothing lost, and no stall');
  assert.ok(b.every((c) => c.length <= 500));
});

test('fuzz: long paragraphs with short directions in them come out in whole chunks, with every word, and the old answer where there is no bracket (3,000)', () => {
  const r = rng(20261108);
  const W = ['the', 'paper', 'trail', 'is', 'thin', 'Kade', 'said', 'we', 'could', 'go', 'look', 'at', 'it', 'again'];
  const DIRS = ['warm', 'quietly amused and a little tired', 'dry, flat', 'a beat. then softer', 'wry?', 'soft but sure', 'interested like she is leaning in'];
  for (let trial = 0; trial < 3000; trial++) {
    let para = '';
    const sentences = 3 + Math.floor(r() * 10);
    const withBrackets = trial % 3 !== 0;
    for (let s = 0; s < sentences; s++) {
      const n = 4 + Math.floor(r() * (r() < 0.2 ? 130 : 30));          // some sentences run past the chunk size on their own
      const ws = [];
      for (let k = 0; k < n; k++) ws.push(W[Math.floor(r() * W.length)] + (r() < 0.08 ? ',' : ''));
      if (withBrackets) for (let d = r() < 0.7 ? 1 + Math.floor(r() * 2) : 0; d > 0; d--) ws.splice(Math.floor(r() * ws.length), 0, '[' + DIRS[Math.floor(r() * DIRS.length)] + ']');
      para += ws.join(' ') + ['.', '!', '?'][Math.floor(r() * 3)] + ' ';
    }
    para = para.trim();
    const chunks = groupSentences(para, 500);
    assert.equal(chunks.join(' ').replace(/\s+/g, ' '), para.replace(/\s+/g, ' '), 'a word was lost: ' + JSON.stringify(para));
    for (const c of chunks) {
      assert.ok(balanced(c), 'cut inside a direction: ' + JSON.stringify([c, para]));
      assert.ok(c.length <= 500 || c.includes('['), 'over the size with no direction to blame: ' + c.length);
      assert.ok(c.length <= 1000, 'far over the size: ' + c.length);
    }
    if (!withBrackets) assert.deepEqual(chunks, oldGroupSentences(para, 500), 'no bracket in it, so the old answer: ' + JSON.stringify(para));
  }
});

test('149,000 characters of every shape that made the splitter or the grouper work hard finish in a blink', () => {
  const rep = (unit, n = 149000) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  const t0 = Date.now();
  for (const [name, text] of [
    ['a run of exclamation marks', rep('!', 148999) + 'x'],
    ['a stop and a letter, over and over', rep('a.')],
    ['one long run, then a stop and a letter', rep('a', 148997) + '.b'],
    ['stops after closers, no blank', rep('.)')],
    ['brackets with stops in them', rep('[a. b] ')],
    ['unclosed brackets', rep('[a ')],
    ['brackets that never close, with stops', rep('[a. ')],
    ['one sentence, many short directions', rep('[w w] word ')],
    ['one sentence, no stop at all', rep('word ')],
    ['many sentences', rep('Hello there. ')],
  ]) {
    const t1 = Date.now();
    groupSentences(text, 500);
    assert.ok(Date.now() - t1 < 1000, `${name} took ${Date.now() - t1} ms`);
  }
  assert.ok(Date.now() - t0 < 5000);
});

// ── through the real handler ────────────────────────────────────────────────────────────────────────────────────────
async function withServer(port, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-brackets-'));
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
// One paragraph, one long sentence, a mid-paragraph direction that the 500-character cut would land inside.
// (the direction, once converted, spans characters 479 to 513, and the first window ends at 500)
const LONG = 'so ' + words(68, 'steady') + ' %%%quietly amused and a little tired%%% ' + words(40, 'again') + '.';
const SPOKEN = 'so ' + words(68, 'steady') + ' ' + words(40, 'again') + '.';

for (const [port, voice, label] of [[31977, 'alloy', 'Inworld'], [31978, 'fish:fixture', 'Fish']]) {
  test(`${label}: a direction in the middle of a paragraph over 500 characters reaches the voice whole, and none of its words as speech`, async () => {
    assert.ok(LONG.length > 600);
    await withServer(port, async ({ handed }) => {
      const reqs = await handed(LONG, { voice });
      assert.ok(reqs.length >= 2, `${reqs.length} request(s)`);
      for (const q of reqs) assert.ok(balanced(q.text), `${label} cut a direction in half: ${JSON.stringify(reqs.map((x) => [x.instruction, x.text.slice(0, 60), x.text.slice(-60)]))}`);
      const heard = reqs.map((q) => q.text).join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      assert.equal(heard, SPOKEN, `${label}: the speech must be exactly the speech`);
      assert.doesNotMatch(heard, /quietly|amused|tired/, `${label} spoke the direction`);
    });
  });
}
