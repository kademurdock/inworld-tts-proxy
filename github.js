// ---- Forge's GitHub write/read routes ----
// Mounted on the inworld-tts-proxy service. Gives the private "Forge" agent
// real, low-risk-of-corruption GitHub commit power via an Action.
//
// WHY THIS EXISTS (the base64 trap): GitHub's Contents API requires new file
// content to be submitted base64-encoded. An LLM hand-typing a base64 string
// in a tool call is a real corruption risk on anything but tiny files. This
// proxy takes RAW, PLAIN TEXT from Forge and encodes it server-side in real
// Node.js (Buffer.from(...).toString("base64")), which is byte-perfect every
// time -- Forge never has to think about base64 at all.
//
// It also auto-fetches the file's current `sha` before committing (GitHub
// requires the existing blob sha to authorize an overwrite), so Forge doesn't
// have to do a separate "get the sha first" round trip either -- one call in,
// one commit out. If the file doesn't exist yet, it just creates it (no sha
// needed for a brand-new file).
//
// SECURITY MODEL (same pattern as railway.js):
//  - The real GitHub PAT lives ONLY here as env GITHUB_PAT (never handed to
//    the agent, never in any prompt/instructions).
//  - Every route requires Authorization: Bearer <GITHUB_PROXY_SECRET>, so the
//    public URL can't be abused even though it's reachable.
//  - Oct 16 2026 (Kade: "Approve, then he ships"): a commit to a LIVE branch
//    (approvals.js PROTECTED_DEFAULT: the branch each service deploys from) and
//    every merge wait for her yes. Everything else (reading, branches, commits
//    to working branches, pull requests) runs at once. FORGE_APPROVALS=0 turns
//    the gate off.
//
// THE DEVELOPER LOOP (Oct 16 2026), what Claude Code and Codex do from a phone:
//   1. POST /github/branch       make a working branch off the live one
//   2. POST /github/edit         find-and-replace one exact passage (no whole-file rewrite)
//      POST /github/commit-files several files in ONE commit
//   3. POST /github/pr           open a pull request; answers with a spoken diff summary
//   4. GET  /github/pr           where it stands: files, checks, mergeable
//   5. POST /github/merge        asks Kade; on her yes it merges, and the deploy is watched
//                                until it is live (or fails) and she hears which.

const express = require("express");
const router = express.Router();
const { requestApproval, registerExecutor, isProtected, watchDeploy } = require("./approvals");

const PAT = process.env.GITHUB_PAT;
const SECRET = process.env.GITHUB_PROXY_SECRET;
const UA = "KadeAI-Forge-Agent";

function auth(req, res, next) {
  const h = req.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!SECRET || tok !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!PAT) return res.status(500).json({ error: "GITHUB_PAT not set" });
  next();
}

async function ghFetch(path, opts) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
      ...(opts && opts.headers),
    },
  });
  return r;
}

async function gh(path, opts) {
  const r = await ghFetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.message || `GitHub said ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const enc = (p) => String(p).split("/").map(encodeURIComponent).join("/");

/* ---------- reading ---------- */

// GET /github/file?owner=&repo=&path=&branch= -> raw decoded text content + sha
// Lets Forge read a file before deciding what to change.
router.get("/github/file", auth, async (req, res) => {
  const { owner, repo, path, branch } = req.query;
  if (!owner || !repo || !path) {
    return res.status(400).json({ error: "owner, repo, and path are required" });
  }
  try {
    const qs = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const r = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${qs}`);
    if (r.status === 404) {
      return res.json({ exists: false });
    }
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.message || "GitHub API error" });
    }
    const content = Buffer.from(data.content, "base64").toString("utf8");
    res.json({ exists: true, sha: data.sha, path: data.path, content });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------- the single-file commit (kept; now gated on live branches) ---------- */

