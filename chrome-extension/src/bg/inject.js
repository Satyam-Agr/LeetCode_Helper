// Functions injected into the LeetCode page's MAIN world. Each function must be
// self-contained because chrome.scripting serializes only that function's source.

// Returns true only when a usable solution editor is mounted. LeetCode can mount
// additional hidden/plaintext Monaco instances for console input, so model existence
// alone is not a sufficient readiness signal.
export function monacoReadyProbe() {
  function getMonaco() {
    return typeof monaco !== "undefined" ? monaco : window.monaco;
  }

  function isVisible(node) {
    if (!node || !node.isConnected) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(node) : null;
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  }

  try {
    const api = getMonaco();
    if (!api?.editor) {
      return false;
    }

    const editors = typeof api.editor.getEditors === "function" ? api.editor.getEditors() : [];
    if (editors.some((editor) => {
      const model = editor.getModel?.();
      const node = editor.getDomNode?.();
      if (!model || !isVisible(node)) {
        return false;
      }
      const aria = node.querySelector?.("textarea")?.getAttribute?.("aria-label") || "";
      return /code editor/i.test(aria) || model.getLanguageId?.() !== "plaintext";
    })) {
      return true;
    }

    // Older Monaco builds may expose models but not getEditors(). Prefer a
    // non-plaintext model so the console/testcase model is not mistaken for code.
    if (!editors.length && typeof api.editor.getModels === "function") {
      return api.editor.getModels().some((model) => model?.getLanguageId?.() !== "plaintext");
    }
  } catch {
    return false;
  }
  return false;
}

