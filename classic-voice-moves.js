'use strict';
// classic-voice-moves.js — "Wrong section?" moves for the parts of the public
// picker the older mover never sees (Oct 16 2026).
//
// While SELECTED_VOICES_ENABLED=1, /voices.json serves the selected picker,
// built once at boot. It shows every registered Inworld voice as
// "<legacy label> (Classic)" under "Classic · <legacy section>", and it copies
// the legacy hidden names, renames, providers, describe and tags at that
// moment. voice-moves.js edits only the live legacy maps, so:
//
//   - afterLegacyMove (finding 8): a legacy move (the boot replay of resolved
//     board rows, about 15 s after listen, or a new sweep) is re-applied into
//     the served picker: both spellings stay resolvable through `hidden`, the
//     old one renames to the new one, the new one gets its provider, and the
//     voice's Classic entry moves to the matching Classic section.
//   - applyClassicReport (finding 25): a report filed on a Classic entry is
//     mapped to its legacy row (strip " (Classic)" and "Classic · "), the same
//     section rule picks the target, and the Classic entry moves there. Its
//     label never changes, so VOICE_MAP and every saved pick keep resolving,
//     and the board row resolves, so the boot replay re-applies it.
//
// Reports apply in creation order; an older report never undoes a newer one.

const { targetFor } = require('./voice-moves');

const CLASSIC = ' (Classic)';
const CLASSIC_SECTION = 'Classic · ';
const MORE = CLASSIC_SECTION + 'More Inworld voices';

function createClassicVoiceMoves(picker, legacy) {
  const classicOf = new Map(); // every legacy spelling a voice has had -> its Classic label
  for (const label of picker.classic || []) classicOf.set(label.slice(0, -CLASSIC.length), label);
  const byLower = new Map((picker.classic || []).map(label => [label.toLowerCase(), label]));
  const latest = new Map(); // Classic label -> newest report stamp placed
  const stampOf = report => `${(report && report.createdAt) || ''}|${(report && report._id) || ''}`;

  function retain(label) {
    if (typeof label !== 'string' || !label || picker.voices.includes(label) || picker.hidden.includes(label)) return;
    picker.hidden.push(label);
  }

  // Move one Classic label into "Classic · <section>". Sections are edited in
  // place (other modules hold the same picker object); an emptied Classic
  // heading is dropped, as the boot builder never serves an empty one.
  function place(classicLabel, section, report) {
    const stamp = stampOf(report);
    const previous = latest.get(classicLabel);
    const holding = picker.categories.filter(c => c.voices.includes(classicLabel));
    // A superseded report names where the newer one put the voice, not where it asked for.
    if (previous !== undefined && stamp < previous) return { outcome: 'superseded', current: holding.map(c => c.name).join('; ') };
    latest.set(classicLabel, stamp);
    const name = CLASSIC_SECTION + section;
    if (holding.length === 1 && holding[0].name === name) return { outcome: 'already', from: name };
    let target = picker.categories.find(c => c.name === name);
    if (!target) {
      target = { name, voices: [] };
      const more = picker.categories.findIndex(c => c.name === MORE);
      if (more >= 0) picker.categories.splice(more, 0, target); else picker.categories.push(target);
    }
    for (const c of holding) if (c !== target) c.voices = c.voices.filter(v => v !== classicLabel);
    if (!target.voices.includes(classicLabel)) target.voices.push(classicLabel);
    for (let i = picker.categories.length - 1; i >= 0; i--) {
      const c = picker.categories[i];
      if (c !== target && c.name.startsWith(CLASSIC_SECTION) && !c.voices.length) picker.categories.splice(i, 1);
    }
    return { outcome: 'moved', from: holding.map(c => c.name).join('; ') };
  }

  function afterLegacyMove(res, report) {
    if (!res || !res.ok || res.selected || res.classic) return null;
    const { oldLabel, newLabel } = res;
    if (typeof newLabel !== 'string' || !newLabel) return null;
    const { VOICE_MAP, VOICE_DESCRIBE, VOICE_TAGS, VOICE_PICKER_CATEGORIES } = legacy;
    retain(oldLabel);
    retain(newLabel);
    if (oldLabel && oldLabel !== newLabel) {
      picker.renames[oldLabel] = newLabel;
      for (const [from, to] of Object.entries(picker.renames)) if (to === oldLabel) picker.renames[from] = newLabel;
    }
    const target = VOICE_MAP[newLabel];
    if (typeof target === 'string') {
      const provider = target.startsWith('fish:') ? 'fish' : 'inworld';
      picker.providers[newLabel] = provider;
      if (!picker.providers[target]) picker.providers[target] = provider;
      if (provider === 'fish' && Array.isArray(picker.retainedFish) && !picker.retainedFish.includes(newLabel)) picker.retainedFish.push(newLabel);
    }
    if (VOICE_DESCRIBE[newLabel] !== undefined) picker.describe[newLabel] = VOICE_DESCRIBE[newLabel];
    if (VOICE_TAGS[newLabel] !== undefined) picker.tags[newLabel] = VOICE_TAGS[newLabel];
    const classicLabel = classicOf.get(oldLabel) || classicOf.get(newLabel);
    if (!classicLabel) return null;
    classicOf.set(newLabel, classicLabel);
    const section = (VOICE_PICKER_CATEGORIES.find(c => c.voices.includes(newLabel)) || {}).name || res.target;
    if (!section) return null;
    return { classicLabel, section: CLASSIC_SECTION + section, ...place(classicLabel, section, report) };
  }

  function applyClassicReport(parsed, report) {
    const label = String(parsed.label || '').trim();
    if (!label.toLowerCase().endsWith(CLASSIC.toLowerCase())) return null;
    const classicLabel = byLower.get(label.toLowerCase());
    if (!classicLabel) return null; // not a Classic entry this picker serves
    const legacyLabel = classicLabel.slice(0, -CLASSIC.length);
    const heading = String(parsed.heading || '').replace(/^Classic · /, '');
    const section = targetFor(parsed.heard, legacyLabel, heading, legacy.VOICE_PICKER_CATEGORIES);
    if (!section) return { ok: false, classic: true, why: `no section for "${parsed.heard}"` };
    const placed = place(classicLabel, section, report);
    const base = { ok: true, classic: true, oldLabel: classicLabel, newLabel: classicLabel, heard: parsed.heard, target: CLASSIC_SECTION + section };
    // The board note reads "A newer report already placed <label> under <target>".
    if (placed.outcome === 'superseded') return { ...base, already: true, superseded: true, target: placed.current || base.target };
    if (placed.outcome === 'already') return { ...base, already: true };
    return { ...base, from: placed.from };
  }

  return { applyClassicReport, afterLegacyMove };
}

module.exports = { createClassicVoiceMoves };
