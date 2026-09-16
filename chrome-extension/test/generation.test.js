import test from "node:test";
import assert from "node:assert/strict";

import { createGenerationController } from "../src/bg/generator.js";
import { pollLoop } from "../src/bg/poller.js";
import {
  generateFile,
  getBridgeHealth,
  getPairingToken,
  pairWithBridge,
  reportPushResult,
  savePairingToken,
} from "../src/http.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  EXPECTED_EXTENSION_ID,
  HEADER_PROTOCOL,
  HEADER_TOKEN,
} from "../src/protocol.js";

test("bridge startup failures retry with one request ID", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requestBodies = [];
  const delays = [];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requestBodies.push(JSON.parse(options.body));
    if (calls < 3) {
      throw new TypeError("connection refused");
    }
    return new Response(
      JSON.stringify({ ok: true, requestId: "request-1", status: "created", problemId: "1", title: "Two Sum" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await generateFile("https://leetcode.com/problems/two-sum/", "request-1", {
    retryDelaysMs: [0, 10, 20],
    sleepFn: async (delay) => delays.push(delay),
  });

  assert.equal(result.status, "created");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(
    requestBodies.map((body) => body.requestId),
    ["request-1", "request-1", "request-1"]
  );
});

test("server errors are surfaced without connection retries", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        ok: false,
        code: "problem_not_found",
        error: "Problem not found.",
        retryable: false,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  };

  await assert.rejects(
    generateFile("https://leetcode.com/problems/missing/", "request-2", {
      retryDelaysMs: [0, 10, 20],
      sleepFn: async () => assert.fail("server errors must not be retried by the bridge client"),
    }),
    { code: "problem_not_found" }
  );
  assert.equal(calls, 1);
});

test("rapid clicks on one tab join the same generation", async () => {
  let generateCalls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const statuses = [];
  const controller = createGenerationController({
    generate: async (_url, requestId) => {
      generateCalls += 1;
      await gate;
      return { status: "created", problemId: "1", title: "Two Sum", requestId };
    },
    validateUrl() {},
    showStatus: async (...status) => statuses.push(status),
    createRequestId: () => "one-logical-request",
  });

  const tab = { id: 7, url: "https://leetcode.com/problems/two-sum/" };
  const first = controller.handleClick(tab);
  const second = controller.handleClick(tab);
  release();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(generateCalls, 1);
  assert.strictEqual(a, b);
  assert.ok(statuses.some(([, state, message]) => state === "busy" && message.startsWith("Already")));
  assert.ok(statuses.some(([, state]) => state === "success"));
});

test("invalid tabs fail before contacting the bridge", async () => {
  let generateCalls = 0;
  const statuses = [];
  const controller = createGenerationController({
    generate: async () => {
      generateCalls += 1;
    },
    validateUrl() {
      throw new Error("Open a LeetCode problem page first.");
    },
    showStatus: async (...status) => statuses.push(status),
  });

  const result = await controller.handleClick({ id: 9, url: "https://example.com" });
  assert.equal(result, null);
  assert.equal(generateCalls, 0);
  assert.equal(statuses[0][1], "error");
});

test("push results retry until VS Code acknowledges them", async () => {
  let calls = 0;
  const delays = [];
  const payload = await reportPushResult(
    { id: 4, ok: true },
    {
      retryDelaysMs: [0, 10, 20],
      sleepFn: async (delay) => delays.push(delay),
      fetchFn: async () => {
        calls += 1;
        if (calls < 3) {
          throw new TypeError("connection reset");
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }
  );

  assert.equal(payload.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("polling continues after an unexpected push handler failure", async () => {
  const controller = new AbortController();
  let pulls = 0;
  let handled = 0;

  await pollLoop({
    signal: controller.signal,
    pullFn: async () => ({ ok: true, push: { id: ++pulls } }),
    handlePushFn: async () => {
      handled += 1;
      if (handled === 1) {
        throw new Error("temporary handler failure");
      }
      controller.abort();
    },
    sleepFn: async () => {},
  });

  assert.equal(pulls, 2);
  assert.equal(handled, 2);
});

test("pairing token is stored locally and attached to bridge requests", async (t) => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const storage = {};
  let requestHeaders = null;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (value) => Object.assign(storage, value),
      },
    },
  };
  globalThis.fetch = async (_url, options) => {
    requestHeaders = options.headers;
    return new Response(JSON.stringify({
      ok: true,
      requestId: "paired-request",
      status: "created",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  });

  const token = "d".repeat(43);
  await savePairingToken(token);
  assert.equal(await getPairingToken(), token);
  await generateFile("https://leetcode.com/problems/two-sum/", "paired-request", {
    retryDelaysMs: [0],
  });

  assert.equal(requestHeaders[HEADER_TOKEN], token);
  assert.equal(requestHeaders[HEADER_PROTOCOL], String(BRIDGE_PROTOCOL_VERSION));
});

test("missing authentication is paired and retried without user involvement", async (t) => {
  const previousChrome = globalThis.chrome;
  const storage = {};
  globalThis.chrome = {
    runtime: { id: EXPECTED_EXTENSION_ID },
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (value) => Object.assign(storage, value),
      },
    },
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  const token = "z".repeat(43);
  const calls = [];
  const fetchFn = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, headers: options.headers });
    if (path === "/pair") {
      return new Response(JSON.stringify({
        ok: true,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        token,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const authenticated = options.headers[HEADER_TOKEN] === token;
    return new Response(JSON.stringify({
      ok: true,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      extensionVersion: "test",
      authRequired: true,
      authenticated,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const health = await getBridgeHealth({ fetchFn });

  assert.equal(health.authenticated, true);
  assert.equal(storage.pairingToken, token);
  assert.deepEqual(calls.map((call) => call.path), ["/health", "/pair", "/health"]);
  assert.equal(calls[1].headers[HEADER_PROTOCOL], String(BRIDGE_PROTOCOL_VERSION));
});

test("automatic pairing rejects an unexpected unpacked extension identity", async (t) => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  await assert.rejects(
    pairWithBridge({ fetchFn: async () => assert.fail("network should not be contacted") }),
    { code: "extension_identity_mismatch" }
  );
});

test("health handshake rejects incompatible VS Code protocol versions", async () => {
  await assert.rejects(
    getBridgeHealth({
      requireAuthentication: false,
      fetchFn: async () => new Response(JSON.stringify({
        ok: true,
        protocolVersion: BRIDGE_PROTOCOL_VERSION + 1,
        extensionVersion: "future",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }),
    { code: "protocol_mismatch" }
  );
});
