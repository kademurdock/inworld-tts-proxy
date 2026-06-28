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
//  - This DOES grant write power (it's a real commit-to-repo action) --
//    that's the deliberate point of building it, per Kade's go-ahead. There's
//    no extra confirmation step inside the proxy itself; Forge calling the
//    tool IS the commit. Scope which repos get used by what Forge is told to
//    touch in his instructions, not by anything enforced here.

const express = require("express");
const router = express.Router();

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
    // Step 1: look up the current sha, if the file already exists.
    const qs = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const getRes = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${qs}`);
    let sha;
    if (getRes.status === 200) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      const errData = await getRes.json().catch(() => ({}));
      return res.status(getRes.status).json({
        error: "Failed checking existing file",
        details: errData.message,
      });
    }

    // Step 2: base64-encode server-side (the whole point of this proxy) and PUT.
    const base64Content = Buffer.from(content, "utf8").toString("base64");
    const body = { message, content: base64Content };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;

    const putRes = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const putData = await putRes.json();
    if (!putRes.ok) {
      return res.status(putRes.status).json({
        error: "GitHub commit failed",
        details: putData.message,
      });
    }
    res.json({
      success: true,
      created: !sha,
      commitUrl: putData.commit && putData.commit.html_url,
      commitSha: putData.commit && putData.commit.sha,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
