// Functions injected into the LeetCode page's MAIN world. Each must be fully
// self-contained (no external references) because chrome.scripting serializes the
// function source; all helpers live INSIDE the injected function.
//
// Selectors verified against the 2026 LeetCode UI: the Run/Submit buttons expose
// data-e2e-locator="console-run-button" / "console-submit-button" (the stable,
// test-oriented attributes). We keep those as primary and add text/aria fallbacks
// in case the markup changes.

// Returns true once Monaco has at least one editor/model mounted.
export function monacoReadyProbe() {
  try {
    const api = typeof monaco !== "undefined" ? monaco : window.monaco;
    if (api && api.editor) {
      const editors = typeof api.editor.getEditors === "function" ? api.editor.getEditors() : [];
      if (editors && editors.length) {
        return true;
      }
      const models = typeof api.editor.getModels === "function" ? api.editor.getModels() : [];
      if (models && models.length) {
        return true;
      }
    }
  } catch (error) {
    return false;
  }
  return false;
}

// Reads the LeetCode submission verdict ("Accepted" / "Wrong Answer" / etc.), or null.
// Primary selector data-e2e-locator="submission-result"; falls back to a short-text scan.
export function readVerdict(action) {
  try {
    const primary = action === "submit" ? document.querySelector('[data-e2e-locator="submission-result"]') : document.querySelector('[data-e2e-locator="console-result"]');
    if (primary) {
      const text = (primary.textContent || "").trim();
      if (text) {
        return text;
      }
    }
  } catch (error) {
    return null;
  }
  return null;
} 
//Returns { ok, submitted }
// or { ok:false, error }. Retries the button once in case the console is still mounting.
export function pasteIntoMonaco(code, submitAction) {
  function getMonaco() {
    return typeof monaco !== "undefined" ? monaco : window.monaco;
  }

  function setValue(nextCode) {
    try {
      const api = getMonaco();
      if (api && api.editor) {
        const editors = typeof api.editor.getEditors === "function" ? api.editor.getEditors() : [];
        if (editors && editors.length) {
          editors[0].setValue(nextCode);
          return true;
        }
        const models = typeof api.editor.getModels === "function" ? api.editor.getModels() : [];
        if (models && models.length) {
          models[0].setValue(nextCode);
          return true;
        }
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  function textOf(el) {
    return (el.textContent || "").trim();
  }

  function ariaOf(el) {
    return (el.getAttribute("aria-label") || "").trim();
  }

  // Find the Run or Submit button with graceful fallbacks; never returns a disabled one.
  function findActionButton(action) {
    const isSubmit = action === "submit";

    const locator = isSubmit
      ? '[data-e2e-locator="console-submit-button"]'
      : '[data-e2e-locator="console-run-button"]';
    const byLocator = document.querySelector(locator);
    if (byLocator && !byLocator.disabled) {
      return byLocator;
    }

    const clickables = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
      (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true"
    );
    const exact = isSubmit ? /^submit$/i : /^run$/i;

    // Exact visible text, then exact aria-label.
    const byExactText = clickables.find((el) => exact.test(textOf(el)));
    if (byExactText) {
      return byExactText;
    }
    const byAria = clickables.find((el) => exact.test(ariaOf(el)));
    if (byAria) {
      return byAria;
    }

    // Loose text match, disambiguating Run vs Submit (e.g. "Run Code").
    const byLoose = clickables.find((el) => {
      const label = `${textOf(el)} ${ariaOf(el)}`;
      if (isSubmit) {
        return /submit/i.test(label);
      }
      return /\brun\b/i.test(label) && !/submit/i.test(label);
    });
    return byLoose || null;
  }

  const pasted = setValue(code);
  if (!pasted) {
    return { ok: false, error: "Monaco editor not found on this LeetCode page." };
  }

  if (submitAction !== "run" && submitAction !== "submit") {
    return { ok: true, submitted: false };
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      const retryButton = findActionButton(submitAction);
      if (retryButton) {
        retryButton.click();
        resolve({ ok: true, submitted: true });
      } else {
        resolve({ ok: true, submitted: false });
      }
    }, 500);
  });
}
