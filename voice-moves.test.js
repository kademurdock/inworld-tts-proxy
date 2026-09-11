// node --test voice-moves.test.js — the pure half of the auto-mover.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("./voice-moves");

const CATS = ["Women, bright and high, young", "Women, bright and clear, young", "Women, bright and clear, grown", "Women, smooth and warm, young", "Women, smooth and warm, grown", "Women, soft and breathy", "Women, low and husky", "Women, seasoned and smooth", "Women, seasoned and gravelly", "Women, Southern", "Women, from abroad", "Men, bright and clear, young", "Men, bright and clear, grown", "Men, smooth and warm, young", "Men, smooth and warm, grown", "Men, soft and breathy", "Men, low and husky", "Men, seasoned and smooth", "Men, seasoned and gravelly", "Men, Southern", "Men, from abroad", "Kids and teens", "Characters and cartoons"];

function freshState() {
  const cats = CATS.map((name) => ({ name, voices: [] }));
  const put = (name, label) => cats.find((c) => c.name === name).voices.push(label);
  put("Women, soft and breathy", "breathy high-ish young woman · cortado");
  put("Women, soft and breathy", "breathy young woman · bagel");
  put("Men, bright and clear, young", "clear young man · boysenberry");
  put("Kids and teens", "smooth low-ish teen boy · mortise");
  const VOICE_MAP = { "breathy high-ish young woman · cortado": "iw-1", "breathy young woman · bagel": "iw-2", "clear young man · boysenberry": "iw-3", "smooth low-ish teen boy · mortise": "iw-4", "Voice 12": "iw-1" };
  return {
    VOICE_MAP,
    VOICE_RENAMES: { "Voice 12": "breathy high-ish young woman · cortado" },
    VOICE_DESCRIBE: { "breathy high-ish young woman · cortado": "old words" },
    VOICE_TAGS: { "breathy high-ish young woman · cortado": "cortado" },
    HIDDEN_VOICE_ALIASES: [],
    VOICE_PICKER_CATEGORIES: cats,
    VOICE_LIST: ["breathy high-ish young woman · cortado", "breathy young woman · bagel", "clear young man · boysenberry", "smooth low-ish teen boy · mortise"],
  };
}
const detail = (label, heading, heard) => `Filed from the voice picker on the phone. Voice: ${label}. Filed under "${heading}" — sounds like: ${heard}.`;

test("the picker's detail line parses, with the resolved note appended too", () => {
  const p = vm.parseReport(detail("breathy high-ish young woman · cortado", "Women", "a kid or a teen") + "\n\n[2026-09-11 → resolved] [auto-move] moved");
  assert.deepEqual(p, { label: "breathy high-ish young woman · cortado", heading: "Women", heard: "a kid or a teen" });
  assert.equal(vm.parseReport("nothing like it"), null);
});

test("each of the six choices lands in a real section", () => {
  const cats = CATS.map((name) => ({ name, voices: [] }));
  assert.equal(vm.targetFor("a kid or a teen", "breathy high-ish young woman · cortado", "Women", cats), "Kids and teens");
  assert.equal(vm.targetFor("a character or cartoon", "breathy young woman · bagel", "Women", cats), "Characters and cartoons");
  assert.equal(vm.targetFor("a woman", "clear young man · boysenberry", "Men", cats), "Women, bright and clear, young");
  assert.equal(vm.targetFor("a man", "breathy young woman · bagel", "Women", cats), "Men, soft and breathy");
  assert.equal(vm.targetFor("an older person", "gravelly low woman · mast", "Women", cats), "Women, seasoned and gravelly");
  assert.equal(vm.targetFor("a younger person", "smooth low-ish man · earlgrey", "Men", cats), "Men, smooth and warm, young");
  assert.equal(vm.targetFor("a woman", "warm low-ish woman, Southern US · fog", "Women", cats), "Women, Southern");
});

