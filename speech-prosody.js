'use strict';

// Provider adapters only; display text and authored directions stay intact.
const EMPHASIZED_WORDS = new Set(['IS', 'IT', 'MY', 'ME', 'BE', 'DO', 'GO', 'SO', 'TO', 'NO', 'YES', 'NOT', 'THE', 'THIS', 'THAT', 'YOU', 'YOUR', 'ARE', 'WAS', 'WERE']);
function normalizeInworldCaps(text) {
  return String(text).replace(/\[[^\]]*\]|\b[A-Z]{2,4}\b/g, word => EMPHASIZED_WORDS.has(word) ? word.toLowerCase() : word);
}

function shapeFishPauses(text) {
  let count = 0;
  // Mask steering text: punctuation inside a cue must never create a pause.
  const tags = [];
  const masked = String(text).replace(/\[[^\]]*\]/g, tag => '\uE000' + (tags.push(tag) - 1) + '\uE001');
  const paced = masked.replace(/([.!?]["'”’)]*)([ \t]+)(?=\S)/g, (match, terminal, gap, offset) => {
    const before = masked.slice(0, offset);
    const after = masked.slice(offset + match.length);
    const last = before.match(/(?:^|\s)([^\s]+)$/)?.[1] || '';
    if (count >= 12 || /\.$/.test(before) || /^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|[A-Z])$/i.test(last)) return match;
    const nextTag = after.match(/^\uE000(\d+)\uE001/);
    if (nextTag && /\[(?:short |long )?pause\]|\[(?:inhale|exhale|breath|breathe|sigh)\]/i.test(tags[Number(nextTag[1])])) return match;
    count++;
    return terminal + ' [short pause] ';
  });
  return paced.replace(/\uE000(\d+)\uE001/g, (_, i) => tags[Number(i)]);
}

module.exports = { normalizeInworldCaps, shapeFishPauses };
