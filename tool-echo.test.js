'use strict';
// Nov 13 2026: Kade heard a tool call read aloud at the end of a reply from Kiana. No tool ran on that turn: the model wrote
// "Tool: kade_research, === Deep Research Context ===" and her own question under it, copying what the agents library puts at
// the end of its earlier replies when a tool is no longer attached. tool-echo.js cuts everything from the line that begins
// "Tool: <a tool name>, " to the end of the text before a voice gets it. This file is the rule itself:
//   - the Nov 13 reply and the Oct 15 shape, and what counts as a tool name;
//   - ordinary text that must never be cut;
//   - what may follow the comma (a space, a tab, a line break, or nothing: the end of a trimmed text; a tab and a line break
//     only since the review of Nov 13, which found them cut on the website and spoken here), and the one thing the voice
//     adds (a direction stamped in front of a piece);
//   - the rule against a pattern written the plain way (the oracle), on every string of a small alphabet and on random texts;
//   - the gate for text that arrives in pieces, against the whole-text rule on every way of cutting a text up;
//   - the log line (lane, tool name, characters; never the words), the off switch, and the clock: 200,000 characters.
// tool-echo.wire.test.js and tool-echo-ask.wire.test.js drive the same rule through the real routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { toolEchoOn, isToolName, findToolEcho, cutToolEcho, createToolEchoGate, PLATFORM_TOOLS } = require('./tool-echo');

const SAID = "there's tons of content with no description available and people left sitting in the dark.";
const ECHO = 'Tool: kade_research, === Deep Research Context ===\n\n# Your Question, Stated\nKade asked: If she creates an app where a phone listens to a TV playing a film ... Could she monetize it, or does it have to be free?';
const NOV13 = SAID + '\n' + ECHO;   // the end of the saved reply, as it was stored

const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);   // the Unicode line and paragraph separators
const ENV = {};                                                              // the switch unset, whatever this machine has set
const quiet = () => {};
const cut = (text, opts = {}) => cutToolEcho(text, { env: ENV, log: quiet, ...opts });
function logged(text, opts = {}) {
  const lines = [];
  const out = cutToolEcho(text, { env: ENV, ...opts, log: (line) => lines.push(line) });
  return { out, lines };
}
function throughGate(pieces, opts = {}) {
  const lines = [];
  const gate = createToolEchoGate({ env: ENV, ...opts, log: (line) => lines.push(line) });
  let out = '';
  for (const piece of pieces) out += gate.push(piece);
  out += gate.end();
  return { out, lines };
}
// What the gate must pass on: the text up to the line where the echo starts (the whole-text rule, before its trim).
const kept = (text, known) => { const f = findToolEcho(text, known); return f ? text.slice(0, f.at) : text; };
const inPieces = (text, size) => { const out = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out; };

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const LIMIT_MS = 1000;   // the rule needs a few milliseconds; a pattern that backs up needs seconds
function clock(label, fn) {
  let ms = Infinity;
  let out;
  for (let attempt = 0; attempt < 3 && ms >= LIMIT_MS; attempt++) {   // a stalled machine is not a slow rule: a slow rule is slow every time
    const t0 = process.hrtime.bigint();
    out = fn();
    ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
    if (ms >= 20 * LIMIT_MS) break;
  }
  assert.ok(ms < LIMIT_MS, `${label} took ${ms.toFixed(0)} ms`);
  return out;
}
const BIG = 200000;
const rep = (unit, n = BIG) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

// ── the oracle: the rule written the plain way, one line at a time ────────────────────────────────────────────────────
// A line: any number of directions (%%%...%%% with no %%% inside, then blanks), "Tool: ", a name, a comma, and then a space,
// a tab, or the end of the line (a line break, or the end of the text). The directions end within 240 characters, the name
// within 128.
const ORACLE_BREAK = new RegExp('[\\n\\r' + LS + PS + ']');
const ORACLE_LINE = /^((?:%%%(?:(?!%%%).)*%%%[ \t]*)*)Tool: ([A-Za-z0-9_]+),(?:[ \t]|$)/;
const ORACLE_PLATFORM = ['web_search', 'file_search', 'execute_code', 'tool_search', 'subagent', 'flux'];
function oracle(text, known = []) {
  const lines = text.split(ORACLE_BREAK);
  let at = 0;
  for (let k = 0; k < lines.length; k++) {
    const m = ORACLE_LINE.exec(lines[k]);
    if (m && m[1].length <= 240 && m[2].length <= 128 &&
        (m[2].includes('_') || ORACLE_PLATFORM.includes(m[2]) || known.includes(m[2]))) return { at, name: m[2] };
    at += lines[k].length + 1;
  }
  return null;
}

test('the Nov 13 reply ends where she stopped talking', () => {
  assert.deepEqual(findToolEcho(NOV13), { at: SAID.length + 1, name: 'kade_research' });
  const { out, lines } = logged(NOV13, { lane: 'fork-tts' });
  assert.equal(out, SAID);
  assert.deepEqual(lines, [`[tool-echo] cut: lane=fork-tts tool=kade_research chars=${ECHO.length} of ${NOV13.length}`]);
  assert.equal(cut(SAID), SAID, 'the reply without the line is left as it is');
});

