'use strict';

function classicPicker(selected, legacy) {
  const bindings = new Map();
  const labels = new Map();
  const tags = { ...selected.tags };
  const describe = { ...selected.describe };
  const providers = Object.fromEntries(Object.entries(legacy.map).map(([label, id]) => [label, id.startsWith('fish:') ? 'fish' : 'inworld']));
  for (const old of legacy.voices) {
    const target = legacy.map[old];
    if (!target || target.startsWith('fish:')) continue;
    const label = `${old} (Classic)`;
    if (selected.voices.includes(label) || (legacy.map[label] && legacy.map[label] !== target)) throw Error('Classic voice label collision.');
    bindings.set(label, target);
    labels.set(old, label);
    tags[label] = `${legacy.tags[old] || old} (Classic)`;
    describe[label] = `Classic Inworld voice. ${legacy.describe[old] || ''}`.trim();
    providers[label] = 'inworld';
  }
  for (const label of selected.voices) providers[label] = 'fish';
  const categories = legacy.categories.flatMap(section => {
    const voices = section.voices.map(label => labels.get(label)).filter(Boolean);
    return voices.length ? [{ name: `Classic · ${section.name}`, voices }] : [];
  });
  const categorized = new Set(categories.flatMap(section => section.voices));
  const remaining = [...bindings.keys()].filter(label => !categorized.has(label));
  if (remaining.length) categories.push({ name: 'Classic · More Inworld voices', voices: remaining });
  return {
    bindings,
    picker: { ...selected, voices: [...selected.voices, ...bindings.keys()], custom: [...selected.custom, ...bindings.keys()],
      categories: [...selected.categories, ...categories], tags, describe, providers,
      classic: [...bindings.keys()], fish: selected.fish },
  };
}

module.exports = { classicPicker };
