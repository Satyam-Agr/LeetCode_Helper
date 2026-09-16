const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createBridgeServer } = require("../src/server");
const {
  BRIDGE_PROTOCOL_VERSION,
  HEADER_PROTOCOL,
  HEADER_TOKEN,
  EXPECTED_CHROME_EXTENSION_ORIGIN,
} = require("../src/protocol");

function createVscodeStub() {
  const warnings = [];
  return {
    warnings,
    api: {
      window: {
        showInformationMessage() {},
        showWarningMessage(message) {
          warnings.push(message);
        },
        showErrorMessage() {},
        async showOpenDialog() {
          return undefined;
        },
      },
    },
  };
}

function createSettingsStore() {
  return {
    getSettings: () => ({}),
    saveSettings: async (settings) => settings,
  };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for bridge state");
}

function bridgeHeaders(token = null) {
  return {
    "Content-Type": "application/json",
    [HEADER_PROTOCOL]: String(BRIDGE_PROTOCOL_VERSION),
    ...(token ? { [HEADER_TOKEN]: token } : {}),
  };
}

async function postGenerate(port, body, signal, token = null) {
  const response = await fetch(`http://127.0.0.1:${port}/generate`, {
    method: "POST",
    headers: bridgeHeaders(token),
    body: JSON.stringify(body),
    signal,
  });
  return { status: response.status, body: await response.json() };
}

test("duplicate request IDs share generation and result", async (t) => {
  const vscode = createVscodeStub();
  let generateCalls = 0;
  let resultMessages = 0;
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => {
      generateCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: "created", title: "Two Sum", problemId: "1", path: "two-sum.java" };
    },
    getWorkspaceRoot: () => "C:\\workspace",
    showResult: () => {
      resultMessages += 1;
    },
    vscode: vscode.api,
    generationRetentionMs: 100,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const payload = { url: "https://leetcode.com/problems/two-sum/", requestId: "same-request" };
  const [first, second] = await Promise.all([
    postGenerate(bridge.getBoundPort(), payload),
    postGenerate(bridge.getBoundPort(), payload),
  ]);

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal(first.body.requestId, "same-request");
  assert.equal(generateCalls, 1);
  assert.equal(resultMessages, 1);
});

test("a retry after the first response is lost does not regenerate", async (t) => {
  const vscode = createVscodeStub();
  let generateCalls = 0;
  let accepted;
  let release;
  const started = new Promise((resolve) => {
    accepted = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => {
      generateCalls += 1;
      accepted();
      await gate;
      return { status: "created", title: "Two Sum", problemId: "1", path: "two-sum.java" };
    },
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    generationRetentionMs: 100,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const payload = { url: "https://leetcode.com/problems/two-sum/", requestId: "lost-response" };
  const controller = new AbortController();
  const abandoned = postGenerate(bridge.getBoundPort(), payload, controller.signal).catch(() => null);
  await started;
  controller.abort();

  const retry = postGenerate(bridge.getBoundPort(), payload);
  release();
  const response = await retry;
  await abandoned;

  assert.equal(response.status, 200);
  assert.equal(response.body.requestId, "lost-response");
  assert.equal(generateCalls, 1);
});

test("a secondary bridge acquires the port after the owner closes", async (t) => {
  const owner = http.createServer((_request, response) => response.end("owner"));
  await new Promise((resolve) => owner.listen(0, "127.0.0.1", resolve));
  const port = owner.address().port;
  const vscode = createVscodeStub();
  const bridge = createBridgeServer({
    port,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => ({}),
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    bindRetryMs: 20,
  });
  t.after(() => {
    bridge.stop();
    owner.close();
  });

  bridge.start();
  await waitFor(() => bridge.getStatusInfo().conflict);
  await new Promise((resolve) => owner.close(resolve));
  await waitFor(() => bridge.getStatusInfo().running);

  assert.equal(vscode.warnings.length, 1);
  assert.equal(bridge.getBoundPort(), port);
});

test("generation failures return stable error fields", async (t) => {
  const vscode = createVscodeStub();
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => {
      const error = new Error("LeetCode is unavailable.");
      error.code = "leetcode_network_error";
      error.retryable = true;
      throw error;
    },
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    generationRetentionMs: 100,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const response = await postGenerate(bridge.getBoundPort(), {
    url: "https://leetcode.com/problems/two-sum/",
    requestId: "failed-request",
  });

  assert.equal(response.status, 502);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.requestId, "failed-request");
  assert.equal(response.body.code, "leetcode_network_error");
  assert.equal(response.body.retryable, true);
});

test("a live long-poll receives a push created after the GET request", async (t) => {
  const vscode = createVscodeStub();
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => ({}),
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const port = bridge.getBoundPort();
  const pullResponse = fetch(`http://127.0.0.1:${port}/pull`, {
    headers: bridgeHeaders(),
  }).then((response) => response.json());
  await new Promise((resolve) => setTimeout(resolve, 30));

  const pushResult = bridge.pushCode({
    url: "https://leetcode.com/problems/two-sum/",
    code: "class Solution {}",
  });
  const payload = await Promise.race([
    pullResponse,
    new Promise((_, reject) => setTimeout(() => reject(new Error("long-poll did not receive push")), 500)),
  ]);

  assert.equal(payload.ok, true);
  assert.equal(payload.push.url, "https://leetcode.com/problems/two-sum/");

  await fetch(`http://127.0.0.1:${port}/push-result`, {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify({ id: payload.push.id, received: true }),
  });
  await fetch(`http://127.0.0.1:${port}/push-result`, {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify({ id: payload.push.id, ok: true }),
  });
  await pushResult;
});

test("health reports protocol and authentication state without exposing the token", async (t) => {
  const vscode = createVscodeStub();
  const token = "a".repeat(43);
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => ({}),
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    getAuthToken: () => token,
    extensionVersion: "1.2.3",
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const port = bridge.getBoundPort();
  const unpaired = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: bridgeHeaders(),
  }).then((response) => response.json());
  const paired = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: bridgeHeaders(token),
  }).then((response) => response.json());

  assert.equal(unpaired.protocolVersion, BRIDGE_PROTOCOL_VERSION);
  assert.equal(unpaired.extensionVersion, "1.2.3");
  assert.equal(unpaired.authRequired, true);
  assert.equal(unpaired.authenticated, false);
  assert.equal(paired.authenticated, true);
  assert.equal(JSON.stringify(paired).includes(token), false);
  assert.ok(Array.isArray(paired.capabilities));

  const diagnostics = bridge.getDiagnostics();
  assert.equal(diagnostics.protocolVersion, BRIDGE_PROTOCOL_VERSION);
  assert.equal(diagnostics.authEnabled, true);
  assert.equal(diagnostics.port, port);
});