// Reads a known LeetCode run/submission verdict, or null. Selector fallbacks are
// deliberately filtered through known verdict text so an unrelated role=status
// element (for example "Saved") cannot be reported as a judge result.
export function readVerdict(action) {
  const selectors = action === "submit"
    ? [
        '[data-e2e-locator="submission-result"]',
        '[data-testid*="verdict" i]',
        '[data-testid*="result" i]',
        '[class*="result-state" i]',
        '[role="status"]',
      ]
    : [
        '[data-e2e-locator="console-result"]',
        '[data-e2e-locator*="test-result" i]',
        '[data-testid*="console-result" i]',
        '[data-testid*="test-result" i]',
        '[role="status"]',
      ];

  const verdictPattern = /\b(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error|Compilation Error|Output Limit Exceeded|Internal Error|All Testcases Passed|Finished|Success)\b/i;

  try {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const match = text.match(verdictPattern);
        if (match) {
          return match[1];
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

// Writes code into the best matching Monaco editor, reads it back for exact
// verification, and optionally clicks Run/Submit.
// Returns { ok, verified, submitted } or { ok:false, error, retryable }.
export async function pasteIntoMonaco(code, submitAction, expectedLanguage) {
  function getMonaco() {
    return typeof monaco !== "undefined" ? monaco : window.monaco;
  }

  function normalizeEol(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function normalizeLanguage(value) {
    const key = String(value || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
    const aliases = {
      c: "c",
      cpp: "cpp",
      "c++": "cpp",
      java: "java",
      javascript: "javascript",
      js: "javascript",
      nodejs: "javascript",
      python: "python",
      python3: "python",
      py: "python",
    };
    return aliases[key] || key || null;
  }

  function languageLabel(value) {
    return {
      c: "C",
      cpp: "C++",
      java: "Java",
      javascript: "JavaScript",
      python: "Python",
    }[value] || value || "unknown";
  }

  function isVisible(node) {
    if (!node || !node.isConnected) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(node) : null;
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  }

  function editorScore(editor) {
    try {
      const model = editor.getModel?.();
      const node = editor.getDomNode?.();
      if (!model || !isVisible(node)) {
        return -1;
      }

      let score = 100;
      const aria = node.querySelector?.("textarea")?.getAttribute?.("aria-label") || "";
      if (/code editor/i.test(aria)) {
        score += 80;
      }
      if (model.getLanguageId?.() && model.getLanguageId() !== "plaintext") {
        score += 30;
      }
      if (node.contains?.(document.activeElement)) {
        score += 10;
      }
      return score;
    } catch {
      return -1;
    }
  }

  function findTarget() {
    const api = getMonaco();
    if (!api?.editor) {
      return null;
    }

    const editors = typeof api.editor.getEditors === "function" ? api.editor.getEditors() : [];
    const ranked = editors
      .map((editor) => ({ editor, score: editorScore(editor) }))
      .filter((candidate) => candidate.score >= 100)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) {
      return { editor: ranked[0].editor, model: ranked[0].editor.getModel() };
    }

    if (!editors.length && typeof api.editor.getModels === "function") {
      const models = api.editor.getModels();
      const model = models.find((candidate) => candidate?.getLanguageId?.() !== "plaintext") || null;
      if (model) {
        return { editor: null, model };
      }
    }
    return null;
  }

  function writeAndVerify(target, nextCode) {
    try {
      const model = target.model;
      if (!model || typeof model.getValue !== "function") {
        return false;
      }

      let edited = false;
      if (target.editor && typeof target.editor.executeEdits === "function" && model.getFullModelRange) {
        target.editor.pushUndoStop?.();
        edited = target.editor.executeEdits("leetcode-helper", [{
          range: model.getFullModelRange(),
          text: nextCode,
          forceMoveMarkers: true,
        }]) !== false;
        target.editor.pushUndoStop?.();
      }

      if (!edited && typeof model.setValue === "function") {
        model.setValue(nextCode);
      }
      target.editor?.focus?.();
      return normalizeEol(model.getValue()) === nextCode;
    } catch {
      return false;
    }
  }

  function textOf(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function ariaOf(element) {
    return String(element?.getAttribute?.("aria-label") || "").trim();
  }

  function isUsableButton(element) {
    return Boolean(
      element &&
      element.isConnected &&
      !element.disabled &&
      element.getAttribute?.("aria-disabled") !== "true" &&
      isVisible(element)
    );
  }

  function findActionButton(action) {
    const isSubmit = action === "submit";
    const locator = isSubmit
      ? '[data-e2e-locator="console-submit-button"]'
      : '[data-e2e-locator="console-run-button"]';
    const primary = document.querySelector(locator);
    if (isUsableButton(primary)) {
      return primary;
    }

    const clickables = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isUsableButton);
    const exact = isSubmit ? /^submit$/i : /^run(?: code)?$/i;
    return clickables.find((element) => exact.test(textOf(element)) || exact.test(ariaOf(element))) || null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const expected = normalizeEol(code);
  const requiredLanguage = normalizeLanguage(expectedLanguage);
  let verified = false;

  // The page can remount Monaco between readiness probing and this call. Re-select
  // the editor and retry once only when read-back proves the write did not stick.
  for (let attempt = 0; attempt < 2 && !verified; attempt++) {
    const target = findTarget();
    if (target) {
      const actualLanguage = normalizeLanguage(target.model.getLanguageId?.());
      if (requiredLanguage && actualLanguage && requiredLanguage !== actualLanguage) {
        return {
          ok: false,
          verified: false,
          retryable: false,
          code: "language_mismatch",
          expectedLanguage: requiredLanguage,
          actualLanguage,
          error: `Language mismatch: the VS Code solution is ${languageLabel(requiredLanguage)}, but LeetCode is currently set to ${languageLabel(actualLanguage)}. Switch the LeetCode editor language and push again.`,
        };
      }
      verified = writeAndVerify(target, expected);
      if (verified) {
        await delay(100);
        try {
          verified = normalizeEol(target.model.getValue?.()) === expected;
        } catch {
          verified = false;
        }
      }
    }
    if (!verified && attempt === 0) {
      await delay(150);
    }
  }

  if (!verified) {
    return {
      ok: false,
      verified: false,
      retryable: true,
      error: "The visible LeetCode code editor was not ready or rejected the code update.",
    };
  }

  if (submitAction !== "run" && submitAction !== "submit") {
    return { ok: true, verified: true, submitted: false };
  }

  // Give LeetCode's editor state listener a moment to observe the Monaco edit, then
  // tolerate a short button remount instead of relying on a single fixed lookup.
  await delay(150);
  const deadline = Date.now() + 3000;
  let button = null;
  while (!button && Date.now() < deadline) {
    button = findActionButton(submitAction);
    if (!button) {
      await delay(100);
    }
  }

  if (!button) {
    return {
      ok: true,
      verified: true,
      submitted: false,
      actionError: `Code was verified, but the ${submitAction === "submit" ? "Submit" : "Run"} button was not ready.`,
    };
  }

  try {
    button.click();
    return { ok: true, verified: true, submitted: true };
  } catch {
    return {
      ok: true,
      verified: true,
      submitted: false,
      actionError: `Code was verified, but the ${submitAction === "submit" ? "Submit" : "Run"} click failed.`,
    };
  }
}
