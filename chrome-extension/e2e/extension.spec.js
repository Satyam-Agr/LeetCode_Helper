import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_PROTOCOL_VERSION, EXPECTED_EXTENSION_ID } from "../src/protocol.js";

const PAIRING_TOKEN = "e".repeat(43);
const extensionSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let context;
let bridge;
let temporaryRoot;

test.describe.serial("installed Chrome extension push flow", () => {
  test.beforeAll(async () => {
    bridge = await createFakeBridge();
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leetcode-helper-e2e-"));
    const extensionPath = path.join(temporaryRoot, "extension");
    copyExtension(extensionSource, extensionPath);
    fs.writeFileSync(
      path.join(extensionPath, "src", "config.js"),
      `export const PORT = ${bridge.port};\n`,
      "utf8"
    );

    context = await chromium.launchPersistentContext(path.join(temporaryRoot, "profile"), {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await context.route(/^https:\/\/(?:www\.)?leetcode\.com\/problems\//, async (route) => {
      const slug = new URL(route.request().url()).pathname.split("/").filter(Boolean)[1] || "fixture";
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: fixtureHtml(fixtureForSlug(slug)),
      });
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }
    expect(worker.url()).toContain(`chrome-extension://${EXPECTED_EXTENSION_ID}/`);
    await expect.poll(async () => worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("pairingToken");
      return stored.pairingToken || "";
    })).toBe(PAIRING_TOKEN);
  });

  test.afterAll(async () => {
    await context?.close();
    await bridge?.close();
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("pairs with the local bridge automatically", async () => {
    const pairing = bridge.getPairingInfo();
    expect(pairing.count).toBeGreaterThan(0);
    expect(pairing.origin).toBe(`chrome-extension://${EXPECTED_EXTENSION_ID}`);
    expect(pairing.protocol).toBe(String(BRIDGE_PROTOCOL_VERSION));
  });

  for (const [slug, language, code] of [
    ["fixture-cpp", "cpp", "class Solution { public: int value = 1; };"],
    ["fixture-java", "java", "class Solution { int value = 2; }"],
    ["fixture-python", "python", "class Solution:\n    value = 3"],
    ["fixture-javascript", "javascript", "class Solution { value = 4; }"],
  ]) {
    test(`paste-only verifies ${language} in an existing tab`, async () => {
      const page = await openProblem(slug);
      const result = await bridge.push({
        url: `https://leetcode.com/problems/${slug}/`,
        code,
        language,
        submitAction: "none",
      });

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(await page.evaluate(() => window.__fixture.code())).toBe(code);
    });
  }

  test("language mismatch fails without modifying the editor", async () => {
    const page = await openProblem("fixture-mismatch");
    const original = await page.evaluate(() => window.__fixture.code());
    const result = await bridge.push({
      url: "https://leetcode.com/problems/fixture-mismatch/",
      code: "class Solution {}",
      language: "java",
      submitAction: "none",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("language_mismatch");
    expect(result.actualLanguage).toBe("cpp");
    expect(await page.evaluate(() => window.__fixture.code())).toBe(original);
  });

  test("a newly opened tab waits through a Monaco remount", async () => {
    const code = "class Solution { public: int remounted = 1; };";
    const resultPromise = bridge.push({
      url: "https://leetcode.com/problems/fixture-remount/",
      code,
      language: "cpp",
      submitAction: "none",
    });
    await expect.poll(() => context.pages().some((candidate) => (
      candidate.url().includes("/problems/fixture-remount/")
    ))).toBe(true);
    const page = context.pages().find((candidate) => (
      candidate.url().includes("/problems/fixture-remount/")
    ));
    // Tabs created by chrome.tabs.create bypass Playwright's context router in
    // Chromium. Re-navigating that same extension-created tab keeps the product
    // behavior under test while replacing the live site with our deterministic
    // Monaco fixture.
    await page.goto("https://leetcode.com/problems/fixture-remount/");
    try {
      await page.waitForFunction(() => Boolean(window.__fixture?.ready()), null, { timeout: 5000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        body: document.body?.innerText?.slice(0, 300) || "",
        hasFixture: Boolean(window.__fixture),
      })).catch(() => ({ url: page.url(), inaccessible: true }));
      throw new Error(`New-tab fixture did not initialize: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(await page.evaluate(() => window.__fixture.code())).toBe(code);
  });

  test("the active matching tab is selected when duplicates exist", async () => {
    const first = await openProblem("fixture-duplicate");
    const second = await openProblem("fixture-duplicate");
    await second.bringToFront();
    const code = "class Solution { public: int activeTab = 1; };";

    const result = await bridge.push({
      url: "https://leetcode.com/problems/fixture-duplicate/",
      code,
      language: "cpp",
      submitAction: "none",
    });

    expect(result.ok).toBe(true);
    expect(await second.evaluate(() => window.__fixture.code())).toBe(code);
    expect(await first.evaluate(() => window.__fixture.code())).not.toBe(code);
  });

  test("Run is clicked only after verified paste", async () => {
    const page = await openProblem("fixture-run");
    const result = await bridge.push({
      url: "https://leetcode.com/problems/fixture-run/",
      code: "class Solution { public: int run = 1; };",
      language: "cpp",
      submitAction: "run",
    });

    expect(result.ok).toBe(true);
    expect(result.submitted).toBe(true);
    expect(result.verdict).toBe("All Testcases Passed");
    expect(await page.evaluate(() => window.__fixture.actions())).toEqual(["run"]);
  });

  test("Submit is clicked only after verified paste", async () => {
    const page = await openProblem("fixture-submit");
    const result = await bridge.push({
      url: "https://leetcode.com/problems/fixture-submit/",
      code: "class Solution { public: int submit = 1; };",
      language: "cpp",
      submitAction: "submit",
    });

    expect(result.ok).toBe(true);
    expect(result.submitted).toBe(true);
    expect(result.verdict).toBe("Accepted");
    expect(await page.evaluate(() => window.__fixture.actions())).toEqual(["submit"]);
  });
});

async function openProblem(slug) {
  const page = await context.newPage();
  await page.goto(`https://leetcode.com/problems/${slug}/`);
  await page.waitForFunction(() => Boolean(window.__fixture?.ready()));
  return page;
}

function fixtureForSlug(slug) {
  const language = slug.includes("javascript")
    ? "javascript"
    : slug.includes("java")
      ? "java"
      : slug.includes("python")
        ? "python"
        : "cpp";
  return {
    language,
    mountDelay: slug === "fixture-remount" ? 600 : 0,
  };
}

function fixtureHtml({ language, mountDelay }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { margin: 0; font-family: sans-serif; }
#code-editor { width: 800px; height: 500px; }
#hidden-editor { display: none; }
button { width: 100px; height: 36px; }
</style></head><body>
<div id="code-editor"><textarea aria-label="Code editor"></textarea></div>
<div id="hidden-editor"><textarea aria-label="The editor is not accessible at this time."></textarea></div>
<button data-e2e-locator="console-run-button" aria-label="Run">Run</button>
<button data-e2e-locator="console-submit-button" aria-label="Submit">Submit</button>
<div id="results"></div>
<script>
(() => {
  const state = { actions: [], codeModel: null };
  window.__fixture = {
    ready: () => Boolean(state.codeModel),
    code: () => state.codeModel ? state.codeModel.getValue() : null,
    actions: () => state.actions.slice(),
  };
  const makeModel = (initial, modelLanguage) => {
    let value = initial;
    return {
      getLanguageId: () => modelLanguage,
      getValue: () => value,
      setValue: (next) => { value = next; },
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1000, endColumn: 1 }),
      apply: (next) => { value = next; },
    };
  };
  const mount = () => {
    const codeNode = document.getElementById("code-editor");
    const hiddenNode = document.getElementById("hidden-editor");
    const hiddenModel = makeModel("", "plaintext");
    const codeModel = makeModel("starter ${language}", ${JSON.stringify(language)});
    state.codeModel = codeModel;
    const editor = (node, model) => ({
      getDomNode: () => node,
      getModel: () => model,
      pushUndoStop: () => {},
      focus: () => {},
      executeEdits: (_source, edits) => { model.apply(edits[0].text); return true; },
    });
    window.monaco = { editor: {
      getEditors: () => [editor(hiddenNode, hiddenModel), editor(codeNode, codeModel)],
      getModels: () => [hiddenModel, codeModel],
    }};
  };
  setTimeout(mount, ${mountDelay});
  document.querySelector('[data-e2e-locator="console-run-button"]').addEventListener("click", () => {
    state.actions.push("run");
    document.getElementById("results").innerHTML = '<div data-e2e-locator="console-result">All Testcases Passed</div>';
  });
  document.querySelector('[data-e2e-locator="console-submit-button"]').addEventListener("click", () => {
    state.actions.push("submit");
    document.getElementById("results").innerHTML = '<div data-e2e-locator="submission-result">Accepted</div>';
  });
})();
</script></body></html>`;
}

function copyExtension(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      if (!relative) {
        return true;
      }
      const first = relative.split(path.sep)[0];
      return !["node_modules", "test", "e2e", ".playwright", "test-results", "playwright-report"].includes(first) &&
        !relative.endsWith("package-lock.json");
    },
  });
}

async function createFakeBridge() {
  let nextId = 1;
  const pending = [];
  const jobs = new Map();
  let waiter = null;
  const pairing = { count: 0, origin: null, protocol: null };

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || "*";
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LeetCode-Helper-Protocol, X-LeetCode-Helper-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/health") {
      send(response, 200, {
        ok: true,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        extensionVersion: "e2e",
        authRequired: true,
        authenticated: request.headers["x-leetcode-helper-token"] === PAIRING_TOKEN,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/pair") {
      pairing.count += 1;
      pairing.origin = request.headers.origin || null;
      pairing.protocol = request.headers["x-leetcode-helper-protocol"] || null;
      if (
        pairing.origin !== `chrome-extension://${EXPECTED_EXTENSION_ID}` ||
        pairing.protocol !== String(BRIDGE_PROTOCOL_VERSION)
      ) {
        send(response, 403, { ok: false, code: "origin_rejected", error: "Unexpected extension identity." });
        return;
      }
      send(response, 200, {
        ok: true,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        token: PAIRING_TOKEN,
      });
      return;
    }

    if (
      request.headers["x-leetcode-helper-protocol"] !== String(BRIDGE_PROTOCOL_VERSION) ||
      request.headers["x-leetcode-helper-token"] !== PAIRING_TOKEN
    ) {
      send(response, 401, { ok: false, code: "pairing_required", error: "Not paired." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/pull") {
      if (pending.length) {
        send(response, 200, { ok: true, push: pending.shift() });
      } else {
        waiter = response;
        const timer = setTimeout(() => {
          if (waiter === response) {
            waiter = null;
            send(response, 200, { ok: true, push: null });
          }
        }, 5000);
        response.on("close", () => clearTimeout(timer));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/push-result") {
      const result = await readJson(request);
      const job = jobs.get(result.id);
      if (job) {
        job.events.push(result);
        if (result.ok === true || result.ok === false) {
          clearTimeout(job.timer);
          jobs.delete(result.id);
          job.resolve(result);
        }
      }
      send(response, 200, { ok: true });
      return;
    }

    send(response, 404, { ok: false, error: "Unknown endpoint." });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    getPairingInfo: () => ({ ...pairing }),
    push(payload) {
      const push = { id: nextId++, ...payload };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const job = jobs.get(push.id);
          jobs.delete(push.id);
          reject(new Error(`Timed out waiting for push ${push.id}; events=${JSON.stringify(job?.events || [])}`));
        }, 30000);
        jobs.set(push.id, { resolve, reject, timer, events: [] });
        if (waiter && !waiter.writableEnded) {
          const response = waiter;
          waiter = null;
          send(response, 200, { ok: true, push });
        } else {
          pending.push(push);
        }
      });
    },
    close() {
      for (const job of jobs.values()) {
        clearTimeout(job.timer);
        job.reject(new Error("Fake bridge closed."));
      }
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function send(response, status, payload) {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
