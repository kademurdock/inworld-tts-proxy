"use strict";
/* GW-10 (Nov 12 2026): the phone's streamed first piece is encoded as it arrives (createMulawSink). Fed in
 * pieces of any size, its bytes must equal the buffered lane's pcm16ToMulaw(downsamplePcm(whole)). This
 * also pins the interaction with GW-3: a sink that filtered each piece on its own would dip at every edge. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMulawSink, pcm16ToMulaw, downsamplePcm } = require("./telephony-codec");

function speechish(sr, sec) {
  const n = Math.round(sr * sec);
  const b = Buffer.alloc(n * 2);
  let r = 11;
  for (let i = 0; i < n; i++) {
    r = (r * 1664525 + 1013904223) >>> 0;
    const t = i / sr;
    const v = (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.7 * t)) * (9000 * Math.sin(2 * Math.PI * 220 * t) + 5000 * Math.sin(2 * Math.PI * 1300 * t) + 3000 * Math.sin(2 * Math.PI * 3900 * t) + 2500 * (r / 2 ** 32 - 0.5));
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return b;
}
function streamThrough(pcm, rate, sizes) {
  const parts = [];
  const sink = createMulawSink((mu) => parts.push(Buffer.from(mu)), rate);
  let at = 0, k = 0;
  while (at < pcm.length) {
    const n = sizes[k++ % sizes.length];
    sink.push(pcm.subarray(at, at + n));
    at += n;
  }
  sink.end();
  return Buffer.concat(parts);
}
function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before; }
}
const SIZES = [1, 5, 7, 4096, 333, 2];

for (const mode of [undefined, "box"]) {
  for (const rate of [24000, 16000, 48000]) {
    test(`streamed in odd pieces equals the buffered lane at ${rate} Hz (${mode ? "box" : "filter"})`, () => {
      withEnv("TTS_PHONE_DECIMATOR", mode, () => {
        const pcm = speechish(rate, 1.37);
        const want = pcm16ToMulaw(downsamplePcm(pcm, rate, 8000));
        assert.ok(streamThrough(pcm, rate, SIZES).equals(want), "piece sizes 1, 5, 7, 4096, 333, 2");
        assert.ok(streamThrough(pcm, rate, [pcm.length]).equals(want), "one piece");
        assert.ok(streamThrough(pcm, rate, [960]).equals(want), "network-sized pieces");
      });
    });
  }
}

test("the filter sink writes as it goes, under 1 ms behind its input", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    const pcm = speechish(24000, 0.5);
    let written = 0;
    const sink = createMulawSink((mu) => { written += mu.length; }, 24000);
    sink.push(pcm.subarray(0, 4800)); // 100 ms in
    assert.ok(written >= 800 - 8 && written < 800, `wrote ${written} of 800 bytes after 100 ms of input`);
    sink.push(pcm.subarray(4800));
    sink.end();
    assert.equal(written, 4000);
  });
});

/* Lead review (Nov 12 2026): the streamed opener ends in the same 12 ms fade as the buffered phone lane. */
function g711Decode(u) {
  u = ~u & 0xFF;
  const mag = ((((u & 0x0F) << 3) + 132) << ((u >> 4) & 7)) - 132;
  return u & 0x80 ? -mag : mag;
}
function square(sr, sec, amp = 30000) { // ends at full amplitude: the worst case for a click
  const n = Math.round(sr * sec); const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(amp, i * 2);
  return b;
}
test("fadeOutMs: a clip that stops at full amplitude ends in a 12 ms fade, in odd pieces too", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    const pcm = square(24000, 0.5);
    const parts = [];
    const sink = createMulawSink((mu) => parts.push(Buffer.from(mu)), 24000, { fadeOutMs: 12 });
    for (let at = 0, k = 0; at < pcm.length; at += SIZES[k++ % SIZES.length]) sink.push(pcm.subarray(at, at + SIZES[(k) % SIZES.length]));
    sink.end();
    const out = Buffer.concat(parts);
    assert.equal(out.length, 4000, "same length as the unfaded clip");
    const last = g711Decode(out[out.length - 1]);
    assert.ok(Math.abs(last) < 1500, `the last sample is near silence (${last})`);
    const mid = g711Decode(out[2000]);
    assert.ok(mid > 25000, `the body is untouched (${mid})`);
    // the ramp: 12 ms = 96 phone samples, falling all the way
    const at = (i) => g711Decode(out[out.length - 96 + i]);
    assert.ok(at(10) > at(50) && at(50) > at(90), "falls across the last 12 ms");
  });
});
test("fadeOutMs: everything before the tail equals the buffered encoder; without it nothing changes", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    const pcm = speechish(24000, 1);
    const faded = Buffer.from(pcm);
    const n = 288; // 12 ms at 24 kHz, ramped the way fadePcmEdges ramps a tail
    for (let k = 0; k < n; k++) { const j = pcm.length / 2 - n + k; faded.writeInt16LE(Math.round(pcm.readInt16LE(j * 2) * ((n - 1 - k) / n)), j * 2); }
    const parts = [];
    const sink = createMulawSink((mu) => parts.push(Buffer.from(mu)), 24000, { fadeOutMs: 12 });
    sink.push(pcm.subarray(0, 12345)); sink.push(pcm.subarray(12345)); sink.end();
    assert.ok(Buffer.concat(parts).equals(pcm16ToMulaw(downsamplePcm(faded, 24000, 8000))));
    assert.ok(streamThrough(pcm, 24000, [960]).equals(pcm16ToMulaw(downsamplePcm(pcm, 24000, 8000))), "no fadeOutMs: unchanged");
  });
});
