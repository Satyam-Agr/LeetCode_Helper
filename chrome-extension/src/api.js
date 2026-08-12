import { PORT } from "./config.js";

const BASE_URL = `http://127.0.0.1:${PORT}`;

export async function generateFile(url) {
  return request("/generate", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function getSettings() {
  const payload = await request("/settings");
  return payload.settings;
}

export async function saveSettings(settings) {
  const payload = await request("/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
  return payload.settings;
}

export async function chooseDestinationFolder() {
  const payload = await request("/choose-destination", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return payload.path;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
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
