// The "Push to LeetCode" webview HTML. Styled with var(--vscode-*) theme variables.
// Shows one of two states depending on whether the active file has ".lch" metadata:
//   - no metadata: a short explanatory message.
//   - has metadata: file name + "code section only" checkbox + "After paste" select
//     + Push button + Reset button + status line. (The problem URL is not shown.)
function getPushViewHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { --line: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 14px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
      }
      .eyebrow {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6;
      }
      h1 { margin: 2px 0 14px; font-size: 15px; font-weight: 600; }
      .label {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.65;
      }
      .field { display: grid; gap: 4px; margin-bottom: 14px; }
      .value {
        padding: 7px 9px; border: 1px solid var(--line); border-radius: 5px;
        background: var(--vscode-editor-background); word-break: break-all; min-height: 16px;
      }
      .value.muted { opacity: 0.55; }
      .check { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; cursor: pointer; }
      .check input { margin: 0; }
      select {
        width: 100%; padding: 6px 8px;
        color: var(--vscode-input-foreground); background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 5px; font: inherit;
      }
      .buttons { display: grid; gap: 8px; }
      button {
        width: 100%; padding: 8px 12px;
        color: var(--vscode-button-foreground); background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-background); border-radius: 5px;
        font: inherit; font-weight: 600; cursor: pointer;
      }
      button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
      button.secondary {
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        background: var(--vscode-button-secondaryBackground, transparent);
        border-color: var(--line);
      }
      button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      #status { margin-top: 12px; min-height: 18px; font-size: 12px; opacity: 0.85; }
      #status.busy { animation: lch-pulse 1.1s ease-in-out infinite; }
      #status.error { color: var(--vscode-errorForeground); opacity: 1; }
      #status.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
      #status.warn { color: var(--vscode-editorWarning-foreground, #d9822b); opacity: 1; }
      @keyframes lch-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      #bridgeWarning {
        margin-bottom: 14px; padding: 8px 10px; border-radius: 5px;
        font-size: 12px; line-height: 1.4;
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-warningBackground, rgba(217, 130, 43, 0.12));
        border: 1px solid var(--vscode-inputValidation-warningBorder, #d9822b);
      }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <span class="eyebrow">LEETCODE</span>
    <h1>Push to LeetCode</h1>

    <div id="bridgeWarning" hidden>
      This VS Code window is not the primary bridge instance — port 8765 is already in
      use by another window. Generate and Push work only from that first window.
    </div>

    <div id="noMeta" class="value muted" hidden>
      This file has no LeetCode metadata. Generate it from the Chrome extension first,
      then reopen this file.
    </div>

    <div id="hasMeta" hidden>
      <div class="field">
        <span class="label">Active file</span>
        <div id="fileName" class="value">—</div>
      </div>

      <label class="check">
        <input id="codeOnly" type="checkbox" checked />
        Copy code section only
      </label>

      <div class="field">
        <span class="label">After paste</span>
        <select id="afterPaste">
          <option value="none">Do nothing</option>
          <option value="run">Run</option>
          <option value="submit">Submit</option>
        </select>
      </div>

      <div class="buttons">
        <button id="pushButton">Push to LeetCode</button>
        <button id="resetButton" class="secondary">Reset to template</button>
      </div>
    </div>

    <div id="status"></div>

    <script>
      const vscodeApi = acquireVsCodeApi();
      const noMetaEl = document.getElementById("noMeta");
      const hasMetaEl = document.getElementById("hasMeta");
      const bridgeWarningEl = document.getElementById("bridgeWarning");
      const fileNameEl = document.getElementById("fileName");
      const codeOnlyEl = document.getElementById("codeOnly");
      const afterPasteEl = document.getElementById("afterPaste");
      const pushButton = document.getElementById("pushButton");
      const resetButton = document.getElementById("resetButton");
      const statusEl = document.getElementById("status");

      const saved = vscodeApi.getState() || {};
      if (saved.submitAction) afterPasteEl.value = saved.submitAction;
      if (typeof saved.codeOnly === "boolean") codeOnlyEl.checked = saved.codeOnly;

      function persist() {
        vscodeApi.setState({ submitAction: afterPasteEl.value, codeOnly: codeOnlyEl.checked });
      }
      function announce() {
        vscodeApi.postMessage({ type: "prefs", submitAction: afterPasteEl.value, codeOnly: codeOnlyEl.checked });
      }
      persist();
      announce();

      afterPasteEl.addEventListener("change", () => { persist(); announce(); });
      codeOnlyEl.addEventListener("change", () => { persist(); announce(); });

      pushButton.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "push", submitAction: afterPasteEl.value, codeOnly: codeOnlyEl.checked });
      });
      resetButton.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "reset" });
      });

      window.addEventListener("message", (event) => {
        const message = event.data || {};
        if (message.type === "target") {
          const target = message.target || {};
          const hasMeta = Boolean(target.hasMeta);
          const bridgeOk = target.bridgeOk !== false;
          bridgeWarningEl.hidden = !target.bridgeConflict;
          noMetaEl.hidden = hasMeta || !target.name;
          hasMetaEl.hidden = !hasMeta;
          fileNameEl.textContent = target.name || "—";
          pushButton.disabled = !bridgeOk;
          pushButton.title = bridgeOk ? "" : "The bridge is not running in this window.";
          if (!target.name) {
            noMetaEl.hidden = false;
            noMetaEl.textContent = "Open a solution file to push it to LeetCode.";
          } else if (!hasMeta) {
            noMetaEl.textContent = "This file has no LeetCode metadata. Generate it from the Chrome extension first, then reopen this file.";
          }
        } else if (message.type === "status") {
          statusEl.textContent = message.status || "";
          statusEl.className = message.state || "";
        }
      });

      vscodeApi.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

module.exports = { getPushViewHtml };
