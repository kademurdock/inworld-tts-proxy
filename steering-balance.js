'use strict';
/* Nov 6 2026 — A STRAY %%% MUST NOT TURN THE NEXT TAG INTO SPEECH.
 *
 * Kade, about the last message Kiana sent her: the voice said "warm and curious" out loud. The message had
 *     ... Two different problems.\n\n%%%\n%%%warm and curious%%% So what's the shape of it?
 * an empty `%%%` line and then the real tag. applySteeringTags pairs `%%%` runs left to right, so the stray
 * one paired with the real tag's OPENER (what sat between them was a newline, which converts to nothing)
 * and the real tag's CLOSER was left over: its words stayed in the text, the sweep removed the delimiters,
 * and the carry-forward stamped the previous direction in front, which the live log showed as
 *     [to correct with respect] warm and curious So what's the shape of it?
 * Every later tag in that message would have flipped the same way. It is the old "slightly amused" disease
 * (Aug 20) in a shape the July and August guards did not cover: they all assume the runs come in pairs.
 *
 * So decide the pairing once, here, before anything pairs by position. Walking left to right, a run of
 * percent signs opens a tag only if the text up to the next run is a believable direction (one line, some
 * letters, not a paragraph); then that next run closes it. A run that opens nothing is a stray and is
 * dropped. A run six or longer is a closer glued to an opener. A tag the model forgot to close, alone on a
 * short line (`%%%warm and curious` then a line break), is still a direction and is closed for it. What is
 * left is exactly the well-formed `%%%direction%%%` shape the rest of applySteeringTags already converts,
 * so a stray can never again shift which words are tags. Prose is never touched except for the stray runs
 * and the words of tags; a bare single % (a real percentage) is not a run and is left alone. */

const TAG_MAX = 200;      // a direction, trimmed; the old normalizer capped at 160 and layered ones grew past it
const LINE_MAX = 80;      // an unclosed tag line is a few words, never a sentence

/** The direction between two runs, trimmed, or null when it cannot be one. */
function tagBody(between) {
  if (between.length === 0 || between.length > TAG_MAX + 60 || between.indexOf('\n') !== -1) return null;
  const t = between.trim();
  if (!t || t.length > TAG_MAX || !/[A-Za-zÀ-ɏ]/.test(t)) return null;
  // Speech is not a direction: a sentence boundary inside it, a question or an exclamation, or a
  // paragraph's worth of words. Two stray runs around a sentence must not swallow the sentence.
  if (/[.!?]["'”’)]*\s+\S/.test(t) || /[?!]["'”’)]*$/.test(t) || t.split(/\s+/).length > 24) return null;
  // A real tag hugs its words. Spaces on a side AND the look of a sentence (a capital, a full stop) means
  // the run in front is a stray and this is speech: `%% That is on me. %%%tag%%%`.
  if (/^\s|\s$/.test(between) && /^[A-ZÀ-Þ]/.test(t) && /\.["'”’)]*$/.test(t)) return null;
  return t;
}

/** A tag the model opened but never closed, alone on a short line: a few words, no sentence end. */
function unclosedLine(between) {
  const line = between.split('\n', 1)[0].trim();
  if (!line || line.length > LINE_MAX || !/[A-Za-zÀ-ɏ]/.test(line)) return null;
  if (/[.!?]["'”’)]*(?:\s|$)/.test(line)) return null;
  return line;
}

function balanceSteeringRuns(text) {
  const src = String(text == null ? '' : text);
  if (src.indexOf('%%') === -1) return src;
  const runs = [];
  for (const m of src.matchAll(/%{2,}/g)) {
    let at = m.index;
    let len = m[0].length;
    while (len >= 6) { runs.push({ start: at, end: at + 3 }); at += 3; len -= 3; } // closer + opener, glued
    runs.push({ start: at, end: at + len });
  }
  let out = '';
  let cursor = 0;
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];
    out += src.slice(cursor, run.start);
    const next = runs[i + 1];
    const between = src.slice(run.end, next ? next.start : src.length);
    const body = next ? tagBody(between) : null;
    if (body) {
      if (out.endsWith('%')) out += ' '; // two tags touching would be a six-percent run again, which nothing downstream can pair
      out += `%%%${body}%%%`;
      cursor = next.end;
      i += 2;
      continue;
    }
    const atLineStart = run.start === 0 || src[run.start - 1] === '\n';
    const line = atLineStart ? unclosedLine(between) : null;
    if (line) {
      if (out.endsWith('%')) out += ' ';
      out += `%%%${line}%%%`;
      cursor = run.end + between.indexOf(line) + line.length; // the rest of the line break stays
      // anything on the same line after the words is prose
      i += 1;
      continue;
    }
    cursor = run.end; // a stray: dropped, never spoken
    i += 1;
  }
  return out + src.slice(cursor);
}

module.exports = { balanceSteeringRuns, tagBody, unclosedLine };
