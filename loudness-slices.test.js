"use strict";
/* GW-13 (Nov 12 2026): the output stage gives the event loop back between slices of a long clip, keeps no
 * clip-length float array, and writes the same bytes it always wrote. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyShelf, applyShelfAsync, toneMatch, toneMatchAsync, measureTone, measureToneAsync, biquadCoeffs } = require("./tone");
const { limitPcmInPlace, limitPcmInPlaceAsync } = require("./limiter");
const { inSlices, sliceSamplesFor } = require("./slices");

const SR = 24000;
function clip(sec, { bass = 3000, mid = 6000, high = 800, amp = 1 } = {}) {
  const n = Math.round(sec * SR);
  const b = Buffer.alloc(n * 2);
  let r = 7;
  for (let i = 0; i < n; i++) {
    r = (r * 1664525 + 1013904223) >>> 0;
    const t = i / SR;
    const v = amp * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3.1 * t)) * (bass * Math.sin(2 * Math.PI * 140 * t) + mid * Math.sin(2 * Math.PI * 900 * t) + high * Math.sin(2 * Math.PI * 6000 * t) + 600 * (r / 2 ** 32 - 0.5));
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return b;
}
// The shelf as it was before GW-13: floats kept in an array as long as the clip.
function applyShelfKeptFloats(pcmBuf, sampleRate, type, fc, gainDb) {
  const c = biquadCoeffs(type, fc, sampleRate, { gainDb });
  const total = pcmBuf.length >> 1;
  const y = new Float64Array(total);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0;
  for (let i = 0; i < total; i++) {
    const x = pcmBuf.readInt16LE(i * 2);
    const v = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = v;
    y[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const scale = peak > 32767 ? 32767 / peak : 1;
  for (let i = 0; i < total; i++) pcmBuf.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, y[i] * scale))), i * 2);
  return { scaleDb: scale < 1 ? 20 * Math.log10(scale) : 0 };
}
const SHELVES = [["lowshelf", 300, 3], ["lowshelf", 300, -4], ["highshelf", 3000, 3], ["highshelf", 3000, -4]];
const CLIPS = [clip(0.3), clip(9.7, { bass: 14000 }), clip(9.7, { amp: 3 }), clip(9.7, { bass: 300, mid: 20000, high: 9000, amp: 1.5 })];

test("applyShelf without the clip-length array writes the bytes the kept-floats shelf wrote, headroom scaling included", async () => {
  let scaledSeen = false;
  for (const src of CLIPS) {
    for (const [type, fc, db] of SHELVES) {
      const want = Buffer.from(src), got = Buffer.from(src), gotAsync = Buffer.from(src);
      const rw = applyShelfKeptFloats(want, SR, type, fc, db);
      const rg = applyShelf(got, SR, type, fc, db);
      const ra = await applyShelfAsync(gotAsync, SR, type, fc, db);
      assert.ok(want.equals(got), `${type} ${db} one-piece`);
      assert.ok(want.equals(gotAsync), `${type} ${db} sliced`);
      assert.equal(rg.scaleDb, rw.scaleDb);
      assert.equal(ra.scaleDb, rw.scaleDb);
      if (rw.scaleDb < 0) scaledSeen = true;
    }
  }
  assert.ok(scaledSeen, "at least one case went down the headroom-scaling path");
});

test("the sliced tone match and limiter equal the one-piece ones on a clip longer than two slices", async () => {
  const cfg = { lowTargetDb: -2, highTargetDb: -13.5, deadbandDb: 3, maxCutDb: 4, maxBoostDb: 3, lowShelfHz: 300, highShelfHz: 3000 };
  for (const src of CLIPS) {
    assert.deepEqual(await measureToneAsync(src, SR), measureTone(src, SR));
    const a = Buffer.from(src), b = Buffer.from(src);
    assert.equal(await toneMatchAsync(b, SR, cfg), toneMatch(a, SR, cfg));
    assert.ok(a.equals(b), "tone match bytes");
    const gainAt = (i) => (i < 2160 ? 1 + i / 2160 : 2);
    const ra = limitPcmInPlace(a, SR, gainAt, 30000);
    const rb = await limitPcmInPlaceAsync(b, SR, gainAt, 30000);
    assert.ok(a.equals(b), "limiter bytes");
    assert.deepEqual(rb, ra);
  }
});

test("a slice is a multiple of four samples and a clip shorter than one slice gives up no turn", async () => {
  for (const sr of [8000, 16000, 22050, 24000, 44100, 48000]) assert.equal(sliceSamplesFor(sr) % 4, 0, String(sr));
  let turns = 0, on = true;
  const tick = () => { turns++; if (on) setImmediate(tick); };
  setImmediate(tick);
  const seen = [];
  await inSlices(sliceSamplesFor(SR) - 1, sliceSamplesFor(SR), (from, to) => seen.push([from, to]));
  const turnsShort = turns;
  await inSlices(sliceSamplesFor(SR) * 3, sliceSamplesFor(SR), () => {});
  on = false;
  assert.deepEqual(seen, [[0, sliceSamplesFor(SR) - 1]]);
  assert.equal(turnsShort, 0, "short clip: one piece");
  assert.ok(turns >= 2, "long clip: the loop got its turns");
});

test("the loop is never held longer than 50 ms while two minutes of audio go through tone match and limiter", async () => {
  const base = clip(10, { bass: 14000, amp: 2 });
  const buf = Buffer.concat(Array.from({ length: 12 }, () => base));
  const cfg = { lowTargetDb: -2, highTargetDb: -13.5, deadbandDb: 3, maxCutDb: 4, maxBoostDb: 3, lowShelfHz: 300, highShelfHz: 3000 };
  let last = process.hrtime.bigint(), worst = 0n, on = true;
  const tick = () => { const now = process.hrtime.bigint(); if (now - last > worst) worst = now - last; last = now; if (on) setImmediate(tick); };
  await new Promise((r) => setImmediate(r));
  last = process.hrtime.bigint();
  setImmediate(tick);
  const note = await toneMatchAsync(buf, SR, cfg);
  await limitPcmInPlaceAsync(buf, SR, () => 1.5, 30000);
  on = false;
  const now = process.hrtime.bigint(); if (now - last > worst) worst = now - last;
  assert.match(note, /tone low/);
  assert.ok(Number(worst) / 1e6 < 50, `longest stall ${(Number(worst) / 1e6).toFixed(1)} ms`);
});

test("wire: server.js awaits every normalizeLoudness call and no longer spreads the windows into Math.max", () => {
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(src, /async function normalizeLoudness\(/);
  const calls = src.split("\n").filter((l) => /\bnormalizeLoudness\(/.test(l) && !/function normalizeLoudness\(/.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l));
  assert.ok(calls.length >= 3, `found ${calls.length} calls`);
  for (const l of calls) assert.match(l, /await normalizeLoudness\(/, l.trim().slice(0, 90));
  assert.doesNotMatch(src, /= Math\.max\(\.\.\.winRms\)/);
  assert.match(src, /await limitPcmInPlaceAsync\(/);
  assert.match(src, /await toneMatchAsync\(/);
});
