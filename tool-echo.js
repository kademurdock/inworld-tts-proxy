'use strict';
/* tool-echo.js — Nov 13 2026: A TOOL CALL THE MODEL ONLY WROTE IS NEVER READ ALOUD.
 *
 * Kade heard a tool call at the end of a reply from Kiana. The saved reply ended
 *     ...people left sitting in the dark.
 *     Tool: kade_research, === Deep Research Context ===
 *     (and on, with her own question restated under it)
 * and no tool ran on that turn: the model WROTE that line. On the website a tool that was used earlier in a
 * conversation is often not attached on a later turn, and the agents library (formatAgentMessages in
 * @librechat/agents) then rewrites the old tool call as text at the end of the character's EARLIER reply:
 * "Tool: <name>, <output>" on a new line. The model reads its own replies ending that way and, now and then,
 * ends a new one the same way: twice in 1,658 replies (Oct 15 web_search, Nov 13 kade_research). The cause is
 * dealt with on the website and in the gateway. This is the voice's own net: for the replies already saved with
 * the line in them (replaying one read it aloud) and for any that still get through.
 *
 * THE RULE (the same one in all three places). At the start of a line, or of the text:
 *     Tool: <name>,
 * and then a space, a tab, a line break, or nothing at all (the end of the text), where <name> is tool-like: a name
 * the caller says it knows (`known`), one of the platform's own (PLATFORM_TOOLS, and every name that starts with
 * kade_), or any run of letters, digits and underscores with at least one underscore in it. Everything from that
 * line start to the END of the text is the echo and is cut. "Tool: hammer, nails" and "Tools: a list" are ordinary
 * sentences and are never touched. What may follow the comma, and why: the library writes a space; a copy may break
 * its line right after the comma, or put a tab there (the website's rule takes both; until the review of Nov 13 this
 * file took only the space, so such a line was cut on the website and spoken here); and a text is trimmed at its
 * ends on its way to a voice (the website's scrub, the apps, stripThinkingBlock here), so an echo with nothing after
 * its comma arrives as "Tool: kade_research," with the space gone. A line break is any of the four isLineBreak knows.
 *
 * ONE THING THE VOICE ADDS, because of what happens to a reply on its way to a voice: the apps and the phone bridge
 * speak a reply in pieces and stamp the direction in force in front of a piece ("%%%warm%%% " + piece), so a piece
 * that begins with the echo does not begin with "Tool:". Voice directions (%%%...%%%, each on one line) and the
 * blanks after each may stand between the line start and "Tool:"; the cut still begins at the line start.
 *
 * WHAT IT CANNOT SEE. The rule needs the line that starts the echo. A reply that reaches this service whole
 * (the website's read-aloud and auto-play, a saved message replayed on a phone) is covered to its end, and so
 * is everything this service cuts into chunks itself, because it cuts after this rule. Text that streams
 * through here (/librechat/ask-stream, the calls) goes through the gate below, which remembers that the echo
 * began. But whoever cuts a reply into pieces BEFORE it gets here sends each piece as its own request: the
 * phone apps and the website's voice mode, which speak a reply while it is written, and the website's manual
 * lane for a text of 32,768 characters or more. The piece that holds the line is cut from the line on, and a
 * LATER piece of the same echo carries nothing to know it by. This service has no way to tell where one reply
 * ends and the next begins on those lanes (the iPhone fetches two pieces ahead of the one playing, so pieces of
 * one reply arrive up to a clip's length apart, further apart than a quick next reply), and guessing by the
 * clock could swallow the first sentence of a real reply. Those pieces are for whoever holds the whole text:
 * the website, or the apps.
 *
 * LINEAR. A line start is looked at once and never further than LEAD_MAX + NAME_MAX + 8 characters, and never
 * past the end of its line; the walk from one line start to the next reads each character once. No pattern
 * that can back up. tool-echo.test.js pins 200,000 characters of every shape that could tempt it.
 *
 * KADE_TOOL_ECHO_SPEECH=0 turns all of it off (read on every call). One log line when it cuts: the lane, the
 * tool name and how many characters went; never the words (log-text.js). A name is printed as it stands only
 * when it is one of the platform's own; any other is a receipt (length and a short hash), because a run of
 * letters with an underscore that somebody typed is still somebody's words. */
const { textReceipt } = require('./log-text');

