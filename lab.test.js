"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { PRESETS } = require("./lab");
test("the lab page names four presets, each with a letter, a label and a blurb", () => {
  assert.equal(PRESETS.length, 4);
  for (const p of PRESETS) { assert.ok(p.key && p.letter && p.label && p.blurb.length > 40); }
  assert.deepEqual(PRESETS.map((p) => p.letter), ["A", "B", "C", "D"]);
});
