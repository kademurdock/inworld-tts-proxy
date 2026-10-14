'use strict';

// The feedback board is the durable record. Replay by creation time, and keep
// the newest report per voice even if an older open row is retried after it.
function createSelectedReportHandler(rows, picker) {
  const lookup = new Map();
  for (const row of rows) {
    for (const name of [row.label, row.tag, 'fish:' + row.id, ...(row.aliases || [])]) {
      if (!name) continue;
      const key = name.trim().toLowerCase();
      if (lookup.has(key) && lookup.get(key) !== row) throw new Error('Ambiguous selected voice name.');
      lookup.set(key, row);
    }
  }
  const latest = new Map();
  return function applySelectedReport(parsed, report) {
    const row = lookup.get(parsed.label.trim().toLowerCase());
    if (!row) return null; // The legacy mover still owns legacy voices.
    const heard = parsed.heard.toLowerCase();
    const currentGroup = row.categories[0].split(',')[0];
    let group;
    if (/kid|teen|child/.test(heard)) group = 'Kids and teens';
    else if (/character|cartoon/.test(heard)) group = 'Characters';
    else if (/\bwoman\b/.test(heard)) group = 'Women';
    else if (/\bman\b/.test(heard)) group = 'Men';
    else if (/^(?:an? )?(?:older|younger) person$/.test(heard) && ['Women','Men'].includes(currentGroup)) group = currentGroup;
    if (!group) return { ok: false, why: 'That report needs a specific voice group.', selected: true };
    const allowed = new Set(picker.categories.map(c => c.name));
    const targets = [...new Set(row.categories.map(c => group + ', ' + c.split(', ').slice(1).join(', ')).filter(c => allowed.has(c)))];
    if (!targets.length) {
      const fallback = group + ', ' + (group === 'Kids and teens' ? 'Light & Youthful' : group === 'Characters' ? 'Characters & Distinctive' : 'Clear & Neutral');
      if (!allowed.has(fallback)) return { ok: false, why: 'Selected voice section is unavailable.', selected: true };
      targets.push(fallback);
    }
    const stamp = `${report.createdAt || ''}|${report._id || ''}`;
    const previous = latest.get(row.id);
    const base = { ok: true, selected: true, oldLabel: parsed.label, newLabel: row.label, heard, target: targets.join('; ') };
    if (previous && stamp < previous) return { ...base, already: true, superseded: true, target: row.categories.join('; ') };
    latest.set(row.id, stamp);
    if (JSON.stringify(row.categories) === JSON.stringify(targets)) return { ...base, already: true };
    const from = row.categories.join('; ');
    row.categories.splice(0, row.categories.length, ...targets);
    // Remove every old membership, including multiple tone subcategories.
    for (const section of picker.categories) {
      section.voices = section.voices.filter(v => v !== row.label);
      if (targets.includes(section.name)) section.voices.push(row.label);
    }
    return { ...base, from };
  };
}

module.exports = { createSelectedReportHandler };
