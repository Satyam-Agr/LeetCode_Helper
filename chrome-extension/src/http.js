import { PORT } from "./config.js";

const BASE_URL = `http://127.0.0.1:${PORT}`;

// --- Popup / options client (throws friendly errors) ---

export async function generateFile(url) {
  return request("/generate", { method: "POST", body: JSON.stringify({ url }) });
}

export async function getSettings() {
  const payload = await request("/settings");
  return payload.settings;
}

export async function saveSettings(settings) {
  const payload = await request("/settings", { method: "POST", body: JSON.stringify(settings) });
  return payload.settings;
}

export async function chooseFolder() {
  const payload = await request("/choose-destination", { method: "POST", body: JSON.stringify({}) });
  return payload.path;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("VS Code helper is not running. Open VS Code with your workspace first.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("VS Code helper returned an invalid response.");
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "VS Code helper request failed.");
  }
  return payload;
}

// --- Background worker client (raw; the poller handles errors) ---

export async function pull() {
  const response = await fetch(`${BASE_URL}/pull`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  return response.json();
}

export async function reportPushResult(result) {
  try {
    await fetch(`${BASE_URL}/push-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch {
    // The bridge may have gone away; nothing else to do.
  }
}