test('the Oct 15 shape: web_search and thousands of characters of results after it', () => {
  const results = 'Tool: web_search, === Web Results, Turn 0 ===\n' + rep('Source 3: a page about it (https://example.com/a?b=1)\nSnippet: words, words. More words!\n\n', 9000);
  const reply = '%%%easy and sure%%% Here is what I found so far.\n\nIt is mostly good news.';
  assert.equal(cut(reply + '\n' + results), reply);
  assert.equal(cut(reply + '\n' + results + '\nTool: kade_news, === News ===\nmore'), reply, 'a second echo behind the first changes nothing');
  assert.equal(findToolEcho(reply + '\n' + results + '\nTool: kade_news, x').name, 'web_search', 'the first one is the one named');
});

test('what counts as a tool name: the platform\'s own, every kade_ name, any run of letters, digits and underscores with an underscore', () => {
  const names = [
    ...PLATFORM_TOOLS,
    'kade_research', 'kade_news', 'kade_weather', 'kade_lookup', 'kade_read_page', 'kade_media', 'kade_notify', 'kade_help',
    'kade_memory_search', 'kade_wikipedia', 'kade_location', 'kade_feedback', 'kade_', 'kade_anything_at_all',
    'get_weather', 'tavily_search_results_json', 'search_issues_mcp_github', 'a_b', 'A_1', '9_lives', '_', '__', 'x_', '_x',
  ];
  assert.deepEqual([...PLATFORM_TOOLS].sort(), ['execute_code', 'file_search', 'flux', 'subagent', 'tool_search', 'web_search']);
  for (const name of names) {
    assert.equal(isToolName(name), true, name);
    assert.equal(cut(`Before it.\nTool: ${name}, and its output`), 'Before it.', name);
    assert.deepEqual(findToolEcho(`Before it.\nTool: ${name}, x`), { at: 11, name }, name);
  }
  for (const name of ['hammer', 'search', 'calculator', 'Flux', 'FLUX', 'fluxx', 'flu', 'subagents', 'Subagent', 'websearch', 'kade', 'Kade', 'x', '9', '']) {
    assert.equal(isToolName(name), false, JSON.stringify(name));
    const text = `Before it.\nTool: ${name}, and more`;
    assert.equal(cut(text), text, JSON.stringify(name));
  }
  for (const notAName of [undefined, null, 7, {}, ['web_search']]) assert.equal(isToolName(notAName), false);
});

test('a name the caller knows counts too, as an array or a Set; a known name is only ever a run of letters, digits and underscores', () => {
  const text = 'Before it.\nTool: calculator, 4';
  assert.equal(cut(text), text);
  assert.equal(cut(text, { known: ['calculator'] }), 'Before it.');
  assert.equal(cut(text, { known: new Set(['calculator']) }), 'Before it.');
  assert.equal(cut(text, { known: 'calculator' }), 'Before it.');
  assert.equal(cut(text, { known: ['calc', 'calculators', '', null, 7] }), text, 'not a part of a known name, and nothing that is not a name');
  assert.equal(cut(text, { known: [] }), text);
  assert.equal(cut(text, { known: new Set() }), text);
  assert.deepEqual(findToolEcho(text, ['calculator']), { at: 11, name: 'calculator' });
  assert.equal(isToolName('calculator', ['calculator']), true);
  assert.equal(isToolName('calculator', new Set(['dalle'])), false);
  const hyphen = 'Before it.\nTool: azure-ai-search, x';
  assert.equal(cut(hyphen, { known: ['azure-ai-search'] }), hyphen, 'a name with a hyphen is never looked for (none is known to this service)');
  const { out, lines } = throughGate(inPieces(text, 3), { known: ['calculator'] });
  assert.equal(out, 'Before it.\n');
  assert.equal(lines.length, 1);
});

