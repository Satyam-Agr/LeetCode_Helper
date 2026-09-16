const crypto = require("crypto");
const http = require("http");

const { createPushQueue } = require("./pushQueue");
const {
  BRIDGE_PROTOCOL_VERSION,
  HEADER_PROTOCOL,
  HEADER_TOKEN,
  EXPECTED_CHROME_EXTENSION_ORIGIN,
  CAPABILITIES,
} = require("./protocol");

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_BIND_RETRY_MS = 5000;
const DEFAULT_GENERATION_RETENTION_MS = 60000;

// Thin HTTP layer: routing, CORS, JSON body parsing, bridge recovery, and
// generation request idempotency. File logic remains in generateFromUrl.
function createBridgeServer({
  port,
  settingsStore,
  generateFromUrl,
  getWorkspaceRoot,
  showResult,
  vscode,
  onBridgeStatusChange,
  log = () => {},
  bindRetryMs = DEFAULT_BIND_RETRY_MS,
  generationRetentionMs = DEFAULT_GENERATION_RETENTION_MS,
  getAuthToken = () => null,
  extensionVersion = "unknown",
  now = () => Date.now(),
}) {
  let server = null;
  let listening = false;
  let bindError = null;
  let retryTimer = null;
  let stopping = false;
  let conflictWarningShown = false;
  const generationRequests = new Map();
  const pushQueue = createPushQueue();
  const activity = {
    startedAt: now(),
    lastRequestAt: null,
    lastAuthorizedRequestAt: null,
    lastChromePollAt: null,
    lastPushResultAt: null,
    lastAutoPairAt: null,
    lastRejectedAt: null,
    lastRejectedCode: null,
  };

  function notifyStatus() {
    try {
      onBridgeStatusChange?.(getStatusInfo());
    } catch {
      // Listener errors must not affect bridge availability.
    }
  }

  function start(showMessage = false) {
    stopping = false;
    clearBindRetry();

    if (server || listening) {
      if (showMessage) {
        vscode.window.showInformationMessage(`LeetCode browser bridge is already running on port ${getBoundPort()}.`);
      }
      return;
    }

    const candidate = http.createServer(handleRequest);
    server = candidate;

    candidate.on("error", (error) => {
      if (server !== candidate) {
        return;
      }

      server = null;
      listening = false;
      bindError = error;
      notifyStatus();
      log("bridge.bind-failed", { port, code: error.code || null, message: error.message });

      if (error.code === "EADDRINUSE") {
        if (!conflictWarningShown) {
          conflictWarningShown = true;
          vscode.window.showWarningMessage(
            `LeetCode bridge port ${port} is already in use by another VS Code window. ` +
              "This window will take over automatically if the current owner closes."
          );
        }
        scheduleBindRetry();
      } else {
        vscode.window.showErrorMessage(`LeetCode browser bridge failed: ${error.message}`);
      }
    });

    candidate.on("close", () => {
      if (server !== candidate) {
        return;
      }
      server = null;
      listening = false;
      notifyStatus();
      if (!stopping) {
        log("bridge.closed-unexpectedly", { port });
        scheduleBindRetry();
      }
    });

    candidate.listen(port, "127.0.0.1", () => {
      if (server !== candidate) {
        return;
      }
      listening = true;
      bindError = null;
      conflictWarningShown = false;
      notifyStatus();
      log("bridge.listening", { port: getBoundPort() });
      if (showMessage) {
        vscode.window.showInformationMessage(`LeetCode browser bridge running on http://127.0.0.1:${getBoundPort()}`);
      }
    });
  }

  function scheduleBindRetry() {
    if (stopping || retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start(false);
    }, bindRetryMs);
    retryTimer.unref?.();
  }

  function clearBindRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function stop() {
    stopping = true;
    clearBindRetry();
    pushQueue.stop();
    listening = false;
    notifyStatus();

    for (const entry of generationRequests.values()) {
      if (entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer);
      }
    }
    generationRequests.clear();

    if (!server) {
      return;
    }
    const current = server;
    server = null;
    current.close();
  }

  function status() {
    if (listening) {
      vscode.window.showInformationMessage(`LeetCode browser bridge is running on http://127.0.0.1:${getBoundPort()}`);
    } else if (bindError?.code === "EADDRINUSE") {
      vscode.window.showWarningMessage(
        `Another VS Code window currently owns LeetCode bridge port ${port}; this window is waiting to take over.`
      );
    } else {
      vscode.window.showWarningMessage("LeetCode browser bridge is not running.");
    }
  }

  function getStatusInfo() {
    return { running: listening, conflict: Boolean(bindError && bindError.code === "EADDRINUSE") };
  }

  function getBoundPort() {
    const address = server?.address?.();
    return address && typeof address === "object" ? address.port : port;
  }

  function getServerWorkspaceRoot() {
    return getWorkspaceRoot();
  }

  function getDiagnostics() {
    return {
      ...getStatusInfo(),
      port: getBoundPort(),
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      extensionVersion,
      authEnabled: Boolean(getAuthToken()),
      activity: { ...activity },
      pushQueue: pushQueue.getStats(),
    };
  }

  function getOrCreateGeneration(body, requestId) {
    const existing = generationRequests.get(requestId);
    if (existing) {
      if (existing.url !== body.url) {
        throw createBridgeError("requestId was already used for a different problem URL.", "request_id_conflict");
      }
      log("bridge.generate-deduplicated", { requestId });
      return { requestId, promise: existing.promise };
    }

    const workspaceRoot = getServerWorkspaceRoot();
    const startedAt = Date.now();
    log("bridge.generate-received", { requestId, url: body.url, workspaceRoot });

    const entry = { url: body.url, promise: null, cleanupTimer: null };
    entry.promise = Promise.resolve()
      .then(() => generateFromUrl(body.url, workspaceRoot, requestId))
      .then((result) => {
        try {
          showResult(result);
        } catch (error) {
          log("bridge.result-message-failed", { requestId, message: error.message });
        }
        log("bridge.generate-complete", {
          requestId,
          status: result.status,
          durationMs: Date.now() - startedAt,
        });
        return result;
      })
      .catch((error) => {
        log("bridge.generate-failed", {
          requestId,
          code: error.code || "generation_failed",
          message: error.message,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      });

    generationRequests.set(requestId, entry);
    entry.promise.then(
      () => scheduleGenerationCleanup(requestId, entry),
      () => scheduleGenerationCleanup(requestId, entry)
    );
    return { requestId, promise: entry.promise };
  }

  function scheduleGenerationCleanup(requestId, entry) {
    entry.cleanupTimer = setTimeout(() => {
      if (generationRequests.get(requestId) === entry) {
        generationRequests.delete(requestId);
      }
    }, generationRetentionMs);
    entry.cleanupTimer.unref?.();
  }

  async function handleRequest(request, response) {
    setCorsHeaders(request, response);
    activity.lastRequestAt = now();

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    let requestId = null;
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "leetcode-helper-vscode",
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          extensionVersion,
          capabilities: CAPABILITIES,
          authRequired: Boolean(getAuthToken()),
          authenticated: isAuthorized(request),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/pair") {
        authorizeProtocol(request);
        authorizeChromeOrigin(request, true);
        const token = getAuthToken();
        if (!token) {
          throw createBridgeError(
            "The VS Code bridge authentication token is unavailable.",
            "pairing_unavailable",
            true,
            503
          );
        }
        activity.lastAutoPairAt = now();
        sendJson(response, 200, {
          ok: true,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          token,
        });
        return;
      }

      authorizeRequest(request);
      activity.lastAuthorizedRequestAt = now();

      if (request.method === "POST" && url.pathname === "/generate") {
        const body = await readJsonBody(request);
        validateGenerateBody(body);
        requestId = normalizeRequestId(body.requestId);
        const generation = getOrCreateGeneration(body, requestId);
        const result = await generation.promise;
        sendJson(response, 200, { ok: true, requestId, ...result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/pull") {
        activity.lastChromePollAt = now();
        pushQueue.handlePull(
          (payload) => sendJson(response, 200, payload),
          // The request stream can close as soon as its GET body is consumed,
          // while the response is intentionally held open for long-polling.
          // Track the response socket instead so a live waiter is not discarded.
          (cleanup) => response.on("close", cleanup)
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/push-result") {
        const body = await readJsonBody(request);
        activity.lastPushResultAt = now();
        pushQueue.handleResult(body);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/settings") {
        sendJson(response, 200, { ok: true, settings: settingsStore.getSettings() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/settings") {
        const body = await readJsonBody(request);
        const settings = await settingsStore.saveSettings(body);
        sendJson(response, 200, { ok: true, settings });
        return;
      }

      if (request.method === "POST" && url.pathname === "/choose-destination") {
        const selection = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Select folder",
        });

        if (!selection?.[0]) {
          throw createBridgeError("No folder selected.", "folder_not_selected");
        }

        sendJson(response, 200, { ok: true, path: selection[0].fsPath });
        return;
      }

      sendJson(response, 404, {
        ok: false,
        code: "unknown_endpoint",
        error: "Unknown endpoint.",
        retryable: false,
      });
    } catch (error) {
      if (["pairing_required", "protocol_mismatch", "origin_rejected"].includes(error?.code)) {
        activity.lastRejectedAt = now();
        activity.lastRejectedCode = error.code;
      }
      sendBridgeError(response, error, requestId);
    }
  }

  function isAuthorized(request) {
    const expected = getAuthToken();
    if (!expected) {
      return true;
    }
    const actual = String(request.headers[HEADER_TOKEN] || "");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  function authorizeRequest(request) {
    authorizeProtocol(request);
    authorizeChromeOrigin(request, false);
    if (!isAuthorized(request)) {
      throw createBridgeError(
        "Chrome authentication expired. The extension will pair with VS Code again automatically.",
        "pairing_required",
        false,
        401
      );
    }
  }

  function authorizeProtocol(request) {
    const expectedProtocol = String(BRIDGE_PROTOCOL_VERSION);
    const actualProtocol = String(request.headers[HEADER_PROTOCOL] || "");
    if (actualProtocol !== expectedProtocol) {
      throw createBridgeError(
        `Chrome/VS Code protocol mismatch. VS Code expects protocol ${expectedProtocol}; Chrome sent ${actualProtocol || "none"}.`,
        "protocol_mismatch",
        false,
        426
      );
    }
  }

  function authorizeChromeOrigin(request, required) {
    const origin = String(request.headers.origin || "");
    if ((required && origin !== EXPECTED_CHROME_EXTENSION_ORIGIN) ||
        (!required && origin && origin !== EXPECTED_CHROME_EXTENSION_ORIGIN)) {
      throw createBridgeError(
        "This bridge accepts automatic browser pairing only from the LeetCode Helper Chrome extension.",
        "origin_rejected",
        false,
        403
      );
    }
  }

  return {
    start,
    stop,
    status,
    getWorkspaceRoot: getServerWorkspaceRoot,
    getBoundPort,
    pushCode: pushQueue.pushCode,
    getStatusInfo,
    getDiagnostics,
  };
}

function validateGenerateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createBridgeError("Request body must be an object.", "invalid_request");
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    throw createBridgeError("A LeetCode problem URL is required.", "invalid_request");
  }
  if (body.requestId != null && (typeof body.requestId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId))) {
    throw createBridgeError("requestId must be a short identifier.", "invalid_request");
  }
}

