'use strict';

const FISH_PACES = [
  { value: 0.75, name: 'Unhurried', direction: 'Speak unhurriedly, with relaxed phrasing and clear words.' },
  { value: 0.9, name: 'Easygoing', direction: 'Speak at an easygoing conversational pace, with natural expressive phrasing.' },
  { value: 1, name: 'Natural', direction: '' },
  { value: 1.2, name: 'Brisk', direction: 'Speak briskly and fluidly, with clear words and natural expressive phrasing.' },
  { value: 1.5, name: 'Quick', direction: 'Speak quickly and fluently, with crisp articulation and natural expressive phrasing.' },
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