test('ordinary text is never touched', () => {
  const longLead = '%%%' + 'a'.repeat(240) + '%%% ';   // a "direction" too long to be one
  const texts = [
    'Tool: hammer, nails',
    'Tools: a list',
    'Tools: web_search, file_search',
    'The tool: web_search, was slow today.',
    'I used this.\nThe Tool: web_search, came back empty.',
    'I used the Tool: web_search, and it was slow.\nThen I gave up.',
    '  Tool: web_search, indented',
    '\tTool: web_search, behind a tab',
    ' \nx Tool: web_search, y',
    '- Tool: web_search, in a list',
    '1. Tool: web_search, in a numbered list',
    '> Tool: web_search, quoted',
    '**Tool: web_search, bold**',
    '"Tool: web_search, quoted"',
    'tool: web_search, lower case',
    'TOOL: web_search, upper case',
    'Tool:web_search, no space after the colon',
    'Tool:  web_search, two spaces after the colon',
    'Tool : web_search, a space before the colon',
    'Tool: web_search. A full stop, not a comma',
    'Tool: web_search: a colon',
    'Tool: web_search; a semicolon',
    'Tool: web_search ,a space before the comma',
    'Tool: web_search,no space after the comma',
    'Tool: web_search,,\ntwo commas',
    'Tool: web_search,\u00a0a no-break space after the comma',
    'Tool: web_search,\u000ba vertical tab after the comma',
    'Tool: web_search,\fa form feed after the comma',
    'Tool: hammer,\nnails, the comma ends its line behind no tool name',
    'Tool: hammer,\tnails',
    'Tool: web_search',
    'Tool: web_search\nand a new line',
    'Tool: web search, two words',
    'Tool: web-search, a hyphen',
    'Tool: web.search, a full stop inside',
    'Tool: wéb_search, a letter outside a to z',
    'Tool: flux capacitor, obviously',
    'Tool: subagent smith, hello',
    'Tool: , nothing',
    'Tool: ,',
    'Tool: ',
    'Tool:',
    'Tool',
    'T',
    '',
    'Tool: ' + 'a_'.repeat(64) + 'a, a name of 129 characters',
    'Hello %%%warm%%% Tool: web_search, a direction that does not open the line',
    'a%%%warm%%% Tool: web_search, x',
    ' %%%warm%%% Tool: web_search, a blank in front of the direction',
    '%%%warm%%% and then Tool: web_search, words in between',
    '%%%warm%%% - Tool: web_search, a bullet in between',
    '%%%warm%%%\n  Tool: web_search, on the next line and indented',
    '%%%warm\n%%% Tool: web_search, the direction spans a line break',
    '%%%warm Tool: web_search, the direction never closes',
    '%%warm%% Tool: web_search, two percent signs are no direction',
    '%%%%warm%%% Tool: hammer, nails',
    '%%%a%%%b%%% Tool: web_search, speech between two runs',
    '%%%warm%%%% Tool: web_search, a fourth percent sign after the closer',
    '%%%warm%%% %% Tool: web_search, half a run behind the direction',
    '%%%warm%%% Tool: hammer, nails',
    '%%%warm%%% Tools: web_search, x',
    longLead + 'Tool: web_search, x',
    '%%%a%%%' + ' '.repeat(240) + 'Tool: web_search, too far from the line start',
    '%%%a%%%' + ' '.repeat(234) + 'Tool: web_search, 241 characters from the line start: one too far',
    '%%%' + 'a'.repeat(235) + '%%%Tool: web_search, the same with a direction that long',
    'A sentence about the kade_research tool, the web_search tool and Tool: names in general.',
    'Kiana said the Tool: kade_research, line out loud.',
  ];
  for (const text of texts) {
    assert.equal(findToolEcho(text), null, JSON.stringify(text));
    const { out, lines } = logged(text);
    assert.equal(out, text, JSON.stringify(text));
    assert.deepEqual(lines, [], 'no log line: ' + JSON.stringify(text));
    assert.deepEqual(oracle(text), null, 'the oracle agrees: ' + JSON.stringify(text));
    for (const size of [1, 2, 5, 1000]) assert.equal(throughGate(inPieces(text, size)).out, text, `in pieces of ${size}: ` + JSON.stringify(text));
  }
});

test('the echo is cut from the start of its line, wherever that line starts', () => {
  for (const [text, want, name = 'web_search'] of [
    ['Tool: kade_news, at the very start', '', 'kade_news'],
    ['One.\nTwo.\nTool: web_search, results', 'One.\nTwo.'],
    ['One.\r\nTool: web_search, results', 'One.'],
    ['One.\rTool: web_search, results', 'One.'],
    ['One.' + LS + 'Tool: web_search, results', 'One.'],
    ['One.' + PS + 'Tool: web_search, results', 'One.'],
    ['One.\n\n\nTool: web_search, results', 'One.'],
    ['One.  \n \t\nTool: web_search, results', 'One.'],
    ['  One.\nTool: web_search, results', '  One.'],
    ['One.\nTool: web_search, a\nTool: kade_news, b', 'One.'],
    ['Tool: hammer, nails\nTool: web_search, results', 'Tool: hammer, nails'],
    ['One.\nTool: web_search, ', 'One.'],
    ['One.\nTool: web_search, \n', 'One.'],
    ['One.\nTool: web_search, \nTwo.', 'One.'],
    ['One.\nTool: web_search,  two spaces', 'One.'],
    ['One.\nTool: flux, a picture', 'One.', 'flux'],
    ['One.\nTool: subagent, done', 'One.', 'subagent'],
    ['One.\nTool: Some_Tool_9, x', 'One.', 'Some_Tool_9'],
    ['One.\nTool: ' + 'a_'.repeat(64) + ', a name of 128 characters', 'One.', 'a_'.repeat(64)],
  ]) {
    assert.equal(cut(text), want, JSON.stringify(text));
    assert.deepEqual(findToolEcho(text), { at: kept(text).length, name }, JSON.stringify(text));
    assert.deepEqual(oracle(text), findToolEcho(text), 'the oracle agrees: ' + JSON.stringify(text));
  }
});

test('text is trimmed on its way to a voice: a tool name and its comma at the very end of the text count', () => {
  assert.equal(cut('One.\nTool: kade_research,'), 'One.');
  assert.equal(cut('Tool: kade_research,'), '');
  assert.equal(cut('%%%warm%%% Tool: kade_research,'), '');
  // ... but only behind a tool name and its comma (the comma that ends its line, not the text: the next test)
  for (const text of ['One.\nTool: kade_research,x', 'One.\nTool: hammer,', 'One.\nTool: kade_research', 'One.\nTool: kade_research ,']) {
    assert.equal(cut(text), text, JSON.stringify(text));
  }
  // the chain itself trims: the reply's last line was "Tool: kade_research, " and stripThinkingBlock took the space
  assert.equal(cut((SAID + '\nTool: kade_research, ').trim()), SAID);
});

