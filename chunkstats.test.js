/* chunkstats.test.js — Aug 28 2026.
 *
 * Covers the two halves of the proxy's share of her "one section of the voice
 * clip gave an error sound" report:
 *
 *   1. THE RETRY LADDERS AGREE. The Inworld lane refused to retry a 5xx while
 *      its own sibling twenty lines below always has. This asserts the two
 *      retryable expressions are IDENTICAL, so the next person who widens one
 *      cannot silently leave the other behind — which is the actual bug, not
 *      the specific missing flag.
 *
 *   2. THE COUNTER. Chunk failures are counted per Central day so the next
 *      report arrives with a number attached instead of a log window that
 *      already rotated.
 *
 * ⚠️ HOUSE RULE, LEARNED THE HARD WAY (Aug 23 2026): the first source-guard
 * on this platform matched the COMMENT documenting the check, so its red-proof
 * stayed green. Everything below reads COMMENT-STRIPPED source.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

const RAW = fs.readFileSync(require.resolve('./server.js'), 'utf8');
/** Strip /* *​/ and // comments so a guard can never match prose about itself. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/[^\n]*/g, '$1');
}
const SRC = stripComments(RAW);

// ── 1. the two ladders agree ────────────────────────────────────────────────
test('both TTS retry ladders classify retryable the same way', () => {
  const found = [...SRC.matchAll(/const retryable = ([^;]+);/g)].map((m) =>
    m[1].split('||').map((s) => s.trim()).sort().join(' || ')
  );
  assert.strictEqual(found.length, 2, `expected two retry ladders, found ${found.length}`);
  assert.strictEqual(found[0], found[1],
    `the Inworld and fish ladders disagree:\n  ${found[0]}\n  ${found[1]}`);
  assert.ok(found[0].includes('err.isServerErr'),
    'a transient 5xx must be retryable on both lanes');
});

test('the Inworld error actually SETS the flag its ladder reads', () => {
  // A ladder that tests a flag nobody assigns is a retry that never happens.
  const inworldErr = SRC.slice(SRC.indexOf('Inworld API error'), SRC.indexOf('Inworld API error') + 600);
  assert.ok(/err\.isServerErr\s*=/.test(inworldErr),
    'isServerErr is read by the ladder but never set on the Inworld error');
});

// ── 2. the counter, extracted from the shipped source ───────────────────────
function loadCounter() {
  const ctx = { Intl, Date, Math, module: {}, exports: {} };
  vm.createContext(ctx);
  for (const name of ['centralDay', 'noteChunk', 'chunkStatsToday']) {
    const start = RAW.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} not found in server.js`);
    let depth = 0, i = RAW.indexOf('{', start), end = -1;
    for (; i < RAW.length; i++) {
      if (RAW[i] === '{') depth++;
      else if (RAW[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    vm.runInContext(RAW.slice(start, end), ctx);
  }
  vm.runInContext('const chunkStats = new Map();', ctx);
  // chunkStats must exist before the functions run — re-run them in its scope.
  const decl = RAW.slice(RAW.indexOf('const chunkStats = new Map()'), RAW.indexOf('async function synthesizeChunk('));
  vm.runInContext('delete this.chunkStats;', ctx);
  const ctx2 = { Intl, Date, Math };
  vm.createContext(ctx2);
  vm.runInContext(decl + '\nthis.noteChunk = noteChunk; this.chunkStatsToday = chunkStatsToday; this.centralDay = centralDay; this.chunkStats = chunkStats;', ctx2);
  return ctx2;
}
const C = loadCounter();

test('a Central day key is a real calendar day', () => {
  assert.match(C.centralDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test('counts land on today and start at zero', () => {
  const before = C.chunkStatsToday().failed;
  C.noteChunk('failed');
  C.noteChunk('ok'); C.noteChunk('ok');
  assert.strictEqual(C.chunkStatsToday().failed, before + 1);
  assert.strictEqual(C.chunkStatsToday().ok, 2);
});

test('the ring keeps three days and no more', () => {
  for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']) {
    C.chunkStats.set(d, { ok: 1, failed: 0, retried: 0 });
  }
  C.noteChunk('ok'); // triggers the trim
  assert.ok(C.chunkStats.size <= 3, `ring grew to ${C.chunkStats.size} days`);
  assert.ok(C.chunkStats.has(C.centralDay()), 'today must survive its own trim');
});

test('nothing about WHO was talking is stored', () => {
  const row = C.chunkStatsToday();
  assert.deepStrictEqual(Object.keys(row).sort(), ['failed', 'ok', 'retried']);
});