test("relabel keeps the tag and swaps the noun the way the Sep 8 corrections did", () => {
  assert.equal(vm.relabel("breathy high-ish young woman · cortado", "Kids and teens", "a kid or a teen"), "breathy high-ish youthful voice · cortado");
  assert.equal(vm.relabel("thin high young woman · monarch", "Kids and teens", "a kid or a teen"), "thin high youthful voice · monarch");
  assert.equal(vm.relabel("breathy young woman · bagel", "Characters and cartoons", "a character or cartoon"), "breathy character · bagel");
  assert.equal(vm.relabel("clear young man · boysenberry", "Women, bright and clear, young", "a woman"), "clear young woman · boysenberry");
  assert.equal(vm.relabel("smooth low-ish man · earlgrey", "Men, seasoned and smooth", "an older person"), "smooth low-ish older man · earlgrey");
  assert.equal(vm.relabel("no tag here", "Kids and teens", "a kid"), null);
});

test("a move edits every live map, keeps the old spelling as a hidden alias, and is idempotent", () => {
  const s = freshState();
  const r = vm.applyReport(s, { detail: detail("breathy high-ish young woman · cortado", "Women", "a kid or a teen") });
  assert.equal(r.ok, true); assert.equal(r.target, "Kids and teens"); assert.equal(r.newLabel, "breathy high-ish youthful voice · cortado");
  const kids = s.VOICE_PICKER_CATEGORIES.find((c) => c.name === "Kids and teens").voices;
  const women = s.VOICE_PICKER_CATEGORIES.find((c) => c.name === "Women, soft and breathy").voices;
  assert.ok(kids.includes(r.newLabel)); assert.ok(!women.includes(r.oldLabel));
  assert.equal(s.VOICE_MAP[r.newLabel], "iw-1");
  assert.equal(s.VOICE_RENAMES[r.oldLabel], r.newLabel);
  assert.equal(s.VOICE_RENAMES["Voice 12"], r.newLabel, "an older rename that pointed at the old label follows it");
  assert.equal(s.VOICE_TAGS[r.newLabel], "cortado");
  assert.ok(s.HIDDEN_VOICE_ALIASES.includes(r.oldLabel));
  assert.ok(s.VOICE_LIST.includes(r.newLabel) && !s.VOICE_LIST.includes(r.oldLabel));
  assert.match(s.VOICE_DESCRIBE[r.newLabel], /Kids and teens/);
  const again = vm.applyReport(s, { detail: detail("breathy high-ish young woman · cortado", "Women", "a kid or a teen") });
  assert.equal(again.ok, true); assert.equal(again.already, true);
  assert.equal(kids.filter((v) => v === r.newLabel).length, 1);
});

test("a report about a voice already in the right section is confirmed, not moved twice", () => {
  const s = freshState();
  const r = vm.applyReport(s, { detail: detail("smooth low-ish teen boy · mortise", "Kids and teens", "a kid or a teen") });
  assert.equal(r.ok, true); assert.equal(r.already, true);
});

test("the runner reads open rows, applies them, resolves each with an [auto-move] receipt, and replays resolved ones at boot", async () => {
  const s = freshState();
  const posted = [];
  const rows = [
    { _id: "a".repeat(24), subject: "Voice in the wrong section: Cortado", status: "open", detail: detail("breathy high-ish young woman · cortado", "Women", "a kid or a teen") },
    { _id: "b".repeat(24), subject: "Something else entirely", status: "open", detail: "not a voice" },
    { _id: "c".repeat(24), subject: "Voice in the wrong section: Bagel", status: "resolved", detail: detail("breathy young woman · bagel", "Women", "a character or cartoon") + "\n\n[2026-09-11 → resolved] [auto-move] breathy young woman · bagel → Characters and cartoons" },
  ];
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === "POST") { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    if (/status=all/.test(url)) return { ok: true, json: async () => rows };
    return { ok: true, json: async () => rows.filter((r) => r.status === "open") };
  };
  const runner = vm.makeRunner({ state: s, port: 1, secret: "x", log() {}, warn() {}, fetchImpl });
  assert.equal(await runner.replayResolved(), 1, "the resolved auto-move row is re-applied at boot");
  assert.ok(s.VOICE_PICKER_CATEGORIES.find((c) => c.name === "Characters and cartoons").voices.includes("breathy character · bagel"));
  assert.equal(await runner.sweepOpen(), 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].id, "a".repeat(24)); assert.equal(posted[0].status, "resolved"); assert.match(posted[0].note, /^\[auto-move\] breathy high-ish young woman · cortado → Kids and teens/);
  assert.ok(s.VOICE_PICKER_CATEGORIES.find((c) => c.name === "Kids and teens").voices.includes("breathy high-ish youthful voice · cortado"));
});
