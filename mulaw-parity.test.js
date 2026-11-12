"use strict";
/* GW-3 parity (Nov 12 2026, gateway audit). The voice proxy (telephony-codec.js encodeMulaw) and the call
 * bridge (voice-stream.js encodeUlaw) each carry a G.711 mu-law encoder, and the bridge frames the proxy's
 * bytes unchanged. They are separate deployments with no shared package, so this table is pinned in BOTH
 * repos: the same fixture points and the same SHA-256 over all 65,536 inputs. If one side changes, its copy
 * of this test fails; change both or neither. (The two disagreed on 16,503 inputs before GW-3.) */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { encodeMulaw } = require("./telephony-codec");

// [16-bit input, mu-law byte]: both ends, the clip edge, segment edges, the old fold near 95, silence.
const FIXTURE = [
  [-32768, 0], [-32767, 0], [-32636, 0], [-32635, 0], [-20000, 12], [-8159, 31], [-4096, 47], [-1000, 78],
  [-256, 103], [-100, 114], [-95, 115], [-31, 123], [-4, 126], [-1, 127], [0, 255], [1, 255], [4, 254],
  [31, 251], [95, 243], [100, 242], [150, 238], [255, 231], [256, 231], [1000, 206], [4095, 175], [4096, 175],
  [8158, 159], [8159, 159], [16000, 144], [32634, 128], [32635, 128], [32636, 128], [32767, 128],
];
// sha256 of the 65,536 output bytes for inputs -32768..32767 in order (bias 132, clip 32635).
const ALL_INPUTS_SHA256 = "5ee7cf5f273f842d2234121e4cb0c98d6b20a99ac29026f94e05b36955b195be";

test("mu-law fixture points match the pinned table (same table as the bridge)", () => {
  for (const [v, want] of FIXTURE) assert.equal(encodeMulaw(v), want, `input ${v}`);
});

test("mu-law over all 65,536 inputs matches the pinned hash (same hash as the bridge)", () => {
  const out = Buffer.alloc(65536);
  for (let v = -32768; v <= 32767; v++) out[v + 32768] = encodeMulaw(v);
  assert.equal(crypto.createHash("sha256").update(out).digest("hex"), ALL_INPUTS_SHA256);
});
