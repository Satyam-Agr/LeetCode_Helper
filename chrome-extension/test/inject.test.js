import test from "node:test";
import assert from "node:assert/strict";

import { monacoReadyProbe, pasteIntoMonaco, readVerdict } from "../src/bg/inject.js";

function createModel(initialValue, language = "cpp") {
  let value = initialValue;
  return {
    getLanguageId: () => language,
    getValue: () => value,
    setValue: (next) => {
      value = next;
    },
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
    apply: (next) => {
      value = next;
    },
  };
}

function createNode({ visible, aria = "" }) {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ width: visible ? 500 : 0, height: visible ? 300 : 0 }),
    querySelector: () => ({ getAttribute: (name) => name === "aria-label" ? aria : null }),
    contains: () => false,
  };
}

function createEditor(model, node) {
  return {
    getModel: () => model,
    getDomNode: () => node,
    executeEdits: (_source, edits) => {
      model.apply(edits[0].text);
      return true;
    },
    pushUndoStop() {},
    focus() {},
  };
}

function installPage(t, { editors = [], models = [], querySelector, querySelectorAll } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    monaco: {
      editor: {
        getEditors: () => editors,
        getModels: () => models,
      },
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  globalThis.document = {
    activeElement: null,
    querySelector: querySelector || (() => null),
    querySelectorAll: querySelectorAll || (() => []),
  };
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  });
}

test("readiness ignores hidden and plaintext-only Monaco editors", (t) => {
  const hiddenCode = createEditor(createModel("code", "cpp"), createNode({ visible: false, aria: "Code editor" }));
  const visibleConsole = createEditor(createModel("", "plaintext"), createNode({ visible: true, aria: "Console input" }));
  installPage(t, { editors: [hiddenCode, visibleConsole] });

  assert.equal(monacoReadyProbe(), false);
});

test("paste targets the visible code editor and verifies exact content", async (t) => {
  const hiddenModel = createModel("hidden", "plaintext");
  const codeModel = createModel("old code", "cpp");
  const hiddenEditor = createEditor(hiddenModel, createNode({ visible: false, aria: "Not accessible" }));
  const codeEditor = createEditor(codeModel, createNode({ visible: true, aria: "Code editor" }));
  installPage(t, { editors: [hiddenEditor, codeEditor] });

  assert.equal(monacoReadyProbe(), true);
  const result = await pasteIntoMonaco("line one\r\nline two", "none");

  assert.deepEqual(result, { ok: true, verified: true, submitted: false });
  assert.equal(codeModel.getValue(), "line one\nline two");
  assert.equal(hiddenModel.getValue(), "hidden");
});

test("paste reports a retryable error when no visible solution editor exists", async (t) => {
  const hiddenEditor = createEditor(createModel("hidden", "cpp"), createNode({ visible: false, aria: "Code editor" }));
  installPage(t, { editors: [hiddenEditor] });

  const result = await pasteIntoMonaco("new code", "none");
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.retryable, true);
});

test("language mismatch is rejected before modifying the editor", async (t) => {
  const codeModel = createModel("original C++", "cpp");
  const codeEditor = createEditor(codeModel, createNode({ visible: true, aria: "Code editor" }));
  installPage(t, { editors: [codeEditor] });

  const result = await pasteIntoMonaco("public class Solution {}", "none", "java");
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.code, "language_mismatch");
  assert.equal(result.expectedLanguage, "java");
  assert.equal(result.actualLanguage, "cpp");
  assert.equal(codeModel.getValue(), "original C++");
});

test("Run uses the stable locator after the code is verified", async (t) => {
  const codeModel = createModel("old code", "cpp");
  const codeEditor = createEditor(codeModel, createNode({ visible: true, aria: "Code editor" }));
  let clicks = 0;
  const runButton = {
    isConnected: true,
    disabled: false,
    textContent: "",
    getAttribute: (name) => name === "aria-label" ? "Run" : null,
    getBoundingClientRect: () => ({ width: 32, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  installPage(t, {
    editors: [codeEditor],
    querySelector: (selector) => selector.includes("console-run-button") ? runButton : null,
  });

  const result = await pasteIntoMonaco("verified code", "run");
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.submitted, true);
  assert.equal(clicks, 1);
});

test("verdict fallbacks ignore unrelated status text", (t) => {
  installPage(t, {
    querySelectorAll: (selector) => selector === '[role="status"]'
      ? [{ textContent: "Saved" }, { textContent: "Wrong Answer" }]
      : [],
  });

  assert.equal(readVerdict("submit"), "Wrong Answer");
});
