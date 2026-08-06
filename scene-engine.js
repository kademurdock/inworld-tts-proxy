// scene-engine.js — Multi-speaker voice scenes, pure text helpers (Aug 6 2026).
//
// Ideas 16 + 52 from PLATFORM_IMPROVEMENT_IDEAS_2026-08-06: two or three
// characters performing ONE voice message, each line synthesized in its cast
// voice and stitched by server.js with the existing gap engine + loudness
// normalizer. This module owns the SCRIPT FORMAT only — parsing and label
// canonicalization, no audio, no network — so it stays unit-testable without
// booting the server.
//
// THE SCRIPT FORMAT (what models write, taught in the fork's platform note):
//   [[Voice 214]] Well hey there, sugar.
//   [[Deuce]] Don't "hey there" me — you still owe the pot forty chips.
//   [[Voice 214]] %%%laugh%%% Put it on my tab.
// A double-bracket tag names WHO speaks until the next tag. Tags accept a
// numbered voice ("Voice 214", "voice214", bare "214") or a character name
// (resolved by server.js via the scene cast map). Text before the first tag
// belongs to the message's base voice. Steering (%%%) and fish [bracket]
// cues ride INSIDE a segment untouched — single brackets are never scene
// tags, only double. Nothing else on the platform uses [[…]] (grep-verified
// zero occurrences before this shipped), so plain prose can never trip it.
//
// FAIL-SOFT CONTRACT: a script that parses to fewer than two distinct
// resolvable voices is NOT a scene — server.js strips the tags and speaks it
// on the base voice like any other message. An unresolvable name inside an
// otherwise-good scene falls back to the base voice for that segment only.

const SCENE_TAG_RE = /\[\[([^\[\]\n]{1,60})\]\]/;       // cheap detector
const SCENE_TAG_G = /\[\[([^\[\]\n]{1,60})\]\]/g;       // parser / stripper

// "voice 214" / "VOICE  214" / "voice214" / "#214" / "214" -> "Voice 214".
// Anything else (a character name) is returned trimmed for cast lookup, with
// a trailing colon dropped ("Deuce:" is a natural way to type a script).
function canonicalSceneLabel(inner) {
  if (!inner) return null;
  let s = String(inner).trim().replace(/[:\s]+$/, "");
  if (!s) return null;
  const m = s.match(/^voice\s*#?\s*(\d{1,4})$/i) || s.match(/^#?\s*(\d{1,4})$/);
  if (m) return `Voice ${parseInt(m[1], 10)}`;
  return s;
}

// Parse a prepped (markdown/citation/pronunciation-cleaned) text into ordered
// segments: [{ label: "Voice 214"|"Deuce"|null, text: "..." }]. label null =
// the base voice. Empty segments (two tags back to back, or a tag with only
// whitespace after it) are dropped. Consecutive segments that end up on the
// same label are merged so the synth pays one utterance, keeping paragraph
// steering carry-forward intact within a speaker's run.
function parseSceneScript(text) {
  const segments = [];
  let lastIndex = 0;
  let currentLabel = null;
  let m;
  SCENE_TAG_G.lastIndex = 0;
  while ((m = SCENE_TAG_G.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before.trim()) segments.push({ label: currentLabel, text: before.trim() });
    currentLabel = canonicalSceneLabel(m[1]);
    lastIndex = m.index + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim()) segments.push({ label: currentLabel, text: tail.trim() });

  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === seg.label) prev.text += `\n\n${seg.text}`;
    else merged.push({ ...seg });
  }
  return merged;
}

// Parse the SCENE_CAST env (and any other "name=Voice N;name2=..." string —
// same grammar the TTS_LEXICON uses, chosen because it survives Railway's
// env editor without JSON-quoting pain). Keys lowercase. Values kept verbatim
// (a "Voice N" label or a raw provider voice id both work downstream).
function parseAssignments(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of String(raw).split(/[;\n]+/)) {
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const val = pair.slice(eq + 1).trim();
    if (key && val) map.set(key, val);
  }
  return map;
}

module.exports = { SCENE_TAG_RE, SCENE_TAG_G, canonicalSceneLabel, parseSceneScript, parseAssignments };
