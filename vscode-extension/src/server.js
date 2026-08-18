const http = require("http");

const { createPushQueue } = require("./pushQueue");

const MAX_BODY_BYTES = 32 * 1024;

// Thin HTTP layer: routing, CORS, JSON body parsing. All push/long-poll state
// lives in pushQueue; all file logic lives in the injected generateFromUrl.
function createBridgeServer({ port, settingsStore, generateFromUrl, getWorkspaceRoot, showResult, vscode, onBridgeStatusChange }) {
  let server = null;
  let workspaceRoot = null;
  let listening = false;
  let bindError = null;
  const pushQueue = createPushQueue();

  function notifyStatus() {
    try {
      onBridgeStatusChange?.(getStatusInfo());
    } catch {
      // ignore listener errors
    }
  }

  function start(showMessage) {
    if (server) {
      if (showMessage) {
        vscode.window.showInformationMessage(`LeetCode browser bridge is already running on port ${port}.`);
      }
      return;
    }

    workspaceRoot = getWorkspaceRoot();
    server = http.createServer(handleRequest);
    server.on("error", (error) => {
      server = null;
      listening = false;
      bindError = error;
      notifyStatus();
      if (error.code === "EADDRINUSE") {
        // Another VS Code window already owns the bridge. This window is a secondary
        // instance and cannot push; the sidebar shows a warning (see getStatusInfo).
        vscode.window.showWarningMessage(
          `LeetCode bridge port ${port} is already in use by another VS Code window. ` +
            `Generate/Push works only from that first window.`
        );
      } else {
        vscode.window.showErrorMessage(`LeetCode browser bridge failed: ${error.message}`);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      listening = true;
      bindError = null;
      notifyStatus();
      if (showMessage) {
        vscode.window.showInformationMessage(`LeetCode browser bridge running on http://127.0.0.1:${port}`);
      }
    });
  }

  function stop() {
    pushQueue.stop();
    listening = false;
    notifyStatus();
    if (!server) {
      return;
    }
    const current = server;
    server = null;
    workspaceRoot = null;
    current.close();
  }

  function status() {
    if (server) {
      vscode.window.showInformationMessage(`LeetCode browser bridge is running on http://127.0.0.1:${port}`);
    } else {
      vscode.window.showWarningMessage("LeetCode browser bridge is not running.");
    }
  }

  // { running, conflict } — conflict === true means another window owns the port.
  function getStatusInfo() {
    return { running: listening, conflict: Boolean(bindError && bindError.code === "EADDRINUSE") };
  }

  function getServerWorkspaceRoot() {
    return workspaceRoot;
  }

  async function handleRequest(request, response) {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);

      if (request.method === "POST" && url.pathname === "/generate") {
        const body = await readJsonBody(request);
        const result = await generateFromUrl(body.url, getServerWorkspaceRoot());
        showResult(result);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/pull") {
        pushQueue.handlePull(
          (payload) => sendJson(response, 200, payload),
          (cleanup) => request.on("close", cleanup)
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/push-result") {
        const body = await readJsonBody(request);
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
          sendJson(response, 400, { ok: false, error: "No folder selected." });
          return;
        }

        sendJson(response, 200, { ok: true, path: selection[0].fsPath });
        return;
      }

      sendJson(response, 404, { ok: false, error: "Unknown endpoint." });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  }

  return {
    start,
    stop,
    status,
    getWorkspaceRoot: getServerWorkspaceRoot,
    pushCode: pushQueue.pushCode,
    getStatusInfo,
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers["content-type"] || "");
    if (!contentType.includes("application/json")) {
      reject(new Error("Request content type must be application/json."));
      request.resume();
      return;
    }

    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", () => reject(new Error("Could not read request body.")));
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function setCorsHeaders(request, response) {
  const origin = String(request.headers.origin || "");
  if (origin.startsWith("chrome-extension://")) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

module.exports = { createBridgeServer };
