/* stream.test.js — Part 98 (Aug 29 2026). The streamed lane's pure half:
 * NDJSON parsing, header sniffing, the streaming header, and the
 * remembered-gain + knee + fade transform. Network orchestration lives in
 * server.js's tryStreamSingleChunk and is exercised by the live curl check
 * after deploy (a mocked fetch proves less than the real endpoint did). */
const test = require('node:test');
const assert = require('node:assert');
const { createNdjsonAudioParser, sniffWavFormat, buildStreamingWavHeader, createStreamProcessor } = require('./stream-lane');

function wavHeader(dataLen, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'ascii'); h.writeUInt32LE(dataLen, 40);
  return h;
}
function pcmOf(samples) {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
}
function line(audioBuf) {
  return Buffer.from(JSON.stringify({ result: { audioContent: audioBuf.toString('base64') } }) + '\n');
}

// ── NDJSON parser ───────────────────────────────────────────────────────────
test('parser decodes complete lines and holds torn ones', () => {
  const p = createNdjsonAudioParser();
  const a = Buffer.from('first-audio');
  const b = Buffer.from('second-audio');
  const wire = Buffer.concat([line(a), line(b)]);
  // Feed in awkward splits: mid-JSON, mid-base64.
  const cut = Math.floor(wire.length / 3);
  const out1 = p.feed(wire.slice(0, cut));
  const out2 = p.feed(wire.slice(cut, cut + 5));
  const out3 = p.feed(wire.slice(cut + 5));
  const all = [...out1, ...out2, ...out3];
  assert.strictEqual(all.length, 2);
  assert.ok(all[0].equals(a) && all[1].equals(b));
});

test('parser flush() recovers a final line with no trailing newline', () => {
  const p = createNdjsonAudioParser();
  const a = Buffer.from('tail');
  const noNewline = line(a).slice(0, -1);
  assert.strictEqual(p.feed(noNewline).length, 0);
  const out = p.flush();
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].equals(a));
});

test('parser surfaces an upstream error object as a throw', () => {
  const p = createNdjsonAudioParser();
  assert.throws(
    () => p.feed(Buffer.from(JSON.stringify({ error: { code: 8, message: 'concurrency' } }) + '\n')),
    /Inworld stream error/
  );
});

// ── header sniff ────────────────────────────────────────────────────────────
test('sniff finds fmt and pcm start on a real-shaped chunk 0', () => {
  const pcm = pcmOf([100, -100, 2000]);
  const chunk0 = Buffer.concat([wavHeader(pcm.length), pcm]);
  const s = sniffWavFormat(chunk0);
  assert.ok(s);
  assert.strictEqual(s.fmt.sampleRate, 24000);
  assert.strictEqual(s.fmt.numChannels, 1);
  assert.strictEqual(s.fmt.bitsPerSample, 16);
  assert.ok(chunk0.slice(s.pcmStart).equals(pcm));
});

test('sniff returns null on a torn header instead of guessing', () => {
  const chunk0 = Buffer.concat([wavHeader(1000), pcmOf([1, 2, 3])]);
  assert.strictEqual(sniffWavFormat(chunk0.slice(0, 20)), null);
  assert.strictEqual(sniffWavFormat(chunk0.slice(0, 43)), null);
});

test('sniff throws on a chunk that is not a WAV at all', () => {
  assert.throws(() => sniffWavFormat(pcmOf(new Array(50).fill(7))), /not RIFF/);
});

test('sniff ignores the declared data length (streams lie about totals)', () => {
  const pcm = pcmOf([5, 6, 7, 8]);
  const h = wavHeader(0x7fffffff); // absurd claimed length
  const s = sniffWavFormat(Buffer.concat([h, pcm]));
  assert.ok(s);
  assert.strictEqual(Buffer.concat([h, pcm]).slice(s.pcmStart).length, pcm.length);
});

// ── streaming header ────────────────────────────────────────────────────────
test('streaming header carries the fmt and unknown-length sentinels', () => {
  const h = buildStreamingWavHeader({ numChannels: 1, sampleRate: 24000, bitsPerSample: 16 });
  assert.strictEqual(h.length, 44);
  const s = sniffWavFormat(Buffer.concat([h, pcmOf([0, 0])]));
  assert.strictEqual(s.fmt.sampleRate, 24000);
  assert.strictEqual(h.readUInt32LE(4), 0xffffffff);
  assert.strictEqual(h.readUInt32LE(40), 0xffffffff);
});

// ── processor: gain, knee, fade, carry ──────────────────────────────────────
test('remembered gain is applied; missing memory means unity', () => {
  const p = createStreamProcessor({ gain: 2, knee: 26000, kneeRange: 6767, fadeInSamples: 0 });
  const out = p.process(pcmOf([1000, -1000]));
  assert.strictEqual(out.readInt16LE(0), 2000);
  assert.strictEqual(out.readInt16LE(2), -2000);
  const u = createStreamProcessor({ gain: undefined, knee: 26000, kneeRange: 6767, fadeInSamples: 0 });
  assert.strictEqual(u.appliedGain, 1.0);
  assert.strictEqual(u.process(pcmOf([1234])).readInt16LE(0), 1234);
});

