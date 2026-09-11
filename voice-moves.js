// voice-moves.js — listener reports move voices between picker sections on
// their own (Part 180.5, Sep 11 2026, her word: "make it where the voice
// reports are automatically moved to the suggested category").
//
// The picker's "Wrong section?" button (web) and its phone twin file a row
// on the feedback board with the subject "Voice in the wrong section: Name"
// and a detail line shaped exactly like:
//   Voice: <label>. Filed under "<heading>" — sounds like: <choice>.
// where <choice> is one of the six the picker offers. Until today a session
// read those rows by hand and edited voice-catalog-v2.json (Sep 8, Sep 11).
// Now the proxy reads them itself: at boot it re-applies every move it made
// before (the resolved rows carry the same detail line plus an [auto-move]
// note, so the board is the durable record and a redeploy loses nothing),
// then every few minutes it applies any new open row and resolves it with
// the receipt. The live picker maps (VOICE_MAP, VOICE_RENAMES, VOICE_DESCRIBE,
// VOICE_TAGS, HIDDEN_VOICE_ALIASES, VOICE_PICKER_CATEGORIES, VOICE_LIST) are
// edited in place, the same fields the catalog boot fills, so a saved pick of
// the old spelling keeps speaking and migrates through `renames`.
//
// Pure functions first (parse, target, relabel, apply) so this is testable
// with no server; the network half is at the bottom. Kill: VOICE_AUTO_MOVE=0.

const SUBJECT_RE = /^Voice in the wrong section:/i;
const DETAIL_RE = /Voice:\s*(.+?)\.\s*Filed under\s*"([^"]*)"\s*[—-]+\s*sounds like:\s*([^.\n]+)\.?/i;

function parseReport(detail) {
  const m = DETAIL_RE.exec(String(detail || ""));
  if (!m) return null;
  return { label: m[1].trim(), heading: m[2].trim(), heard: m[3].trim().toLowerCase() };
}

function genderOf(label, heading) {
  const l = String(label).toLowerCase();
  if (/\b(woman|girl|female|lady)\b/.test(l)) return "Women";
  if (/\b(man|boy|male|guy)\b/.test(l)) return "Men";
  const h = String(heading || "");
  if (/^Women/.test(h)) return "Women";
  if (/^Men/.test(h)) return "Men";
  return "Women";
}

// The section a report asks for. Exact for kids and characters; for the
// grown-up choices the label's own descriptor words pick the sub-section
// the picker already uses, so "breathy … woman" lands in "Women, soft and
// breathy" rather than a generic bin.
function targetFor(heard, label, heading, categories) {
  const names = (categories || []).map((c) => c.name);
  const has = (n) => names.includes(n);
  const h = String(heard || "").toLowerCase();
  if (/kid|teen|child/.test(h)) return has("Kids and teens") ? "Kids and teens" : null;
  if (/character|cartoon/.test(h)) return has("Characters and cartoons") ? "Characters and cartoons" : null;
  let gender = genderOf(label, heading);
  if (/\bwoman\b/.test(h)) gender = "Women";
  if (/\bman\b/.test(h)) gender = "Men";
  const l = String(label).toLowerCase();
  const older = /older/.test(h);
  const younger = /younger/.test(h);
  let sub;
  if (/southern/.test(l)) sub = "Southern";
  else if (/british|irish|australian|french|german|indian|spanish|from abroad|accent/.test(l) && !/american/.test(l)) sub = "from abroad";
  else if (older) sub = /gravel|rasp/.test(l) ? "seasoned and gravelly" : "seasoned and smooth";
  else if (/gravel|rasp/.test(l)) sub = "seasoned and gravelly";
  else if (/husky/.test(l)) sub = "low and husky";
  else if (/breathy|soft/.test(l)) sub = "soft and breathy";
  else if (/bright|clear|crisp|thin/.test(l)) sub = younger || /young/.test(l) ? "bright and clear, young" : "bright and clear, grown";
  else sub = younger || /young/.test(l) ? "smooth and warm, young" : "smooth and warm, grown";
  const want = `${gender}, ${sub}`;
  if (has(want)) return want;
  const fallback = names.find((n) => n.startsWith(gender + ","));
  return fallback || null;
}

