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
const VERDICT_TIMEOUT_MS = 30000; // how long we poll for a Submit verdict
const READY_POLL_MS = 700;
const VERDICT_POLL_MS = 800;
const TAB_QUERY = ["https://leetcode.com/problems/*", "https://www.leetcode.com/problems/*"];

export async function handlePush(push) {
  const target = normalizeProblemUrl(push.url);
  if (!target) {
    await reportPushResult({ id: push.id, ok: false, error: "Invalid LeetCode problem URL." });
    return;
  }

  const tabs = await chrome.tabs.query({ url: TAB_QUERY });
  const match = tabs.find((tab) => normalizeProblemUrl(tab.url) === target);

  if (match) {
    await activateTab(match);
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
  const base = { id: push.id, url, action: push.submitAction || "none" };

  if (!outcome.ok) {
    await reportPushResult({ ...base, ok: false, error: outcome.error });
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
  let last = null;
  while (Date.now() < deadline) {
    const verdict = await readVerdictInTab(tabId, action);
    if (verdict) {
      last = verdict;
      if (verdict !== baseline) {
        return verdict;
      }
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
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pasteIntoMonaco,
      args: [push.code, push.submitAction || "none"],
    });
    const outcome = result && result.result ? result.result : { ok: false, error: "No result from the page." };
    if (outcome.ok) {
      return { ok: true, submitted: Boolean(outcome.submitted) };
    }
    return { ok: false, error: outcome.error || "Could not paste into the LeetCode editor." };
  } catch (error) {
    return { ok: false, error: describe(error) || "Failed to inject into the LeetCode tab." };
  }
}

function describe(error) {
  return error && error.message ? error.message : "unknown error";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
