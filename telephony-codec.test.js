"use strict";
/* GW-3 (Nov 12 2026): the phone lane's mu-law encoder used the 14-bit bias on 16-bit samples, and its
 * 24 kHz -> 8 kHz step was a 3-sample average. Pins the G.711 encoder and the anti-alias filter. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { encodeMulaw, pcm16ToMulaw, downsamplePcm } = require("./telephony-codec");

// The G.711 reference expansion, as Twilio and handsets decode it.
function g711Decode(u) {
  u = ~u & 0xFF;
  const mag = ((((u & 0x0F) << 3) + 132) << ((u >> 4) & 7)) - 132;
  return u & 0x80 ? -mag : mag;
}
function tone(freq, sr = 24000, sec = 1, amp = 16000) {
  const n = Math.round(sr * sec); const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * freq * i / sr)), i * 2);
  return b;
}
// Level of the middle half of a clip against a sine of amplitude 16000, in dB.
function relDb(b) {
  const n = b.length >> 1; let e = 0, c = 0;
  for (let i = n >> 2; i < n - (n >> 2); i++) { const v = b.readInt16LE(i * 2); e += v * v; c++; }
  return 20 * Math.log10(Math.sqrt(e / c) / (16000 / Math.SQRT2) + 1e-12);
}
function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before; }
}

test("silence is 0xFF and the ends of the scale are right", () => {
  assert.equal(encodeMulaw(0), 0xFF);
  assert.equal(encodeMulaw(-1), 0x7F);
  assert.equal(encodeMulaw(32767), 0x80);
  assert.equal(encodeMulaw(-32768), 0x00);
});
test("mu-law round trip stays within one quantization step on all 65,536 inputs", () => {
  for (let v = -32768; v <= 32767; v++) {
    const back = g711Decode(encodeMulaw(v));
    const a = Math.min(Math.abs(v), 32635);
    assert.ok(Math.abs(Math.abs(back) - a) <= Math.max(4, (a + 132) / 32 + 1), `${v} came back ${back}`);
    if (Math.abs(v) >= 4) assert.equal(Math.sign(back), Math.sign(v), `sign of ${v}`);
  }
  assert.ok(Math.abs(g711Decode(encodeMulaw(100)) - 100) <= 4, "no dead zone at 100");
});
test("pcm16ToMulaw gives one byte per sample", () => {
  assert.equal(pcm16ToMulaw(tone(1000, 8000, 0.02)).length, 160);
});
test("the phone band passes: 1 kHz and 3 kHz keep their level", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    assert.ok(Math.abs(relDb(downsamplePcm(tone(1000), 24000, 8000))) < 0.2);
    assert.ok(relDb(downsamplePcm(tone(3000), 24000, 8000)) > -1.5);
  });
});
test("5, 6 and 7 kHz do not fold into the phone band", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    for (const f of [5000, 6000, 7000]) {
      const db = relDb(downsamplePcm(tone(f), 24000, 8000));
      assert.ok(db < -40, `${f} Hz left at ${db.toFixed(1)} dB`);
    }
  });
});
test("length, timing and odd sizes match the old step", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    assert.equal(downsamplePcm(tone(1000, 24000, 1), 24000, 8000).length, 16000);
    assert.equal(downsamplePcm(Buffer.alloc(0), 24000, 8000).length, 0);
    assert.equal(downsamplePcm(Buffer.alloc(4), 24000, 8000).length, 0);
    assert.equal(downsamplePcm(Buffer.alloc(7), 24000, 8000).length, 2);
    const same = Buffer.alloc(10); assert.equal(downsamplePcm(same, 8000, 8000), same);
    // a click at input sample 3001 lands on output sample 1000, where the averaging put it
    const click = Buffer.alloc(6000 * 2); click.writeInt16LE(30000, 3001 * 2);
    const out = downsamplePcm(click, 24000, 8000); let at = 0, peak = 0;
    for (let i = 0; i < out.length >> 1; i++) { const a = Math.abs(out.readInt16LE(i * 2)); if (a > peak) { peak = a; at = i; } }
    assert.equal(at, 1000);
  });
});
test("a full-scale clip clamps instead of wrapping", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    const sq = Buffer.alloc(2400 * 2);
    for (let i = 0; i < 2400; i++) sq.writeInt16LE((Math.floor(i / 120) & 1) ? -32768 : 32767, i * 2);
    const out = downsamplePcm(sq, 24000, 8000);
    for (let i = 0; i < out.length >> 1; i++) {
      const want = (Math.floor((i * 3 + 1) / 120) & 1) ? -1 : 1;
      const v = out.readInt16LE(i * 2);
      if (Math.abs(v) > 16000) assert.equal(Math.sign(v), want, `sample ${i} wrapped to ${v}`);
    }
  });
});
test("16 kHz and 48 kHz sources are filtered too", () => {
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    assert.ok(relDb(downsamplePcm(tone(5000, 16000), 16000, 8000)) < -40);
    assert.ok(relDb(downsamplePcm(tone(5000, 48000), 48000, 8000)) < -40);
    assert.ok(Math.abs(relDb(downsamplePcm(tone(1000, 48000), 48000, 8000))) < 0.2);
  });
});
test("TTS_PHONE_DECIMATOR=box restores the averaging, and other rate pairs still average", () => {
  withEnv("TTS_PHONE_DECIMATOR", "box", () => {
    const b = Buffer.alloc(12); [3, 6, 9, 30, 60, 90].forEach((v, i) => b.writeInt16LE(v, i * 2));
    const out = downsamplePcm(b, 24000, 8000);
    assert.deepEqual([out.readInt16LE(0), out.readInt16LE(2)], [6, 60]);
    assert.ok(relDb(downsamplePcm(tone(5000), 24000, 8000)) > -10, "the old fold is back");
  });
  withEnv("TTS_PHONE_DECIMATOR", undefined, () => {
    const b = Buffer.alloc(8); [10, 20, 30, 40].forEach((v, i) => b.writeInt16LE(v, i * 2));
    const out = downsamplePcm(b, 48000, 24000);
    assert.deepEqual([out.readInt16LE(0), out.readInt16LE(2)], [15, 35]);
  });
});