// The platform's tool names that hold no underscore need naming; every kade_ name has one and falls under the
// underscore rule below (as do web_search and the rest, listed all the same so the log prints them as they stand).
const PLATFORM_TOOLS = new Set(['web_search', 'file_search', 'execute_code', 'tool_search', 'subagent', 'flux']);
const HEAD = 'Tool: ';
const TAG = '%%%';
const LEAD_MAX = 240;   // directions and blanks in front of "Tool:": a direction is a few words (the longest of 7,148 real ones is 52 characters)
const NAME_MAX = 128;   // no tool name is this long (the model APIs stop at 64)
const NO = 0;           // headAt: no echo starts here
const MORE = 1;         // headAt: the text ended before that could be told, and more of it is still to come

const toolEchoOn = (env = process.env) => String(env.KADE_TOOL_ECHO_SPEECH ?? '1') !== '0';

// What "the start of a line" means to a /^.../m pattern: after LF, CR, or the Unicode line or paragraph separator.
const isLineBreak = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isNameChar = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
const isBlank = (c) => c === 32 || c === 9;

function nameSet(known) {
  if (!known) return null;
  if (known instanceof Set) return known.size ? known : null;
  const set = new Set();
  for (const name of Array.isArray(known) ? known : [known]) if (typeof name === 'string' && name) set.add(name);
  return set.size ? set : null;
}

/* Is this the name of a tool? `name` is a run of letters, digits and underscores (headAt reads nothing else as a
 * name, so a known name with a hyphen or a dot in it is never found: none is known to this service today). */
function isToolName(name, known) {
  if (typeof name !== 'string' || !name) return false;
  if (PLATFORM_TOOLS.has(name) || name.indexOf('_') !== -1) return true;
  const names = nameSet(known);
  return Boolean(names && names.has(name));
}

/* Does an echo begin at line start `i` of `t`? The tool's name when it does, NO when it does not, MORE when `t`
 * ends before that can be told and `final` is false (more of the text is still to come: the gate below).
 * Every NO and every name is the answer whatever follows `t`, so a text read in pieces gets the answers the
 * whole text gets. Reads at most LEAD_MAX + NAME_MAX + 8 characters and never past the end of the line. */
function headAt(t, i, final, names) {
  const n = t.length;
  const leadEnd = i + LEAD_MAX;
  let p = i;
  while (p < n && t.charCodeAt(p) === 37) {                 // a voice direction stamped in front: %%%...%%% on this line
    if (!t.startsWith(TAG, p)) {
      // "%" or "%%" and then the end of what has arrived: the rest of the %%% may still come
      return !final && n - p < TAG.length && (n - p === 1 || t.charCodeAt(p + 1) === 37) ? MORE : NO;
    }
    let q = p + TAG.length;
    for (;;) {
      if (q > leadEnd) return NO;                           // too long to be a direction
      if (q >= n) return final ? NO : MORE;                 // the text ended inside it
      const c = t.charCodeAt(q);
      if (isLineBreak(c)) return NO;                        // a direction stays on its line
      if (c === 37 && t.startsWith(TAG, q)) break;
      q++;
    }
    p = q + TAG.length;
    while (p < n && p <= leadEnd && isBlank(t.charCodeAt(p))) p++;
    if (p > leadEnd) return NO;
  }
  if (!t.startsWith(HEAD, p)) {
    // "T", "To", ... "Tool:" and then the end of what has arrived (or nothing yet): the rest may still come
    return !final && n - p < HEAD.length && HEAD.startsWith(t.slice(p)) ? MORE : NO;
  }
  const from = p + HEAD.length;
  let q = from;
  while (q < n && q - from <= NAME_MAX && isNameChar(t.charCodeAt(q))) q++;
  if (q - from > NAME_MAX) return NO;                       // too long to be a name
  if (q >= n) return final ? NO : MORE;                     // the text ended inside the name: no comma, no echo
  if (t.charCodeAt(q) !== 44) return NO;                    // no comma right after the name
  const name = t.slice(from, q);
  if (!isToolName(name, names)) return NO;                  // (no name at all is no tool name)
  if (q + 1 >= n) return final ? name : MORE;               // the comma ends the text: trimmed on its way here (THE RULE)
  const after = t.charCodeAt(q + 1);                        // a space, a tab or a line break: the comma may end its line
  return isBlank(after) || isLineBreak(after) ? name : NO;
}

/* Where the echo begins in a whole text and which tool it names: { at, name }, or null when there is none.
 * `at` is the line start, so text.slice(0, at) is everything that was really said. */
