"use strict";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Never retry mutations: a timeout can mean Railway applied the operation
// but its response was lost. The caller must inspect deployment state first.
async function railwayQuery(token, query, variables = {}, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      // Upstream text can contain submitted variables. Do not echo it.
      if (response.body) await response.body.cancel();
      throw new Error(`Railway API returned HTTP ${response.status}. Operation outcome may be unknown; check current state before retrying.`);
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("Railway API returned an unreadable response. Check current state before retrying.");
    }
    if (data?.errors?.length) {
      throw new Error("Railway API rejected the request. Check access and identifiers, then inspect current state before retrying.");
    }
    if (!data || typeof data.data !== "object" || data.data === null) {
      throw new Error("Railway API returned no result. Check current state before retrying.");
    }
    return data.data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Railway API timed out. Operation outcome is unknown; check current state before retrying.");
    }
    if (error instanceof TypeError) {
      throw new Error("Railway API could not be reached. Check current state before retrying.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { railwayQuery };
