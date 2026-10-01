"use strict";

function exactInstant(value) {
  if (typeof value !== "string") return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return NaN;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const civil = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return NaN;
  if (parts[7] !== "Z" && (Number(parts[7].slice(1, 3)) > 23 || Number(parts[7].slice(4)) > 59)) return NaN;
  return Date.parse(value);
}

function accountingPath(query) {
  const from = exactInstant(query.from);
  const to = exactInstant(query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 32 * 86400000) {
    const error = new Error("A valid explicit accounting window of at most 32 days is required.");
    error.status = 400;
    throw error;
  }
  const params = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  return `/api/kade/monthly-books?${params}`;
}

function attachMonthlyBooks(router, { auth, lc }) {
  router.get("/librechat/monthly-books", auth, async (req, res) => {
    try {
      res.json(await lc("GET", accountingPath(req.query)));
    } catch (error) {
      res.status(error.status || 503).json({ error: "Monthly accounting is unavailable.", detail: error.status === 400 ? error.message : undefined });
    }
  });
}

module.exports = { accountingPath, attachMonthlyBooks };