test("protected routes reject missing tokens and incompatible protocols", async (t) => {
  const vscode = createVscodeStub();
  const token = "b".repeat(43);
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => ({ status: "created" }),
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    getAuthToken: () => token,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const port = bridge.getBoundPort();
  const missingToken = await postGenerate(
    port,
    { url: "https://leetcode.com/problems/two-sum/", requestId: "auth-test" }
  );
  assert.equal(missingToken.status, 401);
  assert.equal(missingToken.body.code, "pairing_required");

  const mismatchResponse = await fetch(`http://127.0.0.1:${port}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [HEADER_PROTOCOL]: "999",
      [HEADER_TOKEN]: token,
    },
    body: JSON.stringify({
      url: "https://leetcode.com/problems/two-sum/",
      requestId: "protocol-test",
    }),
  });
  const mismatch = await mismatchResponse.json();
  assert.equal(mismatchResponse.status, 426);
  assert.equal(mismatch.code, "protocol_mismatch");

  const rejectedOriginResponse = await fetch(`http://127.0.0.1:${port}/generate`, {
    method: "POST",
    headers: {
      ...bridgeHeaders(token),
      Origin: "https://example.com",
    },
    body: JSON.stringify({
      url: "https://leetcode.com/problems/two-sum/",
      requestId: "origin-test",
    }),
  });
  const rejectedOrigin = await rejectedOriginResponse.json();
  assert.equal(rejectedOriginResponse.status, 403);
  assert.equal(rejectedOrigin.code, "origin_rejected");
  assert.equal(bridge.getDiagnostics().activity.lastRejectedCode, "origin_rejected");

  const accepted = await postGenerate(
    port,
    { url: "https://leetcode.com/problems/two-sum/", requestId: "valid-auth" },
    undefined,
    token
  );
  assert.equal(accepted.status, 200);
});

test("automatic pairing is restricted to the stable Chrome extension origin", async (t) => {
  const vscode = createVscodeStub();
  const token = "h".repeat(43);
  let clock = 1000;
  const bridge = createBridgeServer({
    port: 0,
    settingsStore: createSettingsStore(),
    generateFromUrl: async () => ({}),
    getWorkspaceRoot: () => "C:\\workspace",
    showResult() {},
    vscode: vscode.api,
    getAuthToken: () => token,
    now: () => ++clock,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitFor(() => bridge.getStatusInfo().running);

  const port = bridge.getBoundPort();
  const rejected = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: "POST",
    headers: bridgeHeaders(),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, "origin_rejected");

  const incompatible = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: "POST",
    headers: {
      ...bridgeHeaders(),
      [HEADER_PROTOCOL]: "999",
      Origin: EXPECTED_CHROME_EXTENSION_ORIGIN,
    },
  });
  assert.equal(incompatible.status, 426);
  assert.equal((await incompatible.json()).code, "protocol_mismatch");

  const accepted = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: "POST",
    headers: {
      ...bridgeHeaders(),
      Origin: EXPECTED_CHROME_EXTENSION_ORIGIN,
    },
  });
  const payload = await accepted.json();
  assert.equal(accepted.status, 200);
  assert.equal(payload.protocolVersion, BRIDGE_PROTOCOL_VERSION);
  assert.equal(payload.token, token);
  assert.equal(
    accepted.headers.get("access-control-allow-origin"),
    EXPECTED_CHROME_EXTENSION_ORIGIN
  );
  assert.ok(bridge.getDiagnostics().activity.lastAutoPairAt);
});