function normalizeRequestId(requestId) {
  return requestId || `legacy-${crypto.randomUUID()}`;
}

function createBridgeError(message, code, retryable = false, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.httpStatus = httpStatus;
  return error;
}

function sendBridgeError(response, error, requestId) {
  const code = error?.code || "generation_failed";
  const retryable = Boolean(error?.retryable);
  let statusCode = error?.httpStatus || 500;

  if (
    code === "invalid_request" ||
    code === "invalid_problem_url" ||
    code === "problem_not_found" ||
    code === "request_id_conflict" ||
    code === "folder_not_selected"
  ) {
    statusCode = 400;
  } else if (!error?.httpStatus && retryable) {
    statusCode = 502;
  }

  sendJson(response, statusCode, {
    ok: false,
    requestId,
    code,
    error: error?.message || "VS Code helper request failed.",
    retryable,
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers["content-type"] || "");
    if (!contentType.includes("application/json")) {
      reject(createBridgeError("Request content type must be application/json.", "invalid_request"));
      request.resume();
      return;
    }

    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(createBridgeError("Request body is too large.", "invalid_request"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(createBridgeError("Request body must be valid JSON.", "invalid_request"));
      }
    });
    request.on("error", () => reject(createBridgeError("Could not read request body.", "invalid_request")));
  });
}

function sendJson(response, statusCode, body) {
  if (response.destroyed || response.writableEnded) {
    return false;
  }
  try {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
    return true;
  } catch {
    return false;
  }
}

function setCorsHeaders(request, response) {
  const origin = String(request.headers.origin || "");
  if (origin === EXPECTED_CHROME_EXTENSION_ORIGIN) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Headers",
      `Content-Type, ${HEADER_PROTOCOL}, ${HEADER_TOKEN}`
    );
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

module.exports = { createBridgeServer };