// The new spelling: same tag word after the dot, the noun changed to what the
// listener heard. "thin high young woman · monarch" → "thin high youthful voice · monarch".
function relabel(label, target, heard) {
  const parts = String(label).split(" · ");
  if (parts.length < 2) return null;
  const tag = parts[parts.length - 1];
  let desc = parts.slice(0, -1).join(" · ");
  const NOUN = /\b(?:(?:young|older|middle-aged|little|old)\s+)?(?:teen\s+)?(?:woman|man|girl|boy|lady|guy|voice|character|youthful voice)\b/i;
  const h = String(heard || "").toLowerCase();
  let noun;
  if (/^Kids/.test(target)) noun = "youthful voice";
  else if (/^Characters/.test(target)) noun = "character";
  else {
    const base = /^Women/.test(target) ? "woman" : "man";
    if (/older/.test(h) || /seasoned/.test(target)) noun = `older ${base}`;
    else if (/younger/.test(h) || /young$/.test(target)) noun = `young ${base}`;
    else noun = base;
  }
  if (NOUN.test(desc)) desc = desc.replace(NOUN, noun);
  else desc = `${desc} ${noun}`;
  desc = desc.replace(/\s{2,}/g, " ").trim();
  return `${desc} · ${tag}`;
}

// Edit the live picker in place. Idempotent: a move already applied (the new
// label present, the old one gone) returns { already: true }.
function applyMove(state, oldLabel, newLabel, target, describe) {
  const { VOICE_MAP, VOICE_RENAMES, VOICE_DESCRIBE, VOICE_TAGS, HIDDEN_VOICE_ALIASES, VOICE_PICKER_CATEGORIES, VOICE_LIST } = state;
  const targetCat = VOICE_PICKER_CATEGORIES.find((c) => c.name === target);
  if (!targetCat) return { ok: false, why: `no section named ${target}` };
  const from = VOICE_PICKER_CATEGORIES.find((c) => c.voices.includes(oldLabel));
  if (!from) {
    if (targetCat.voices.includes(newLabel)) return { ok: true, already: true };
    return { ok: false, why: `${oldLabel} is not in any section` };
  }
  const voiceId = VOICE_MAP[oldLabel];
  if (!voiceId) return { ok: false, why: `${oldLabel} has no voice behind it` };
  from.voices = from.voices.filter((v) => v !== oldLabel);
  if (!targetCat.voices.includes(newLabel)) targetCat.voices.push(newLabel);
  VOICE_MAP[newLabel] = voiceId;
  VOICE_RENAMES[oldLabel] = newLabel;
  for (const [k, v] of Object.entries(VOICE_RENAMES)) if (v === oldLabel) VOICE_RENAMES[k] = newLabel;
  VOICE_DESCRIBE[newLabel] = describe || `A voice a family member filed under ${target} after listening.`;
  delete VOICE_DESCRIBE[oldLabel];
  if (VOICE_TAGS[oldLabel] !== undefined) { VOICE_TAGS[newLabel] = VOICE_TAGS[oldLabel]; delete VOICE_TAGS[oldLabel]; }
  if (!HIDDEN_VOICE_ALIASES.includes(oldLabel)) HIDDEN_VOICE_ALIASES.push(oldLabel);
  const ix = VOICE_LIST.indexOf(oldLabel);
  if (ix >= 0) VOICE_LIST.splice(ix, 1, newLabel); else if (!VOICE_LIST.includes(newLabel)) VOICE_LIST.push(newLabel);
  return { ok: true, from: from.name };
}

