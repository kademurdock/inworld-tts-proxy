'use strict';
// Findings 8 and 25 (Oct 16 2026). The public picker is a copy made at boot;
// the board's earlier moves replay about 15 s later and must reach it, and a
// "Wrong section?" report on one of the 421 Classic Inworld voices must apply.
// These run the real boot block and the real voice-moves state from server.js
// against the real catalog, so the wiring is tested, not a copy of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeRunner, applyReport } = require('./voice-moves');
const { createClassicVoiceMoves } = require('./classic-voice-moves');

const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (start, end) => {
  const i = source.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = source.indexOf(end, i);
  assert.ok(j > i, 'missing ' + end);
  return source.slice(i, j);
};

function bootServer() {
  const context = vm.createContext({
    FISH_VOICE_PREFIX: 'fish:', process: { env: { SELECTED_VOICES_ENABLED: '1' } }, console: { log() {}, warn() {} }, require,
    ...require('./private-voice-references'), classicPicker: require('./classic').classicPicker,
    FISH_PACES: require('./pace').FISH_PACES, fishExactOn: require('./pace').fishExactOn, FISH_TTS_MODEL: 'drama-3', FISH_REFERENCE_MODEL: 'drama-3',
  });
  vm.runInContext(cut('const OPENAI_ALIAS_MAP =', 'const MODEL_MAP =') + '\n' + cut('const VOICE_LIST =', 'const SAMPLE_TEXT ='), context);
  vm.runInContext('let selectedVoicePicker = null, selectedReferenceStore = null, selectedVoiceReport = null, selectedClassicMoves = null;\n' +
    'const selectedAuditionVoices = new Map();\n' +
    cut("if (process.env.SELECTED_VOICES_ENABLED === '1') {", "// Consumed by the fork's in-app voice pickers") +
    '\nthis.picker = selectedVoicePicker;\nthis.state = ({ ' + cut('state: { VOICE_MAP', 'port: PORT') + ' }).state;', context);
  return { picker: context.picker, state: context.state };
}

const detail = (label, heading, heard) => `Filed from the voice picker. Voice: ${label}. Filed under "${heading}" — sounds like: ${heard}.`;
const resolved = (id, label, heading, heard, createdAt) => ({ _id: id, createdAt, subject: 'Voice in the wrong section: x', status: 'resolved',
  detail: detail(label, heading, heard) + '\n\n[2026-09-16 → resolved] [auto-move] moved' });
const open = (id, label, heading, heard, createdAt) => ({ _id: id, createdAt, subject: 'Voice in the wrong section: x', status: 'open', detail: detail(label, heading, heard) });
function board(state, rows) {
  const posted = [];
  const runner = makeRunner({ state, port: 1, secret: 'offline', log() {}, warn() {}, jev: null, fetchImpl: async (url, opts = {}) => {
    if (opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => (url.includes('status=all') ? rows : rows.filter(r => r.status === 'open')) };
  } });
  return { runner, posted };
}
const servedJson = picker => JSON.parse(JSON.stringify(picker));
const sectionsHolding = (picker, label) => picker.categories.filter(c => c.voices.includes(label)).map(c => c.name);
const OLD = 'clear high young woman · summit';
const NEW = 'clear high youthful voice · summit';
const CLASSIC = OLD + ' (Classic)';

