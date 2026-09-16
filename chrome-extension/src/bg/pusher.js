// Delivers a single push to exactly one LeetCode tab:
//   - If the problem is already open, focus that tab and paste.
//   - Otherwise open the problem in a NEW active tab, tell the bridge we are
//     "opening" (so it waits longer), wait for Monaco to load, then paste.
//
// For a Submit action we also read LeetCode's verdict (Accepted / Wrong Answer / …)
// after clicking, reporting "judging" first (so the bridge extends its window and the
// sidebar shows "waiting for the verdict") and then the final verdict.

import { normalizeProblemUrl } from "../leetcodeUrl.js";
import { reportPushResult } from "../http.js";
import { pasteIntoMonaco, monacoReadyProbe, readVerdict } from "./inject.js";

const OPEN_LOAD_TIMEOUT_MS = 45000; // fresh tabs can be slow; the bridge is told we're opening
const EXISTING_LOAD_TIMEOUT_MS = 12000; // an existing tab may still be navigating/remounting
const VERDICT_TIMEOUT_MS = 30000; // how long we poll for a Submit verdict
const READY_POLL_MS = 250;
const VERDICT_POLL_MS = 800;
const PASTE_RETRY_DELAYS_MS = [0, 250, 750];
const TAB_QUERY = ["https://leetcode.com/problems/*", "https://www.leetcode.com/problems/*"];

export async function handlePush(push) {
  // Acknowledge transport receipt before touching the page. If this cannot reach
  // VS Code, abort so the server can safely redeliver the same job.
  await reportPushResult({ id: push.id, received: true });

  try {
    await processPush(push);
  } catch (error) {
    // Convert unexpected Chrome API/orchestration errors into a final result. The
    // editor scraping/injection implementation remains isolated in inject.js.
    await reportPushResult({
      id: push.id,
      ok: false,
      error: `Browser communication failed: ${describe(error)}`,
    });
  }
}

async function processPush(push) {
  const target = normalizeProblemUrl(push.url);
  if (!target) {
    await reportPushResult({ id: push.id, ok: false, error: "Invalid LeetCode problem URL." });
    return;
  }

  const tabs = await chrome.tabs.query({ url: TAB_QUERY });
  const match = tabs
    .filter((tab) => tab.id != null && normalizeProblemUrl(tab.url) === target)
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (match) {
    await activateTab(match);
    const ready = await waitForMonaco(match.id, EXISTING_LOAD_TIMEOUT_MS);
    if (!ready) {
      await reportPushResult({
        id: push.id,
        ok: false,
        error: "The LeetCode tab is open, but its visible code editor did not become ready.",
      });
      return;
    }
    let baseline = push.submitAction === "submit" ? await readVerdictInTab(match.id, "submit") : null;
    baseline = push.submitAction === "run" ? await readVerdictInTab(match.id, "run") : null;
    const outcome = await pasteInTab(match.id, push);
    await completeReport(push, match.id, match.url || push.url, outcome, baseline);
    return;
  }

  // Not open — open it, and let the bridge know loading may take a while.
  await reportPushResult({ id: push.id, opening: true, url: push.url });

  let tab;
  try {
    tab = await chrome.tabs.create({ url: push.url, active: true });
  } catch (error) {
    await reportPushResult({ id: push.id, ok: false, error: `Could not open a new tab: ${describe(error)}` });
    return;
  }

  try {
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // focusing is best-effort
  }

  const ready = await waitForMonaco(tab.id, OPEN_LOAD_TIMEOUT_MS);
  if (!ready) {
    await reportPushResult({
      id: push.id,
      ok: false,
      error: "The problem page took too long to load. Please try again.",
    });
    return;
  }

  const outcome = await pasteInTab(tab.id, push);
  await completeReport(push, tab.id, push.url, outcome, null);
}

// Report the result; for a successful Submit, wait for and attach the verdict.
async function completeReport(push, tabId, url, outcome, baseline) {
  const base = {
    id: push.id,
    url,
    action: push.submitAction || "none",
    verified: Boolean(outcome.verified),
    actionError: outcome.actionError || null,
  };

  if (!outcome.ok) {
    await reportPushResult({
      ...base,
      ok: false,
      code: outcome.code || "page_update_failed",
      retryable: Boolean(outcome.retryable),
      expectedLanguage: outcome.expectedLanguage || null,
      actualLanguage: outcome.actualLanguage || null,
      error: outcome.error,
    });
    return;
  }

  if ((push.submitAction === "submit" || push.submitAction === "run") && outcome.submitted) {
    await reportPushResult({ id: push.id, judging: true, url });
    const verdict = await waitForVerdict(tabId, VERDICT_TIMEOUT_MS, baseline, push.submitAction);
    await reportPushResult({ ...base, ok: true, submitted: true, verdict: verdict || null });
    return;
  }

  await reportPushResult({ ...base, ok: true, submitted: Boolean(outcome.submitted) });
}

async function activateTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // best-effort
  }
}

async function waitForMonaco(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: monacoReadyProbe,
      });
      if (result && result.result) {
        return true;
      }
    } catch {
      // tab may not be ready to inject yet
    }
    await sleep(READY_POLL_MS);
  }
  return false;
}

// Poll for the submission verdict; resolves when a verdict appears that differs from
// the baseline (a prior submission's result). Returns the last seen verdict on timeout.
async function waitForVerdict(tabId, timeoutMs, baseline, action) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let last = null;
  let sawClearedResult = false;
  while (Date.now() < deadline) {
    const verdict = await readVerdictInTab(tabId, action);
    if (verdict) {
      last = verdict;
      // A new action often clears/replaces the old result before showing the next
      // one. Accept the same verdict after that transition too (e.g. Accepted twice).
      // Some UI variants replace it too quickly to observe the gap, so use a short
      // grace period instead of waiting the full timeout for identical verdict text.
      if (verdict !== baseline || sawClearedResult || Date.now() - startedAt >= 4000) {
        return verdict;
      }
    } else {
      sawClearedResult = true;
    }
    await sleep(VERDICT_POLL_MS);
  }
  return last;
}

async function readVerdictInTab(tabId, action) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readVerdict,
      args: [action],
    });
    return result && result.result ? result.result : null;
  } catch {
    return null;
  }
}

async function pasteInTab(tabId, push) {
  let lastOutcome = null;

  for (const delayMs of PASTE_RETRY_DELAYS_MS) {
    if (delayMs) {
      await sleep(delayMs);
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: pasteIntoMonaco,
        args: [push.code, push.submitAction || "none", push.language || null],
      });
      const outcome = result?.result || {
        ok: false,
        retryable: true,
        error: "The page returned no editor result.",
      };
      lastOutcome = outcome;
      if (outcome.ok || !outcome.retryable) {
        return outcome;
      }
    } catch (error) {
      lastOutcome = {
        ok: false,
        retryable: true,
        error: describe(error) || "Failed to inject into the LeetCode tab.",
      };
    }
  }

  return lastOutcome || {
    ok: false,
    retryable: false,
    error: "Could not paste into the LeetCode editor.",
  };
}

function describe(error) {
  return error && error.message ? error.message : "unknown error";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
