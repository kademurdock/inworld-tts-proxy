'use strict';

// Fish pace is an actor instruction in front of each request's text. Drama3
// bills input characters, so the instruction is the pace word alone (Oct 16
// 2026; it was a 57-84 character sentence that also restated the voice's
// normal clarity and phrasing). Natural adds nothing.
const FISH_PACES = [
  { value: 0.75, name: 'Unhurried', direction: 'unhurried pace' },
  { value: 0.9, name: 'Easygoing', direction: 'easygoing pace' },
  { value: 1, name: 'Natural', direction: '' },
  { value: 1.2, name: 'Brisk', direction: 'brisk pace' },
  { value: 1.5, name: 'Quick', direction: 'quick pace' },
];

function fishPace(rate) {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  return FISH_PACES.reduce((best, pace) => Math.abs(pace.value - value) < Math.abs(best.value - value) ? pace : best);
}

// Runs at the provider boundary, after author-tempo cleanup and chunk shaping.
// This changes the actor's instruction, never the audio's playback rate.
function fishPacedText(text, rate) {
  const { direction } = fishPace(rate);
  return direction ? `[${direction}] ${text}` : text;
}

module.exports = { FISH_PACES, fishPace, fishPacedText };