test('a replayed legacy move reaches the served picker: resolvable, renamed, with a provider, and its Classic entry moves (finding 8)', async () => {
  const { picker, state } = bootServer();
  assert.ok(picker.classic.includes(CLASSIC), 'the Sep 16 example is a Classic voice');
  const from = state.VOICE_PICKER_CATEGORIES.find(c => c.voices.includes(OLD)).name;
  const inworldId = state.VOICE_MAP[CLASSIC];
  assert.ok(inworldId && !inworldId.startsWith('fish:'));
  const before = servedJson(picker);
  assert.ok(!before.hidden.includes(NEW) && !before.providers[NEW], 'the boot copy does not know the moved label');

  const { runner } = board(state, [resolved('a'.repeat(24), OLD, from, 'a kid or a teen', '2026-09-16T10:00:00Z')]);
  assert.equal(await runner.replayResolved(), 1);
  const served = servedJson(picker);
  // The fork accepts a named pick only when it is in voices, hidden or aliases.
  assert.ok([...served.voices, ...served.hidden, ...served.aliases].includes(NEW), 'the moved label validates');
  assert.ok(served.hidden.includes(OLD) && served.hidden.includes(NEW));
  assert.equal(served.renames[OLD], NEW);
  assert.equal(served.providers[NEW], 'inworld', 'clients keep the Inworld speed policy');
  assert.equal(state.VOICE_MAP[NEW], state.VOICE_MAP[OLD]);
  assert.deepEqual(sectionsHolding(served, CLASSIC), ['Classic · Kids and teens']);
  assert.ok(served.voices.includes(CLASSIC), 'the Classic name itself is unchanged');
  assert.equal(state.VOICE_MAP[CLASSIC], inworldId, 'saved Classic picks speak the same voice');
  assert.ok(!served.voices.includes(NEW), 'legacy labels stay out of the visible list');

  // A later move of the new spelling follows the chain, in the picker too.
  const { runner: again } = board(state, [
    resolved('a'.repeat(24), OLD, from, 'a kid or a teen', '2026-09-16T10:00:00Z'),
    resolved('b'.repeat(24), NEW, 'Kids and teens', 'a woman', '2026-09-20T10:00:00Z'),
  ]);
  assert.equal(await again.replayResolved(), 1, 'the first row is already applied; the second moves it on');
  const newest = state.VOICE_PICKER_CATEGORIES.find(c => c.voices.some(v => v.endsWith('· summit')));
  const newestLabel = newest.voices.find(v => v.endsWith('· summit'));
  assert.equal(picker.renames[OLD], newestLabel, 'older renames point at the newest spelling');
  assert.equal(picker.renames[NEW], newestLabel);
  assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · ' + newest.name]);
});

test('a boot replay applies the same way after every restart', async () => {
  for (let restart = 0; restart < 2; restart++) {
    const { picker, state } = bootServer();
    const from = state.VOICE_PICKER_CATEGORIES.find(c => c.voices.includes(OLD)).name;
    const { runner } = board(state, [resolved('a'.repeat(24), OLD, from, 'a kid or a teen', '2026-09-16T10:00:00Z')]);
    await runner.replayResolved();
    assert.equal(picker.renames[OLD], NEW);
    assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · Kids and teens']);
  }
});

test('a "Wrong section?" report on a Classic voice moves its Classic entry and resolves the row (finding 25)', async () => {
  const { picker, state } = bootServer();
  const heading = sectionsHolding(picker, CLASSIC)[0];
  assert.match(heading, /^Classic · Women/);
  const legacyBefore = JSON.stringify(state.VOICE_PICKER_CATEGORIES);
  const mapBefore = JSON.stringify(state.VOICE_MAP);
  const { runner, posted } = board(state, [open('c'.repeat(24), CLASSIC, heading, 'a man', '2026-10-15T20:00:00Z')]);
  assert.equal(await runner.sweepOpen(), 1, 'the report applies instead of staying open');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].status, 'resolved');
  assert.match(posted[0].note, /^\[auto-move\] .+ \(Classic\) → Classic · Men, bright and clear, young \(live at once; its name and saved picks are unchanged\)\.$/);
  assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · Men, bright and clear, young']);
  assert.ok(picker.voices.includes(CLASSIC), 'the label is unchanged');
  assert.equal(JSON.stringify(state.VOICE_MAP), mapBefore, 'no binding changes: saved picks keep resolving');
  assert.equal(JSON.stringify(state.VOICE_PICKER_CATEGORIES), legacyBefore, 'the legacy list is not touched');
  // A second report confirms rather than moving twice.
  const repeat = applyReport(state, open('d'.repeat(24), CLASSIC, 'Classic · Men, bright and clear, young', 'a man', '2026-10-15T21:00:00Z'));
  assert.equal(repeat.ok, true); assert.equal(repeat.already, true);
  // The resolved row is replayed at the next boot and lands the same way.
  const restarted = bootServer();
  const row = { ...open('c'.repeat(24), CLASSIC, heading, 'a man', '2026-10-15T20:00:00Z'), status: 'resolved' };
  row.detail += '\n\n[2026-10-15 → resolved] ' + posted[0].note;
  const { runner: replay } = board(restarted.state, [row]);
  assert.equal(await replay.replayResolved(), 1);
  assert.deepEqual(sectionsHolding(restarted.picker, CLASSIC), ['Classic · Men, bright and clear, young']);
});