test('the comma may end its line: a tab or a line break after it counts as a space does, as on the website (review of Nov 13)', () => {
  // The website cut "Tool: kade_research," with a line break or a tab right after the comma, and the voice spoke that line:
  // it took only a space, or the end of the text, after the comma.
  for (const [text, want, name = 'kade_research'] of [
    ['Said it.\nTool: kade_research,\n=== Deep Research Context ===', 'Said it.'],
    ['Said it.\nTool: kade_research,\t=== Deep Research Context ===', 'Said it.'],
    ['Said it.\nTool: kade_research,\r\n=== x', 'Said it.'],
    ['Said it.\r\nTool: kade_research,\r\n=== x', 'Said it.'],
    ['Said it.\nTool: kade_research,\r=== x', 'Said it.'],
    ['Said it.\nTool: kade_research,' + LS + '=== x', 'Said it.'],
    ['Said it.\nTool: kade_research,' + PS + '=== x', 'Said it.'],
    ['Said it.\nTool: kade_research,\n', 'Said it.'],
    ['Said it.\nTool: kade_research,\nTwo.', 'Said it.'],
    ['Said it.\nTool: kade_research,\t', 'Said it.'],
    ['Said it.\nTool: kade_research,\t\n=== x', 'Said it.'],
    ['Said it.\nTool: kade_research,\n\nTool: web_search, more', 'Said it.'],
    ['Tool: kade_research,\nx', ''],
    ['%%%warm%%% Tool: kade_research,\n=== x', ''],
    ['One.\n%%%warm%%%\tTool: web_search,\t=== Web Results ===', 'One.', 'web_search'],
    ['One.\nTool: _,\nx', 'One.', '_'],
    [SAID + '\n' + ECHO.replace(', ===', ',\n==='), SAID],
  ]) {
    assert.equal(cut(text), want, JSON.stringify(text));
    assert.deepEqual(findToolEcho(text), { at: kept(text).length, name }, JSON.stringify(text));
    assert.deepEqual(oracle(text), findToolEcho(text), 'the oracle agrees: ' + JSON.stringify(text));
    // the gate, on every way of cutting the text in two (the cut right behind the comma among them) and in pieces
    for (let k = 1; k < text.length; k++) {
      const got = throughGate([text.slice(0, k), text.slice(k)]).out;
      if (got !== kept(text)) assert.equal(got, kept(text), JSON.stringify([text.slice(0, k), text.slice(k)]));
    }
    for (const size of [1, 2, 3, 1000]) assert.equal(throughGate(inPieces(text, size)).out, kept(text), `in pieces of ${size}: ` + JSON.stringify(text));
  }
  assert.equal(cut('Said it.\nTool: calculator,\n4', { known: ['calculator'] }), 'Said it.', 'a name the caller knows');
  // ... and still only behind a tool name and its comma, and only a space, a tab or a line break: no other blank, nothing else
  for (const text of [
    'Said it.\nTool: hammer,\nnails', 'Said it.\nTool: hammer,\tnails', 'Said it.\nTool: calculator,\n4',
    'Said it.\nTool: kade_research,x', 'Said it.\nTool: kade_research,,\n=== x', 'Said it.\nTool: kade_research ,\n=== x',
    'Said it.\nTool: kade_research\n,\n=== x', 'Said it.\nTool: kade_research,\u00a0=== x', 'Said it.\nTool: kade_research,\u000b=== x',
    'Said it.\nTool: kade_research,\f=== x', 'Said it.\nTools: kade_research,\n=== x', 'Said it. Tool: kade_research,\n=== x',
  ]) {
    assert.equal(findToolEcho(text), null, JSON.stringify(text));
    assert.equal(cut(text), text, JSON.stringify(text));
    assert.equal(oracle(text), null, 'the oracle agrees: ' + JSON.stringify(text));
    for (const size of [1, 2, 1000]) assert.equal(throughGate(inPieces(text, size)).out, text, `in pieces of ${size}: ` + JSON.stringify(text));
  }
  // one log line, with the whole echo counted, from the whole text and from the gate cut right behind the comma
  const text = 'Said it.\nTool: kade_research,\n=== Deep Research Context ===';
  const line = (lane) => `[tool-echo] cut: lane=${lane} tool=kade_research chars=${text.length - 9} of ${text.length}`;
  assert.deepEqual(logged(text, { lane: 'fork-tts' }).lines, [line('fork-tts')]);
  const lines = [];
  const gate = createToolEchoGate({ env: ENV, lane: 'librechat-ask-stream', log: (l) => lines.push(l) });
  assert.equal(gate.push('Said it.\nTool: kade_research,'), 'Said it.\n', 'the line is held until the character after the comma');
  assert.equal(gate.push('\n=== Deep Research Context ==='), '', 'a line break: the echo');
  assert.equal(gate.end(), '');
  assert.deepEqual(lines, [line('librechat-ask-stream')]);
});