async function commitOne({ owner, repo, path, content, message, branch }) {
  const qs = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const getRes = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${qs}`);
  let sha;
  if (getRes.status === 200) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    const errData = await getRes.json().catch(() => ({}));
    throw new Error(`Failed checking existing file: ${errData.message || getRes.status}`);
  }
  const body = { message, content: Buffer.from(content, "utf8").toString("base64") };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;
  const putData = await gh(`/repos/${owner}/${repo}/contents/${path}`, json(body, "PUT"));
  return { success: true, created: !sha, commitUrl: putData.commit && putData.commit.html_url, commitSha: putData.commit && putData.commit.sha };
}
registerExecutor("github-commit", (p) => commitOne(p));

async function defaultBranch(owner, repo) {
  return (await gh(`/repos/${owner}/${repo}`)).default_branch;
}

// POST /github/commit -> create or update a file with RAW plain text content.
// Body: { owner, repo, path, content, message, branch? }
// "content" must be the raw, unencoded file text -- do NOT base64 it yourself.
router.post("/github/commit", auth, async (req, res) => {
  const { owner, repo, path, content, message, branch } = req.body || {};
  if (!owner || !repo || !path || content === undefined || !message) {
    return res.status(400).json({
      error: "owner, repo, path, content, and message are all required",
    });
  }
  try {
    const target = branch || (await defaultBranch(owner, repo));
    if (isProtected(owner, repo, target)) {
      return res.json(
        await requestApproval({
          kind: "github-commit",
          params: { owner, repo, path, content, message, branch: target },
          summary: `Commit one file straight to the live branch ${target} of ${repo}: ${path}. "${String(message).split("\n")[0].slice(0, 160)}". It deploys as soon as it lands.`,
          revert: `Revert the commit on ${repo} ${target}.`,
        }),
      );
    }
    res.json(await commitOne({ owner, repo, path, content, message, branch: target }));
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: "GitHub commit failed", details: e.message });
  }
});

/* ---------- branches ---------- */

// POST /github/branch { owner, repo, branch, from? } -> a working branch off `from` (default branch by default)
router.post("/github/branch", auth, async (req, res) => {
  const { owner, repo, branch, from } = req.body || {};
  if (!owner || !repo || !branch) return res.status(400).json({ error: "owner, repo and branch are required" });
  if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch) || branch.includes("..")) return res.status(400).json({ error: "that is not a usable branch name" });
  try {
    const base = from || (await defaultBranch(owner, repo));
    const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${enc(base)}`);
    await gh(`/repos/${owner}/${repo}/git/refs`, json({ ref: `refs/heads/${branch}`, sha: ref.object.sha }));
    res.json({ created: true, branch, from: base, sha: ref.object.sha });
  } catch (e) {
    if (e.status === 422) return res.json({ created: false, branch, note: "that branch already exists; commit to it" });
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

/* ---------- several files, one commit (git data API) ---------- */

async function commitFiles({ owner, repo, branch, message, files }) {
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${enc(branch)}`);
  const parent = await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    if (f.delete === true) {
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
    } else {
      const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, json({ content: Buffer.from(String(f.content), "utf8").toString("base64"), encoding: "base64" }));
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }
  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, json({ base_tree: parent.tree.sha, tree }));
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, json({ message, tree: newTree.sha, parents: [ref.object.sha] }));
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${enc(branch)}`, json({ sha: commit.sha, force: false }, "PATCH"));
  return { success: true, commitSha: commit.sha, files: files.length, branch };
}
registerExecutor("github-commit-files", (p) => commitFiles(p));

function checkFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 40) return "files must be a list of 1 to 40 {path, content} (or {path, delete:true})";
  for (const f of files) {
    if (!f || typeof f.path !== "string" || !f.path || f.path.startsWith("/") || f.path.includes("..")) return "every file needs a relative path";
    if (f.delete !== true && typeof f.content !== "string") return `${f.path} needs content (plain text) or delete:true`;
  }
  return null;
}