test('Classic reports: a kid choice, case-insensitive labels, an older report never undoes a newer one, unknown Classic names fall through', async () => {
  const { picker, state } = bootServer();
  const heading = sectionsHolding(picker, CLASSIC)[0];
  const kids = applyReport(state, open('e'.repeat(24), CLASSIC.toUpperCase(), heading, 'a kid or a teen', '2026-10-15T20:00:00Z'));
  assert.equal(kids.ok, true); assert.equal(kids.classic, true);
  assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · Kids and teens']);
  const older = applyReport(state, open('f'.repeat(24), CLASSIC, heading, 'a man', '2026-10-15T19:00:00Z'));
  assert.equal(older.superseded, true);
  assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · Kids and teens'], 'the newer report stands');
  assert.equal(older.target, 'Classic · Kids and teens', 'it names where the voice is now, not where the older report asked for');
  // The board note on the older row tells the truth.
  const { runner, posted } = board(state, [open('f'.repeat(24), CLASSIC, heading, 'a man', '2026-10-15T19:00:00Z')]);
  assert.equal(await runner.sweepOpen(), 1);
  assert.equal(posted[0].note, `[auto-move] A newer report already placed ${CLASSIC} under Classic · Kids and teens; this older report did not override it.`);
  assert.deepEqual(sectionsHolding(picker, CLASSIC), ['Classic · Kids and teens']);
  const unknown = applyReport(state, open('g'.repeat(24), 'Not a real voice (Classic)', 'Classic · Women', 'a man', '2026-10-15T20:00:00Z'));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.classic, undefined, 'only Classic entries this picker serves are handled here');
});

test('moving the last voice out of a Classic section drops the empty heading; a new one goes before "More Inworld voices"', () => {
  const picker = {
    voices: ['Fishy', 'a (Classic)', 'b (Classic)'], hidden: ['a', 'b'], renames: {}, providers: {}, describe: {}, tags: {},
    classic: ['a (Classic)', 'b (Classic)'],
    categories: [{ name: 'Women, Warm', voices: ['Fishy'] }, { name: 'Classic · Women, soft', voices: ['a (Classic)'] },
      { name: 'Classic · More Inworld voices', voices: ['b (Classic)'] }],
  };
  const legacy = { VOICE_MAP: { a: 'iw-a', b: 'iw-b' }, VOICE_DESCRIBE: {}, VOICE_TAGS: {},
    VOICE_PICKER_CATEGORIES: [{ name: 'Women, soft', voices: ['a woman · a'] }, { name: 'Men, soft and breathy', voices: [] }] };
  const moves = createClassicVoiceMoves(picker, legacy);
  const res = moves.applyClassicReport({ label: 'a (Classic)', heading: 'Classic · Women, soft', heard: 'a man' }, { createdAt: '1' });
  assert.equal(res.ok, true);
  assert.deepEqual(picker.categories.map(c => c.name), ['Women, Warm', 'Classic · Men, soft and breathy', 'Classic · More Inworld voices']);
  assert.deepEqual(picker.categories[1].voices, ['a (Classic)']);
  assert.deepEqual(picker.categories[0].voices, ['Fishy'], 'Fish sections are untouched');
});