test('a piece of a reply with the direction in force stamped in front of it (the apps, the bridge) still begins with its echo', () => {
  for (const [text, want] of [
    ['%%%warm%%% Tool: kade_research, === Deep Research Context ===', ''],
    ['%%%warm and curious%%% ' + ECHO, ''],
    ['%%%warm%%%Tool: kade_research, x', ''],
    ['%%%warm%%%\tTool: kade_research, x', ''],
    ['%%%warm%%%   Tool: kade_research, x', ''],
    ['%%%warm%%% %%%slow%%% Tool: kade_research, x', ''],
    ['%%%warm%%%%%%slow%%% Tool: kade_research, x', ''],
    ['%%%%%% Tool: kade_research, x', ''],                               // Android stamps an empty direction as six percent signs
    ['%%%to correct, with respect!%%% Tool: kade_research, x', ''],
    ['%%%' + 'a'.repeat(230) + '%%% Tool: kade_research, x', ''],        // 237 characters of direction and blank: inside
    ['%%%a%%%' + ' '.repeat(233) + 'Tool: kade_research, x', ''],        // "Tool:" 240 characters from the line start: the last place it counts
    ['%%%' + 'a'.repeat(234) + '%%%Tool: kade_research, x', ''],         // the same with a direction that long
    ['One.\n%%%warm%%% Tool: web_search, x', 'One.'],
    ['%%%warm%%% One.\n%%%slow%%% Tool: web_search, x', '%%%warm%%% One.'],
    ['%%%warm%%%\nTool: web_search, x', '%%%warm%%%'],                   // the direction on the line before stays: it says nothing by itself
  ]) {
    assert.equal(cut(text), want, JSON.stringify(text));
    assert.deepEqual(oracle(text), findToolEcho(text), 'the oracle agrees: ' + JSON.stringify(text));
    for (const size of [1, 3, 7, 1000]) assert.equal(throughGate(inPieces(text, size)).out, kept(text), `in pieces of ${size}: ` + JSON.stringify(text));
  }
});

test('what this rule cannot see: a later piece of the same echo, sent as its own request, carries nothing to know it by', () => {
  // The iPhone speaks a reply while it is written and cuts it at sentence ends. The Nov 13 reply came out as three pieces:
  const pieces = [SAID, ECHO.slice(0, ECHO.indexOf(' Could she')), 'Could she monetize it, or does it have to be free?'];
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), NOV13.replace(/\s+/g, ' '));
  assert.equal(cut(pieces[0]), pieces[0]);
  assert.equal(cut(pieces[1]), '', 'the piece that holds the line is cut whole');
  assert.equal(cut('%%%warm%%% ' + pieces[1]), '', 'with the direction in force stamped on it too');
  assert.equal(cut(pieces[2]), pieces[2], 'the last piece is an ordinary sentence to this service: only the app or the website knows it belongs to the echo');
});

test('untouched text comes back as the same string; what is kept loses only the line break and blanks in front of the echo', () => {
  for (const text of ['One.  ', '  One.\n\n', 'One.\nTwo. ', NOV13.slice(0, SAID.length + 5)]) assert.equal(cut(text), text);
  assert.equal(cut('  One.  \n\n \nTool: a_b, x'), '  One.');
  assert.equal(cut(undefined), undefined);
  assert.equal(cut(null), null);
  assert.equal(cut(''), '');
  assert.equal(cut(42), 42);
  const list = ['Tool: a_b, x'];
  assert.equal(cut(list), list, 'only a string is ever cut');
  for (const notText of [undefined, null, 42, {}, list]) assert.equal(findToolEcho(notText), null);
  const gate = createToolEchoGate({ env: ENV, log: quiet });
  for (const notText of [undefined, null, 42, '', {}, list]) assert.equal(gate.push(notText), '');
  assert.equal(gate.end(), '');
});

test('the gate: the reply of a call, token by token, stops at the echo and holds back nothing else', () => {
  const tokens = ['Sure', '.', ' It', ' is', ' sunny', ' today', '.', '\n', 'Tool', ':', ' kade', '_research', ',', ' ===', ' Deep', ' Research', ' Context', ' ===', '\n\n', '# Your', ' Question', ', Stated'];
  const lines = [];
  const gate = createToolEchoGate({ env: ENV, lane: 'librechat-ask-stream', log: (line) => lines.push(line) });
  const passed = tokens.map((token) => gate.push(token));
  assert.deepEqual(passed.slice(0, 8), tokens.slice(0, 8), 'every token before the line goes out as it arrives');
  assert.deepEqual(passed.slice(8), tokens.slice(8).map(() => ''), 'nothing of the echo goes out, not even its first word');
  assert.deepEqual(lines, [], 'the log line waits for the end of the reply');
  assert.equal(gate.end(), '');
  const echoChars = tokens.slice(8).join('').length;
  assert.deepEqual(lines, [`[tool-echo] cut: lane=librechat-ask-stream tool=kade_research chars=${echoChars} of ${tokens.join('').length}`]);
  assert.equal(gate.end(), '', 'a second end() says nothing more');
  assert.equal(lines.length, 1);
  assert.equal(gate.push('more'), '', 'and nothing is passed on after it');
});