// POST /github/commit-files { owner, repo, branch, message, files: [{path, content} | {path, delete:true}] }
router.post("/github/commit-files", auth, async (req, res) => {
  const { owner, repo, branch, message, files } = req.body || {};
  if (!owner || !repo || !branch || !message) return res.status(400).json({ error: "owner, repo, branch, message and files are required" });
  const bad = checkFiles(files);
  if (bad) return res.status(400).json({ error: bad });
  try {
    if (isProtected(owner, repo, branch)) {
      return res.json(
        await requestApproval({
          kind: "github-commit-files",
          params: { owner, repo, branch, message, files },
          summary: `Commit ${files.length} file${files.length === 1 ? "" : "s"} straight to the live branch ${branch} of ${repo}: ${files.map((f) => f.path).slice(0, 6).join(", ")}${files.length > 6 ? ", and more" : ""}. "${String(message).split("\n")[0].slice(0, 140)}". It deploys as soon as it lands.`,
          revert: `Revert the commit on ${repo} ${branch}.`,
        }),
      );
    }
    res.json(await commitFiles({ owner, repo, branch, message, files }));
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

/* ---------- find-and-replace edit, one exact passage ---------- */

// POST /github/edit { owner, repo, branch, path, find, replace, message }
// The passage must appear EXACTLY once, so an edit can never land in the wrong place.
router.post("/github/edit", auth, async (req, res) => {
  const { owner, repo, branch, path, find, replace, message } = req.body || {};
  if (!owner || !repo || !branch || !path || typeof find !== "string" || typeof replace !== "string" || !message) {
    return res.status(400).json({ error: "owner, repo, branch, path, find, replace and message are required" });
  }
  if (find.length < 3) return res.status(400).json({ error: "find must be at least 3 characters" });
  try {
    const file = await gh(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const count = text.split(find).length - 1;
    if (count !== 1) {
      return res.status(409).json({ error: count === 0 ? "that passage is not in the file (check spacing and line breaks)" : `that passage appears ${count} times; include more surrounding lines so it is unique` });
    }
    const next = text.replace(find, () => replace);
    if (isProtected(owner, repo, branch)) {
      return res.json(
        await requestApproval({
          kind: "github-commit",
          params: { owner, repo, path, content: next, message, branch },
          summary: `Edit ${path} straight on the live branch ${branch} of ${repo}: "${String(message).split("\n")[0].slice(0, 160)}". It deploys as soon as it lands.`,
          revert: `Revert the commit on ${repo} ${branch}.`,
        }),
      );
    }
    res.json(await commitOne({ owner, repo, path, content: next, message, branch }));
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

/* ---------- pull requests ---------- */

function spokenFiles(files) {
  const adds = files.reduce((n, f) => n + (f.additions || 0), 0);
  const dels = files.reduce((n, f) => n + (f.deletions || 0), 0);
  const names = files.slice(0, 8).map((f) => `${f.filename} (${f.status}, +${f.additions} −${f.deletions})`);
  return `${files.length} file${files.length === 1 ? "" : "s"} changed, ${adds} lines added and ${dels} removed: ${names.join("; ")}${files.length > 8 ? "; and more" : ""}.`;
}

// POST /github/pr { owner, repo, head, base?, title, body? } -> opens a pull request with a spoken summary
router.post("/github/pr", auth, async (req, res) => {
  const { owner, repo, head, base, title, body } = req.body || {};
  if (!owner || !repo || !head || !title) return res.status(400).json({ error: "owner, repo, head and title are required" });
  try {
    const into = base || (await defaultBranch(owner, repo));
    const pr = await gh(`/repos/${owner}/${repo}/pulls`, json({ title, head, base: into, body: body || "" }));
    const files = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`);
    res.json({ number: pr.number, url: pr.html_url, base: into, head, spoken: `Pull request ${pr.number} into ${into}: ${spokenFiles(files)}` });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

// GET /github/pr?owner=&repo=&number= -> state, mergeable, checks, files (spoken)
router.get("/github/pr", auth, async (req, res) => {
  const { owner, repo, number } = req.query;
  if (!owner || !repo || !number) return res.status(400).json({ error: "owner, repo and number are required" });
  try {
    const pr = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}`);
    const files = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}/files?per_page=100`);
    let checks = "no checks reported";
    try {
      const runs = await gh(`/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=50`);
      const list = runs.check_runs || [];
      if (list.length) {
        const pending = list.filter((c) => c.status !== "completed").length;
        const failed = list.filter((c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
        checks = pending
          ? `${pending} of ${list.length} checks still running`
          : failed.length
            ? `${failed.length} of ${list.length} checks failed: ${failed.map((c) => c.name).slice(0, 4).join(", ")}`
            : `all ${list.length} checks passed`;
      }
    } catch (_) {}
    res.json({
      number: pr.number,
      state: pr.merged ? "merged" : pr.state,
      mergeable: pr.mergeable,
      head: pr.head.ref,
      base: pr.base.ref,
      headSha: pr.head.sha,
      url: pr.html_url,
      spoken: `Pull request ${pr.number}, "${pr.title}", is ${pr.merged ? "merged" : pr.state}${pr.mergeable === false ? " and has conflicts" : ""}. ${checks}. ${spokenFiles(files)}`,
    });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

async function mergePr({ owner, repo, number, method }, { approvalId } = {}) {
  const pr = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}`);
  const out = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}/merge`, json({ merge_method: method || "squash" }, "PUT"));
  if (approvalId && isProtected(owner, repo, pr.base.ref)) {
    watchDeploy({ approvalId, owner, repo, commitSha: out.sha });
  }
  return { merged: out.merged === true, sha: out.sha, base: pr.base.ref, watchingDeploy: Boolean(approvalId && isProtected(owner, repo, pr.base.ref)) };
}
registerExecutor("github-merge", (p, ctx) => mergePr(p, ctx));

// POST /github/merge { owner, repo, number, method? } -> always asks Kade first
router.post("/github/merge", auth, async (req, res) => {
  const { owner, repo, number, method } = req.body || {};
  if (!owner || !repo || !number) return res.status(400).json({ error: "owner, repo and number are required" });
  try {
    const pr = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}`);
    if (pr.merged) return res.json({ merged: true, note: "already merged" });
    if (pr.state !== "open") return res.status(409).json({ error: "that pull request is closed" });
    const files = await gh(`/repos/${owner}/${repo}/pulls/${Number(number)}/files?per_page=100`);
    const params = { owner, repo, number: Number(number), method: method || "squash" };
    if (!require("./approvals").approvalsOn()) return res.json(await mergePr(params));
    return res.json(
      await requestApproval({
        kind: "github-merge",
        params,
        summary: `Merge pull request ${pr.number} into ${pr.base.ref} of ${repo}: "${pr.title}". ${spokenFiles(files)}${isProtected(owner, repo, pr.base.ref) ? " It deploys when it lands, and I'll tell you when it's live." : ""}`,
        revert: `Revert the merge commit of pull request ${pr.number} on ${repo} (GitHub's Revert button on the pull request).`,
      }),
    );
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

module.exports = router;
