import { PORT } from "./config.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  HEADER_PROTOCOL,
  HEADER_TOKEN,
  EXPECTED_EXTENSION_ID,
} from "./protocol.js";

const BASE_URL = `http://127.0.0.1:${PORT}`;
const GENERATE_RETRY_DELAYS_MS = [0, 250, 500, 1000, 2000, 2500];
const RESULT_RETRY_DELAYS_MS = [0, 250, 500, 1000, 2000, 4000];
const PULL_TIMEOUT_MS = 30000;
const PAIRING_TOKEN_KEY = "pairingToken";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let pairingPromise = null;

// --- Browser action / options client (throws friendly errors) ---

export async function generateFile(
  url,
  requestId,
  { retryDelaysMs = GENERATE_RETRY_DELAYS_MS, sleepFn = sleep } = {}
) {
  let lastError = null;

  for (const delayMs of retryDelaysMs) {
    if (delayMs) {
      await sleepFn(delayMs);
    }

    try {
      return await request("/generate", {
        method: "POST",
        body: JSON.stringify({ url, requestId }),
      });
    } catch (error) {
      lastError = error;
      if (error.code !== "bridge_unavailable") {
        throw error;
      }
    }
  }

  throw lastError || createClientError(
    "VS Code helper is not running. Open VS Code with your workspace first.",
    "bridge_unavailable",
    true
  );
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
    response = await fetchBridge(path, {
      method: "GET",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    throw createClientError(
      "VS Code helper is not running. Open VS Code with your workspace first.",
      "bridge_unavailable",
      true
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createClientError("VS Code helper returned an invalid response.", "invalid_response", false);
  }

  if (!response.ok || !payload.ok) {
    throw createClientError(
      payload.error || "VS Code helper request failed.",
      payload.code || "request_failed",
      Boolean(payload.retryable)
    );
  }
  return payload;
}

export async function getBridgeHealth({ requireAuthentication = true, fetchFn = fetch } = {}) {
  let payload = await readBridgeHealth(fetchFn);
  if (requireAuthentication && payload.authRequired && !payload.authenticated) {
    await pairWithBridge({ fetchFn });
    payload = await readBridgeHealth(fetchFn);
    if (!payload.authenticated) {
      throw createClientError(
        "Chrome could not establish an authenticated connection with VS Code.",
        "pairing_required",
        false
      );
    }
  }
  return payload;
}

export async function getPairingToken() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return "";
  }
  const stored = await chrome.storage.local.get(PAIRING_TOKEN_KEY);
  const token = typeof stored?.[PAIRING_TOKEN_KEY] === "string"
    ? stored[PAIRING_TOKEN_KEY].trim()
    : "";
  return TOKEN_PATTERN.test(token) ? token : "";
}

export async function savePairingToken(token) {
  const normalized = String(token || "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw createClientError(
      "VS Code returned an invalid automatic pairing token.",
      "invalid_pairing_token",
      false
    );
  }
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw createClientError("Chrome storage is unavailable.", "storage_unavailable", false);
  }
  await chrome.storage.local.set({ [PAIRING_TOKEN_KEY]: normalized });
  return normalized;
}

export async function pairWithBridge({ fetchFn = fetch } = {}) {
  if (pairingPromise) {
    return pairingPromise;
  }
  pairingPromise = performAutomaticPairing(fetchFn).finally(() => {
    pairingPromise = null;
  });
  return pairingPromise;
}

async function performAutomaticPairing(fetchFn) {
  const runtimeId = typeof chrome !== "undefined" ? chrome.runtime?.id : null;
  if (runtimeId && runtimeId !== EXPECTED_EXTENSION_ID) {
    throw createClientError(
      "Chrome loaded this extension with an unexpected identity. Reload it from the current extension folder.",
      "extension_identity_mismatch",
      false
    );
  }

  let response;
  try {
    response = await fetchFn(`${BASE_URL}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [HEADER_PROTOCOL]: String(BRIDGE_PROTOCOL_VERSION),
      },
    });
  } catch {
    throw createClientError(
      "VS Code helper is not running. Open VS Code with your workspace first.",
      "bridge_unavailable",
      true
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw createClientError(
      payload?.error || "VS Code rejected automatic Chrome pairing.",
      payload?.code || "pairing_failed",
      Boolean(payload?.retryable)
    );
  }
  if (payload.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw protocolMismatchError(payload.protocolVersion);
  }
  return savePairingToken(payload.token);
}

async function readBridgeHealth(fetchFn) {
  let response;
  try {
    response = await fetchBridge("/health", { method: "GET" }, { fetchFn, autoPair: false });
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    throw createClientError(
      "VS Code helper is not running. Open VS Code with your workspace first.",
      "bridge_unavailable",
      true
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw createClientError("VS Code helper returned an invalid health response.", "invalid_response", false);
  }
  if (payload.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw protocolMismatchError(payload.protocolVersion);
  }
  return payload;
}

function protocolMismatchError(actualVersion) {
  return createClientError(
    `Chrome/VS Code version mismatch. Chrome uses bridge protocol ${BRIDGE_PROTOCOL_VERSION}; VS Code uses ${actualVersion ?? "unknown"}. Update both extensions together.`,
    "protocol_mismatch",
    false
  );
}

async function getConnectionHeaders() {
  const token = await getPairingToken();
  return {
    [HEADER_PROTOCOL]: String(BRIDGE_PROTOCOL_VERSION),
    ...(token ? { [HEADER_TOKEN]: token } : {}),
  };
}

async function fetchBridge(path, options = {}, { fetchFn = fetch, autoPair = true } = {}) {
  const send = async () => fetchFn(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(await getConnectionHeaders()),
    },
  });

  let response = await send();
  if (autoPair && response.status === 401) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.code === "pairing_required") {
      await pairWithBridge({ fetchFn });
      response = await send();
    }
  }
  return response;
}

function createClientError(message, code, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Background worker client (raw; the poller handles errors) ---

export async function pull({ fetchFn = fetch, timeoutMs = PULL_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchBridge("/pull", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    }, { fetchFn });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw createClientError(
        payload?.error || "VS Code helper rejected the browser poll.",
        payload?.code || "pull_failed",
        true
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function reportPushResult(
  result,
  { retryDelaysMs = RESULT_RETRY_DELAYS_MS, sleepFn = sleep, fetchFn = fetch } = {}
) {
  let lastError = null;

  for (const delayMs of retryDelaysMs) {
    if (delayMs) {
      await sleepFn(delayMs);
    }

    try {
      const response = await fetchBridge("/push-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      }, { fetchFn });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        const error = createClientError(
          payload?.error || "VS Code helper rejected the push result.",
          payload?.code || "result_report_failed",
          response.status >= 500
        );
        if (!error.retryable) {
          throw error;
        }
        lastError = error;
        continue;
      }
      return payload;
    } catch (error) {
      if (error?.retryable === false) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError || createClientError(
    "Could not report the push result to VS Code.",
    "bridge_unavailable",
    true
  );
}