function findToolEcho(text, known) {
  if (typeof text !== 'string' || text.indexOf(HEAD) === -1) return null;   // no "Tool: " anywhere: nothing to walk
  const names = nameSet(known);
  const n = text.length;
  let i = 0;                                                // a line start
  for (;;) {
    const hit = headAt(text, i, true, names);
    if (typeof hit === 'string') return { at: i, name: hit };
    while (i < n && !isLineBreak(text.charCodeAt(i))) i++;  // on to the next line start
    if (i >= n) return null;
    i++;
  }
}

function laneForLog(lane) {
  return String(lane ?? '').slice(0, 48).replace(/[^A-Za-z0-9_.:-]/g, '-') || 'unnamed';
}
function nameForLog(name, env) {
  return PLATFORM_TOOLS.has(name) || /^kade_[a-z0-9_]{1,58}$/.test(name) ? name : `unlisted ${textReceipt(name, undefined, env)}`;
}
function report(opts, name, cut, total) {
  try {
    const log = typeof opts.log === 'function' ? opts.log : console.log;
    log(`[tool-echo] cut: lane=${laneForLog(opts.lane)} tool=${nameForLog(name, opts.env)} chars=${cut} of ${total}`);
  } catch (e) { /* a log line never costs the reply its voice */ }
}

/* A whole text without its echo: the same string when there is none (or the switch is off), otherwise what stood
 * before the echo's line, with the line break that ended it gone.
 * opts: lane (for the log line), known (tool names the caller knows), env, log. */
function cutToolEcho(text, opts = {}) {
  if (typeof text !== 'string' || !text || !toolEchoOn(opts.env)) return text;
  const found = findToolEcho(text, opts.known);
  if (!found) return text;
  report(opts, found.name, text.length - found.at, text.length);
  return text.slice(0, found.at).trimEnd();
}

/* The same rule for a text that arrives in pieces (the reply stream of a call). push(piece) returns what may be
 * passed on now; end() returns what was still held back when the text ended. Put together they are exactly
 * text.slice(0, at) of the whole text (tool-echo.test.js checks that on every way of cutting a text up).
 *
 * At most the start of ONE line is held back, and only while it could still become the echo: "T", "To", "Tool:",
 * "Tool: kade_res", "Tool: kade_research," until the character after its comma arrives, a direction not closed yet.
 * An ordinary line is passed on with the character that rules the echo out. Once the echo begins, nothing that
 * follows is passed on. The log line is written at end(). */
function createToolEchoGate(opts = {}) {
  const on = toolEchoOn(opts.env);
  const names = nameSet(opts.known);
  let held = '';          // the start of a line that may still turn out to be the echo
  let lineStart = true;   // with nothing held: does the next character to arrive stand at the start of a line?
  let cutName = null;     // the tool's name once the echo has begun
  let cutChars = 0;
  let total = 0;
  let reported = false;

  function push(piece) {
    if (typeof piece !== 'string' || !piece) return '';
    if (!on) return piece;
    total += piece.length;
    if (cutName !== null) { cutChars += piece.length; return ''; }
    const t = held + piece;
    const n = t.length;
    let i = held || lineStart ? 0 : -1;                     // the first line start in t
    held = '';
    lineStart = false;
    for (;;) {
      if (i === -1) {                                       // t does not begin a line: find the first line break
        i = 0;
        while (i < n && !isLineBreak(t.charCodeAt(i))) i++;
        if (i >= n) return t;                               // no line start left in t
        i++;
      }
      const hit = headAt(t, i, false, names);
      if (typeof hit === 'string') {
        cutName = hit;
        cutChars += n - i;
        return t.slice(0, i);
      }
      if (hit === MORE) {                                   // undecided: hold this line start back
        held = t.slice(i);
        lineStart = true;
        return t.slice(0, i);
      }
      while (i < n && !isLineBreak(t.charCodeAt(i))) i++;   // on to the next line start
      if (i >= n) return t;
      i++;
    }
  }

  function end() {
    let out = '';
    if (on && cutName === null && held) {
      const hit = headAt(held, 0, true, names);             // the text is over: a name and its comma at the very end count
      if (typeof hit === 'string') { cutName = hit; cutChars += held.length; } else out = held;
    }
    held = '';
    if (cutName !== null && !reported) {
      reported = true;
      report(opts, cutName, cutChars, total);
    }
    return out;
  }

  return { push, end };
}

module.exports = { toolEchoOn, isToolName, findToolEcho, cutToolEcho, createToolEchoGate, PLATFORM_TOOLS };
