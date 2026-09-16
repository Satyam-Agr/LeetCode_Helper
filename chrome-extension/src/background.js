/*
 * Background service worker entry for both directions:
 *   - Chrome toolbar -> VS Code generation
 *   - VS Code -> LeetCode push
 *
 * TRANSPORT: HTTP long-polling, NOT WebSocket. An insecure ws:// from the HTTPS
 * LeetCode page is blocked by mixed-content, and the local bridge only speaks plain
 * HTTP on loopback, so all traffic runs from the extension's own context (this
 * worker), including toolbar generation requests.
 *
 * KEEP-ALIVE: MV3 workers are ephemeral, so we re-kick the poll loop on install,
 * on browser startup, on load, and every minute via chrome.alarms.
 */

import { generateFile } from "./http.js";
import { validateLeetCodeProblemUrl } from "./leetcodeUrl.js";
import { createGenerationController } from "./bg/generator.js";
import { pollLoop } from "./bg/poller.js";

const KEEPALIVE_ALARM = "leetcode-pull-keepalive";
const statusClearTimers = new Map();
const generationController = createGenerationController({
  generate: generateFile,
  validateUrl: validateLeetCodeProblemUrl,
  showStatus: showGenerationStatus,
});

let polling = false;

chrome.action.onClicked.addListener(generationController.handleClick);
chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    startPolling();
  }
});

// Kick immediately whenever the worker is (re)loaded.
bootstrap();

function bootstrap() {
  // Clear badges left by an older version of the extension. Status is shown in
  // the page toast and action title instead of covering the extension icon.
  clearLegacyBadges();
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  startPolling();
}

async function clearLegacyBadges() {
  try {
    await chrome.action.setBadgeText({ text: "" });
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => (
      tab.id == null ? null : chrome.action.setBadgeText({ tabId: tab.id, text: "" })
    )));
  } catch {
    // Cleanup is best-effort and only matters when upgrading from an older build.
  }
}

function startPolling() {
  if (polling) {
    return;
  }
  polling = true;
  pollLoop().finally(() => {
    polling = false;
  });
}

async function showGenerationStatus(tabId, state, message) {
  const priorTimer = statusClearTimers.get(tabId);
  if (priorTimer) {
    clearTimeout(priorTimer);
    statusClearTimers.delete(tabId);
  }

  try {
    await chrome.action.setTitle({ tabId, title: `LeetCode Helper: ${message}` });
  } catch {
    // The tab may have closed while the request was running.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: renderGenerationToast,
      args: [state, message],
    });
  } catch {
    // The page may have closed or may no longer allow injection.
  }

  if (state === "success") {
    const timer = setTimeout(() => {
      chrome.action.setTitle({ tabId, title: "Generate LeetCode file" }).catch(() => {});
      statusClearTimers.delete(tabId);
    }, 5000);
    statusClearTimers.set(tabId, timer);
  }
}

// Runs in Chrome's isolated extension world but renders into the page DOM.
function renderGenerationToast(state, message) {
  const hostId = "leetcode-helper-generation-toast";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    host.style.cssText = "all:initial;position:fixed;top:18px;right:18px;z-index:2147483647";
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  if (host.__leetcodeHelperTimer) {
    clearTimeout(host.__leetcodeHelperTimer);
    host.__leetcodeHelperTimer = null;
  }

  const root = host.shadowRoot;
  const accent = state === "busy" ? "#60a5fa" : state === "success" ? "#4ade80" : "#f87171";
  const label = state === "busy" ? "Working" : state === "success" ? "Ready" : "Error";
  root.innerHTML = `
    <style>
      .toast { width: min(360px, calc(100vw - 36px)); box-sizing: border-box; padding: 13px 38px 13px 14px;
        border: 1px solid ${accent}; border-radius: 9px; background: #111827; color: #f9fafb;
        box-shadow: 0 12px 32px rgba(0,0,0,.32); font: 13px/1.45 system-ui, sans-serif; position: relative; }
      .label { color: ${accent}; font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
      .message { margin-top: 4px; overflow-wrap: anywhere; }
      button { position: absolute; top: 7px; right: 8px; border: 0; background: transparent; color: #d1d5db;
        cursor: pointer; font: 20px/1 system-ui, sans-serif; }
    </style>
    <div class="toast" role="status" aria-live="polite">
      <div class="label">${escapeToastText(label)}</div>
      <div class="message">${escapeToastText(message)}</div>
      <button type="button" aria-label="Dismiss">&times;</button>
    </div>`;
  root.querySelector("button").addEventListener("click", () => host.remove(), { once: true });

  if (state === "success") {
    host.__leetcodeHelperTimer = setTimeout(() => host.isConnected && host.remove(), 5000);
  }

  function escapeToastText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