test('the gate: a line that only begins like the echo is held for a moment and then passed on whole, in order', () => {
  const lines = [];
  const gate = createToolEchoGate({ env: ENV, log: (line) => lines.push(line) });
  const out = [];
  for (const token of ['Bring this:\n', 'To', 'ol', ': ', 'ham', 'mer', ', nails.', '\nT', 'omorrow then.', '\nTool: web_search']) out.push(gate.push(token));
  assert.deepEqual(out, ['Bring this:\n', '', '', '', '', '', 'Tool: hammer, nails.', '\n', 'Tomorrow then.', '\n']);
  assert.equal(gate.end(), 'Tool: web_search', 'what was still held when the reply ended goes out: a name with no comma is no echo');
  assert.deepEqual(lines, []);
  // a tool name and its comma, and then the reply ends: that is the echo with its space trimmed away
  const last = createToolEchoGate({ env: ENV, log: (line) => lines.push(line) });
  assert.equal(last.push('Done.\nTool: kade_research,'), 'Done.\n');
  assert.equal(last.end(), '');
  assert.deepEqual(lines, ['[tool-echo] cut: lane=unnamed tool=kade_research chars=20 of 26']);
  // a direction at the start of a line is held until it closes and the next character rules the echo out
  const tagged = createToolEchoGate({ env: ENV, log: quiet });
  assert.deepEqual(['%%%wa', 'rm%', '%% ', 'S', 'o what now?'].map((t) => tagged.push(t)), ['', '', '', '%%%warm%%% S', 'o what now?']);
  assert.equal(tagged.end(), '');
});

test('the gate passes on exactly what the whole-text rule keeps, on EVERY way of cutting a short text into pieces', () => {
  const texts = [
    'x\nTool: a_b, y', 'Tool: a_b,', 'Tool: a_b, ', 'Tool: a_b', 'Tool: ab, y', 'x\nTool: flux,', 'x\r\nTool: _,', '%%%%%%Tool: _,',
    '%%%w%%% Tool: _', '%%%w%%%Tool: _,', 'T\nTo\nTool:\n', 'Tool: a_b,\nx', '\nTool: _, \n', 'a Tool: _, y',
  ];
  let runs = 0;
  for (const text of texts) {
    assert.ok(text.length <= 15, text);
    const want = kept(text);
    for (let mask = 0; mask < 1 << (text.length - 1); mask++) {   // bit k set: a cut behind character k
      const pieces = [];
      let from = 0;
      for (let k = 0; k < text.length - 1; k++) if (mask & (1 << k)) { pieces.push(text.slice(from, k + 1)); from = k + 1; }
      pieces.push(text.slice(from));
      const got = throughGate(pieces).out;
      if (got !== want) assert.equal(got, want, JSON.stringify([text, pieces]));   // compared first: the message is built only for a mismatch
      runs += 1;
    }
  }
  assert.equal(runs, 63232);
});

test('the rule matches the oracle, and the gate matches the rule, on every string up to five tokens of a small alphabet', () => {
  const tokens = ['Tool: ', 'Tool:', 'T', 'a_b', 'flux', 'ham', ',', ' ', '\n', '%%%', '%'];
  let checked = 0;
  const walk = (prefix, pieces, depth) => {
    if (prefix) {
      const got = findToolEcho(prefix), want = oracle(prefix);   // compared first: the messages are built only for a mismatch
      if ((got && got.at) !== (want && want.at) || (got && got.name) !== (want && want.name)) assert.deepEqual(got, want, JSON.stringify(prefix));
      const said = got ? prefix.slice(0, got.at) : prefix;
      const byToken = throughGate(pieces).out;
      if (byToken !== said) assert.equal(byToken, said, 'token by token: ' + JSON.stringify(pieces));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, pieces.concat(c), depth - 1);
  };
  walk('', [], 5);
  assert.equal(checked, 177155);
});

test('and on every string up to five whole parts of the echo, where more than a thousand hold one: the gate one character at a time', () => {
  const tokens = ['Tool: a_b', 'Tool: ab', ',', ', ', '\n', '%%%', '%%%w%%% ', 'x'];
  let checked = 0;
  let found = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      const got = findToolEcho(prefix), want = oracle(prefix);
      if ((got && got.at) !== (want && want.at) || (got && got.name) !== (want && want.name)) assert.deepEqual(got, want, JSON.stringify(prefix));
      if (got) found += 1;
      const said = got ? prefix.slice(0, got.at) : prefix;
      const byChar = throughGate(prefix.split('')).out;
      if (byChar !== said) assert.equal(byChar, said, 'character by character: ' + JSON.stringify(prefix));
      checked += 1;
    }
    if (depth === 0) return;
    for (const c of tokens) walk(prefix + c, depth - 1);
  };
  walk('', 5);
  assert.equal(checked, 37448);
  assert.equal(found, 1250, 'how many of them hold an echo (1,138 while only a space or the end of the text could follow the comma)');
});

