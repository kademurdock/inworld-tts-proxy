// Stands in for fish-stretch.js in the real handler, so a test can see every number and lane that
// reaches the worker without Python. STRETCH_RECEIPT collects them. STRETCH_STUB: cut (default) drops
// samples to the wanted length; keep hands every clip back; alternate does each by turns.
const fs = require('node:fs');
const Module = require('node:module');
const originalLoad = Module._load;
let asked = 0;
const fishStretch = {
  stretch: async (pcm, ratio, rate, options = {}) => {
    asked++;
    fs.appendFileSync(process.env.STRETCH_RECEIPT, JSON.stringify({ ratio, rate, bytes: pcm.length, lane: options.lane || null }) + '\n');
    const mode = process.env.STRETCH_STUB || 'cut';
    if (mode === 'keep' || (mode === 'alternate' && asked % 2 === 0)) return pcm;
    const wanted = Math.round(pcm.length / 2 / ratio);
    const out = Buffer.alloc(wanted * 2);
    for (let i = 0; i < wanted; i++) out.writeInt16LE(pcm.readInt16LE(Math.min(Math.floor(i * ratio), pcm.length / 2 - 1) * 2), i * 2);
    return out;
  },
  warm: () => {},
  stop: () => {},
  health: () => ({ ready: true, asked, stretched: asked, kept: 0, restarts: 0, slowestClipMs: 0, slowestClipSeconds: 0 }),
  pid: () => null,
};
Module._load = function (request, parent, isMain) {
  if (request === './fish-stretch') return { fishStretch, createFishStretch: () => fishStretch };
  return originalLoad.call(this, request, parent, isMain);
};