test('the knee saturates and clipping is impossible even at hot gain', () => {
  const p = createStreamProcessor({ gain: 10, knee: 26000, kneeRange: 6767, fadeInSamples: 0 });
  const out = p.process(pcmOf([30000, -30000, 4000]));
  const a = out.readInt16LE(0), b = out.readInt16LE(2), c = out.readInt16LE(4);
  assert.ok(a > 26000 && a <= 32767, `saturated, not clipped: ${a}`);
  assert.strictEqual(b, -a, 'symmetric');
  assert.ok(c > 26000 && c <= 32767, '4000*10 lands in the knee too');
});

test('fade-in ramps the opening samples exactly like the buffered edge fade', () => {
  const p = createStreamProcessor({ gain: 1, knee: 26000, kneeRange: 6767, fadeInSamples: 4 });
  const out = p.process(pcmOf([10000, 10000, 10000, 10000, 10000]));
  assert.strictEqual(out.readInt16LE(0), 0);
  assert.strictEqual(out.readInt16LE(2), 2500);
  assert.strictEqual(out.readInt16LE(4), 5000);
  assert.strictEqual(out.readInt16LE(6), 7500);
  assert.strictEqual(out.readInt16LE(8), 10000, 'past the fade window: untouched');
});

test('a sample torn across chunks is carried, never mangled', () => {
  const p = createStreamProcessor({ gain: 1, knee: 26000, kneeRange: 6767, fadeInSamples: 0 });
  const whole = pcmOf([12345, -12345]);
  const out1 = p.process(whole.slice(0, 3)); // one full sample + one lone byte
  const out2 = p.process(whole.slice(3));
  const joined = Buffer.concat([out1, out2]);
  assert.strictEqual(joined.length, 4);
  assert.strictEqual(joined.readInt16LE(0), 12345);
  assert.strictEqual(joined.readInt16LE(2), -12345);
});

// ── Part 116.1: the stream's own peak ceiling ───────────────────────────────
test('peakCeiling caps a hot remembered gain against the chunk\'s own peak (no wall-to-wall saturation)', () => {
  // remembered gain 7 (the Birta case), a normal clip peaking at 20000
  const p = createStreamProcessor({ gain: 7, knee: 26000, kneeRange: 6767, fadeInSamples: 0, peakCeiling: 32000, rampSamples: 1 });
  const out = p.process(pcmOf([20000, 4000, -20000, 4000]));
  // effective gain = 32000/20000 = 1.6, not 7
  assert.ok(Math.abs(p.effectiveGain - 1.6) < 1e-9, `effective ${p.effectiveGain}`);
  assert.strictEqual(p.appliedGain, 7, 'reports the remembered gain unchanged');
  assert.strictEqual(out.readInt16LE(2), 6400, '4000 * 1.6, clean, not saturated');
  // 20000 * 1.6 = 32000 sits in the knee, so it lands soft-limited just under full scale
  assert.ok(out.readInt16LE(0) <= 32000 && out.readInt16LE(0) > 26000, `peak lands at the ceiling, soft: ${out.readInt16LE(0)}`);
});

test('peakCeiling never pulls a gain below unity, and is off when absent', () => {
  const p = createStreamProcessor({ gain: 1.2, knee: 26000, kneeRange: 6767, fadeInSamples: 0, peakCeiling: 32000, rampSamples: 1 });
  p.process(pcmOf([32000]));
  assert.strictEqual(p.effectiveGain, 1, 'hot voice plays at provider level');
  const q = createStreamProcessor({ gain: 10, knee: 26000, kneeRange: 6767, fadeInSamples: 0 });
  const out = q.process(pcmOf([4000]));
  assert.ok(out.readInt16LE(0) > 26000, 'without the option the old pure-knee behaviour is untouched');
});

test('peakCeiling ramps a step down over rampSamples instead of jumping', () => {
  const p = createStreamProcessor({ gain: 4, knee: 26000, kneeRange: 6767, fadeInSamples: 0, peakCeiling: 32000, rampSamples: 4 });
  p.process(pcmOf([1000, 1000])); // quiet: gain stays 4
  assert.strictEqual(p.effectiveGain, 4);
  const out = p.process(pcmOf([16000, 1000, 1000, 1000, 1000])); // peak 16000 -> ceiling gain 2
  assert.strictEqual(p.effectiveGain, 2);
  // sample 0 at gain 4 (start of ramp), sample 4 fully at gain 2
  assert.strictEqual(out.readInt16LE(8), 2000);
  assert.ok(out.readInt16LE(2) > 2000 && out.readInt16LE(2) < 4000, `mid-ramp: ${out.readInt16LE(2)}`);
});