test('the rule matches the oracle, and the gate the rule, on 60,000 random texts cut at random', () => {
  const r = rng(20261113);
  const parts = [
    'Tool: ', 'Tool: ', 'Tool:', 'Tool', 'Tools: ', 'tool: ', 'T', 'To', 'kade_research', 'web_search', 'flux', 'subagent', 'calculator', 'hammer', 'a_b', '_',
    'Tool: kade_research, ', '\nTool: web_search, ', '\nTool: flux,', 'Tool: calculator, ', '\nTool: hammer, ', '%%%warm%%% Tool: a_b, ',
    ',', ', ', ', ', ' ', '  ', '\t', '\n', '\n', '\n\n', '\r\n', '\r', LS, PS, '%%%', '%%%', '%%%warm%%%', '%%%warm%%% ', '%%', '%', 'warm', 'Hello there. ', 'x', '.', ':', '=== Results ===',
  ];
  let found = 0;
  for (let trial = 0; trial < 60000; trial++) {
    let s = '';
    for (let k = 1 + Math.floor(r() * 14); k > 0; k--) s += parts[Math.floor(r() * parts.length)];
    const known = trial % 3 === 0 ? ['calculator'] : [];
    const got = findToolEcho(s, known), want = oracle(s, known);
    if ((got && got.at) !== (want && want.at) || (got && got.name) !== (want && want.name)) assert.deepEqual(got, want, JSON.stringify(s));
    if (got) found += 1;
    const pieces = [];
    for (let i = 0; i < s.length;) { const size = 1 + Math.floor(r() * 9); pieces.push(s.slice(i, i + size)); i += size; }
    const passed = throughGate(pieces, { known }).out;
    const said = got ? s.slice(0, got.at) : s;
    if (passed !== said) assert.equal(passed, said, JSON.stringify([s, pieces]));
    const whole = cutToolEcho(s, { env: ENV, log: quiet, known });
    if (whole !== (got ? said.trimEnd() : s)) assert.equal(whole, got ? said.trimEnd() : s, JSON.stringify(s));
  }
  assert.ok(found > 12000 && found < 48000, `${found} of the random texts held an echo`);
});

test('the log line: the lane, the tool name and the characters, once, and never the words', () => {
  const { lines } = logged(NOV13, { lane: 'fork-tts' });
  assert.equal(lines.length, 1);
  for (const word of ['dark', 'Deep', 'Research Context', 'Kade asked', 'monetize', 'film', 'content']) assert.ok(!lines[0].includes(word), `${word} is in the log line`);
  // a lane is somebody's header: it stays on one line, loses anything that is not a plain name character, and is cut at 48
  assert.match(logged(NOV13, { lane: 'bridge-phone' }).lines[0], /lane=bridge-phone /);
  assert.match(logged(NOV13, {}).lines[0], /lane=unnamed /);
  assert.match(logged(NOV13, { lane: '' }).lines[0], /lane=unnamed /);
  const forged = logged(NOV13, { lane: 'evil\n[TTS] voice request: label="x"\r\n' }).lines[0];
  assert.equal(forged.split(/[\r\n]/).length, 1, 'one line');
  assert.match(forged, /lane=evil--TTS--voice-request:-label--x--- /);
  assert.match(logged(NOV13, { lane: 'a'.repeat(200) }).lines[0], new RegExp('lane=a{48} '));
  // the platform's own names are printed as they stand; any other is a length and a short hash, unless KADE_LOG_TEXT=1
  for (const name of [...PLATFORM_TOOLS, 'kade_research', 'kade_read_page', 'kade_anything_at_all']) {
    assert.match(logged(`One.\nTool: ${name}, x`).lines[0], new RegExp(`tool=${name} chars=`), name);
  }
  for (const name of ['John_Smith', 'get_weather', 'Kade_Research', 'kade_', 'kade_UPPER', 'kade_' + 'a'.repeat(59)]) {
    const line = logged(`One.\nTool: ${name}, x`).lines[0];
    assert.match(line, /tool=unlisted \(\d+ chars, sha [0-9a-f]{8}\) chars=/, name);
    assert.ok(!line.includes(name), `${name} is in the log line`);
    assert.match(logged(`One.\nTool: ${name}, x`, { env: { KADE_LOG_TEXT: '1' } }).lines[0], new RegExp(`tool=unlisted "${name}" chars=`), name);
  }
  assert.match(logged('One.\nTool: John_Smith, x').lines[0], / chars=19 of 24$/);
  // a logger that throws never costs the reply its voice
  assert.equal(cutToolEcho(NOV13, { env: ENV, log: () => { throw new Error('the log is down'); } }), SAID);
  const gate = createToolEchoGate({ env: ENV, log: () => { throw new Error('the log is down'); } });
  assert.equal(gate.push(NOV13) + gate.end(), SAID + '\n');
});

test('KADE_TOOL_ECHO_SPEECH=0 turns it off: the text goes through as it came, and nothing is logged', () => {
  const off = { KADE_TOOL_ECHO_SPEECH: '0' };
  assert.equal(toolEchoOn(off), false);
  for (const env of [{}, { KADE_TOOL_ECHO_SPEECH: '1' }, { KADE_TOOL_ECHO_SPEECH: '' }, { KADE_TOOL_ECHO_SPEECH: 'off' }, { KADE_TOOL_ECHO_SPEECH: undefined }]) {
    assert.equal(toolEchoOn(env), true, JSON.stringify(env));   // only a plain 0 turns it off
    assert.equal(cutToolEcho(NOV13, { env, log: quiet }), SAID, JSON.stringify(env));
  }
  const { out, lines } = logged(NOV13, { env: off });
  assert.equal(out, NOV13);
  assert.deepEqual(lines, []);
  const tokens = inPieces(NOV13, 5);
  const gateLines = [];
  const gate = createToolEchoGate({ env: off, log: (line) => gateLines.push(line) });
  assert.deepEqual(tokens.map((t) => gate.push(t)), tokens, 'every piece goes out as it arrives, none held');
  assert.equal(gate.end(), '');
  assert.deepEqual(gateLines, []);
  // with no env handed in it is the real one, read on every call
  const had = Object.prototype.hasOwnProperty.call(process.env, 'KADE_TOOL_ECHO_SPEECH') ? process.env.KADE_TOOL_ECHO_SPEECH : undefined;
  try {
    process.env.KADE_TOOL_ECHO_SPEECH = '0';
    assert.equal(toolEchoOn(), false);
    assert.equal(cutToolEcho(NOV13, { log: quiet }), NOV13);
    delete process.env.KADE_TOOL_ECHO_SPEECH;
    assert.equal(toolEchoOn(), true);
    assert.equal(cutToolEcho(NOV13, { log: quiet }), SAID);
  } finally {
    if (had === undefined) delete process.env.KADE_TOOL_ECHO_SPEECH; else process.env.KADE_TOOL_ECHO_SPEECH = had;
  }
});