// One report, start to finish, against the live state. Returns what happened.
function applyReport(state, row) {
  const parsed = parseReport(row.detail);
  if (!parsed) return { ok: false, why: "detail did not parse" };
  const target = targetFor(parsed.heard, parsed.label, parsed.heading, state.VOICE_PICKER_CATEGORIES);
  if (!target) return { ok: false, why: `no section for "${parsed.heard}"` };
  const newLabel = relabel(parsed.label, target, parsed.heard);
  if (!newLabel) return { ok: false, why: "label has no tag" };
  const cur = state.VOICE_PICKER_CATEGORIES.find((c) => c.voices.includes(parsed.label));
  if (cur && cur.name === target) return { ok: true, already: true, target, oldLabel: parsed.label, newLabel: parsed.label };
  const res = applyMove(state, parsed.label, newLabel, target, `Filed under ${target} after a family member listened (sounds like ${parsed.heard}).`);
  return { ...res, target, oldLabel: parsed.label, newLabel, heard: parsed.heard };
}

// ── the network half ────────────────────────────────────────────────────────
function makeRunner({ state, port, secret, log = console.log, warn = console.warn, fetchImpl = globalThis.fetch }) {
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  async function get(path) {
    const r = await fetchImpl(base + path, { headers });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return r.json();
  }
  async function post(path, body) {
    const r = await fetchImpl(base + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return r.json();
  }
  const isReport = (row) => row && SUBJECT_RE.test(String(row.subject || ""));

  async function replayResolved() {
    const rows = await get("/librechat/feedback?status=all");
    const list = Array.isArray(rows) ? rows : rows.rows || [];
    let n = 0;
    for (const row of list) {
      if (!isReport(row) || row.status !== "resolved" || !/\[auto-move\]/.test(String(row.detail || ""))) continue;
      const res = applyReport(state, row);
      if (res.ok && !res.already) { n++; log(`[voice-moves] replayed ${res.oldLabel} -> ${res.target} as ${res.newLabel}`); }
    }
    return n;
  }

  async function sweepOpen() {
    const rows = await get("/librechat/feedback?status=open");
    const list = Array.isArray(rows) ? rows : rows.rows || [];
    let n = 0;
    for (const row of list) {
      if (!isReport(row)) continue;
      const res = applyReport(state, row);
      if (!res.ok) { warn(`[voice-moves] could not move from row ${row._id}: ${res.why}`); continue; }
      const note = res.already
        ? `[auto-move] ${res.oldLabel} was already under ${res.target}; nothing to move.`
        : `[auto-move] ${res.oldLabel} → ${res.target}, now listed as "${res.newLabel}" (live at once; a saved pick keeps working).`;
      try {
        await post("/librechat/feedback-status", { id: row._id, status: "resolved", note });
        n++;
        log(`[voice-moves] ${res.already ? "confirmed" : "moved"} ${res.oldLabel} -> ${res.target}${res.already ? "" : ` as ${res.newLabel}`} (row ${row._id})`);
      } catch (e) {
        warn(`[voice-moves] moved ${res.oldLabel} but could not close row ${row._id}: ${e.message}`);
      }
    }
    return n;
  }

  return { replayResolved, sweepOpen };
}

function start(opts) {
  if (process.env.VOICE_AUTO_MOVE === "0") { console.log("[voice-moves] off (VOICE_AUTO_MOVE=0)"); return null; }
  if (!opts.secret) { console.log("[voice-moves] off (LIBRECHAT_PROXY_SECRET not set)"); return null; }
  const runner = makeRunner(opts);
  const every = Math.max(60_000, Number(process.env.VOICE_AUTO_MOVE_MS || 300_000));
  let busy = false;
  const tick = async (first) => {
    if (busy) return;
    busy = true;
    try {
      if (first) { const n = await runner.replayResolved(); if (n) console.log(`[voice-moves] boot: ${n} earlier move(s) re-applied from the board`); }
      const n = await runner.sweepOpen();
      if (n) console.log(`[voice-moves] ${n} report(s) applied`);
    } catch (e) {
      console.warn(`[voice-moves] sweep skipped: ${e.message}`);
    } finally { busy = false; }
  };
  setTimeout(() => tick(true), 15_000);
  const timer = setInterval(() => tick(false), every);
  if (timer.unref) timer.unref();
  console.log(`[voice-moves] on: replay at boot, sweep every ${Math.round(every / 60000)} min`);
  return { tick, runner };
}

module.exports = { parseReport, targetFor, relabel, applyMove, applyReport, makeRunner, start, SUBJECT_RE };
