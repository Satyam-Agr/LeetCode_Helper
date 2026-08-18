/*
 * Background service worker entry for the reverse (VS Code -> LeetCode) push flow.
 *
 * TRANSPORT: HTTP long-polling, NOT WebSocket. An insecure ws:// from the HTTPS
 * LeetCode page is blocked by mixed-content, and the local bridge only speaks plain
 * HTTP on loopback, so all traffic runs from the extension's own context (this
 * worker), the same transport the popup uses.
 *
 * KEEP-ALIVE: MV3 workers are ephemeral, so we re-kick the poll loop on install,
 * on browser startup, on load, and every minute via chrome.alarms.
 */

import { pollLoop } from "./bg/poller.js";

const KEEPALIVE_ALARM = "leetcode-pull-keepalive";

let polling = false;

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
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  startPolling();
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