// Every shape that could tempt a rule to back up: runs of the echo's own parts, never quite an echo.
const SHAPES = [
  ['prose with no Tool in it', rep('Hello there, friend. ')],
  ['Tool: in the middle of every sentence', rep('Use the Tool: hammer, please. ')],
  ['lines of Tool: hammer, nails', rep('Tool: hammer, nails\n')],
  ['lines of a tool name with no comma', rep('Tool: web_search\n')],
  ['one line of nothing but Tool: ', rep('Tool: ')],
  ['nothing but line breaks', rep('\n')],
  ['nothing but CR LF', rep('\r\n')],
  ['lines of T', rep('T\n')],
  ['lines of Tool:', rep('Tool:\n')],
  ['one endless name', 'Tool: ' + rep('a_')],
  ['lines of names of 200 characters', rep('Tool: ' + 'a'.repeat(200) + '\n')],
  ['lines of names of 127 characters and no comma', rep('Tool: ' + 'a_'.repeat(63) + 'a\n')],
  ['one line of nothing but directions', rep('%%%a%%% ')],
  ['lines of directions', rep('%%%a%%% %%%b%%% x\n')],
  ['lines that are a long direction and a plain Tool:', rep('%%%' + 'a'.repeat(224) + '%%%Tool: hammer, x\n')],
  ['lines of a direction that never closes', rep('%%%a\n')],
  ['one line of nothing but percent signs', rep('%')],
  ['lines of percent signs', rep('%%%%%\n')],
  ['a direction and then nothing but blanks', '%%%a%%%' + rep(' ')],
  ['a real echo at the very end', rep('Hello there, friend. ', BIG - 40) + '\nTool: kade_research, === x ==='],
  ['a real echo at the very start', 'Tool: kade_research, ' + rep('result text. ')],
  ['a real echo behind a hundred thousand blanks', 'x' + rep(' ', BIG / 2) + '\nTool: a_b, ' + rep('y ', BIG / 2)],
  ['a real echo behind a hundred thousand blank lines', 'x' + rep(' \n', BIG / 2) + 'Tool: a_b, ' + rep('y ', BIG / 2)],
  ['lines of a tool name and its comma with a form feed after it', rep('Tool: kade_research,\fx\n')],
  ['a real echo with its line broken after the comma, at the very end', rep('Hello there, friend. ', BIG - 40) + '\nTool: kade_research,\n=== x'],
];

test('200,000 characters of every tempting shape go through the rule in a blink', () => {
  for (const [name, text] of SHAPES) {
    assert.ok(Math.abs(text.length - BIG) <= 64, `${name} is ${text.length} characters`);
    const out = clock(`cutToolEcho on ${name}`, () => cutToolEcho(text, { env: ENV, log: quiet }));
    assert.equal(out, findToolEcho(text) ? kept(text).trimEnd() : text, name);
  }
  assert.equal(cut(SHAPES[19][1]), rep('Hello there, friend. ', BIG - 40).trimEnd());
  assert.equal(cut(SHAPES[20][1]), '');
  assert.equal(cut(SHAPES[21][1]), 'x');
  assert.equal(cut(SHAPES[22][1]), 'x');
  assert.equal(cut(SHAPES[23][1]), SHAPES[23][1], 'a form feed after the comma is no blank');
  assert.equal(cut(SHAPES[24][1]), rep('Hello there, friend. ', BIG - 40).trimEnd(), 'the line broken right after the comma');
});

test('and through the gate: 200,000 characters at once and in pieces of seven, 10,000 one character at a time', () => {
  for (const [name, text] of SHAPES) {
    const want = kept(text);
    assert.equal(clock(`the gate, at once, on ${name}`, () => throughGate([text]).out), want, name);
    assert.equal(clock(`the gate, in pieces of seven, on ${name}`, () => throughGate(inPieces(text, 7)).out), want, name);
    const short = text.slice(0, 10000);
    assert.equal(clock(`the gate, one character at a time, on ${name}`, () => throughGate(inPieces(short, 1)).out), kept(short), name);
  }
});

test('a reply of 200,000 characters with its echo in the middle keeps every word before the line and none after', () => {
  const before = rep('This is the answer, and it is a long one. ', 120000).trimEnd();
  const text = before + '\nTool: web_search, === Web Results, Turn 0 ===\n' + rep('Snippet: words and more words.\n', 80000);
  assert.equal(clock('the long reply', () => cut(text)), before);
  const { out, lines } = throughGate(inPieces(text, 11), { lane: 'librechat-ask-stream' });
  assert.equal(out, before + '\n');
  assert.deepEqual(lines, [`[tool-echo] cut: lane=librechat-ask-stream tool=web_search chars=${text.length - before.length - 1} of ${text.length}`]);
});
