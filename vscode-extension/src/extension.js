const path = require("path");
const vscode = require("vscode");

const { readServerConfig } = require("./config");
const { generateFromUrl } = require("./generator");
const { createBridgeServer } = require("./server");
const { createSettingsStore } = require("./settingsStore");
const { createMetaStore } = require("./metaStore");
const { extractCodeSection } = require("./codeExtract");
const { PushViewProvider } = require("./pushView");

let bridge = null;
let settingsStore = null;
let metaStore = null;
let pushViewProvider = null;

async function activate(context) {
  settingsStore = createSettingsStore(context);
  metaStore = createMetaStore(context);
  const { port } = readServerConfig();

  bridge = createBridgeServer({
    port,
    settingsStore,
    // Generation writes the solution file and its ".lch" metadata.
    generateFromUrl: (url, workspaceRoot) =>
      generateFromUrl(url, { settingsStore, metaStore, workspaceRoot }),
    getWorkspaceRoot,
    showResult,
    vscode,
    // Reflect bridge availability (e.g. a secondary window) in the sidebar.
    onBridgeStatusChange: () => pushViewProvider?.refresh(),
  });

  await settingsStore.repairInvalidPathsOnBoot();

  pushViewProvider = new PushViewProvider({ getPushTarget, pushActiveFile, resetActiveFile });

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcodeGenerator.generateFromClipboard", generateFromClipboard),
    vscode.commands.registerCommand("leetcodeGenerator.startServer", () => bridge.start(true)),
    vscode.commands.registerCommand("leetcodeGenerator.stopServer", () => bridge.stop()),
    vscode.commands.registerCommand("leetcodeGenerator.serverStatus", () => bridge.status()),
    vscode.commands.registerCommand("leetcodeGenerator.pushToLeetCode", () =>
      pushViewProvider.push(pushViewProvider.currentAction, pushViewProvider.currentCodeOnly)
    ),
    vscode.window.registerWebviewViewProvider("leetcodeGenerator.pushView", pushViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      pushViewProvider?.refresh();
      maybeAutoOpenPushView();
    })
  );

  bridge.start(false);
}

function deactivate() {
  bridge?.stop();
}

async function generateFromClipboard() {
  const url = (await vscode.env.clipboard.readText()).trim();
  if (!url) {
    vscode.window.showErrorMessage("Clipboard is empty.");
    return;
  }

  try {
    const result = await generateFromUrl(url, {
      settingsStore,
      metaStore,
      workspaceRoot: bridge?.getWorkspaceRoot(),
    });
    showResult(result);
    pushViewProvider?.refresh();
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

// Describe the active editor for the push view (no URL is exposed to the webview).
function getPushTarget() {
  const bridgeStatus = bridge ? bridge.getStatusInfo() : { running: false, conflict: false };
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { name: null, hasMeta: false, bridgeOk: bridgeStatus.running, bridgeConflict: bridgeStatus.conflict };
  }
  const filePath = editor.document.uri.fsPath;
  const meta = metaStore.readMeta(filePath);
  return {
    name: path.basename(filePath),
    hasMeta: Boolean(meta),
    bridgeOk: bridgeStatus.running,
    bridgeConflict: bridgeStatus.conflict,
  };
}

// When the "auto-open push view" flag is on, reveal the sidebar as soon as a file
// with linked .lch metadata becomes active.
function maybeAutoOpenPushView() {
  try {
    if (!settingsStore.getSettings().autoOpenPushView) {
      return;
    }
    if (getPushTarget().hasMeta) {
      pushViewProvider?.reveal();
    }
  } catch {
    // best-effort
  }
}

// Push the active file to its linked problem. `codeOnly` extracts just the code
// section; if extraction fails we fall back to the full file and note it.
// `onProgress(stage)` reports intermediate stages (e.g. "opening") to the UI.
async function pushActiveFile(submitAction, codeOnly, onProgress) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("Open a solution file in the editor first.");
  }

  const filePath = editor.document.uri.fsPath;
  const meta = metaStore.readMeta(filePath);
  if (!meta) {
    throw new Error("This file has no LeetCode metadata. Generate it from the Chrome extension first.");
  }

  if (!bridge) {
    throw new Error("The browser bridge is not running.");
  }

  const fullText = editor.document.getText();
  let code = fullText;
  let note = null;

  if (codeOnly) {
    const extracted = extractCodeSection(fullText, meta.codeSnippet, meta.language);
    if (extracted == null) {
      note = "Could not detect the code section; sent the entire file.";
      code = fullText;
    } else {
      code = extracted;
    }
  }

  const result = await bridge.pushCode({ url: meta.url, code, submitAction, onProgress });
  if (note) {
    result.note = note;
  }
  return result;
}

// Regenerate the original template into the active file, overwriting current edits
// (after an explicit confirmation).
async function resetActiveFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("Open a solution file in the editor first.");
  }

  const filePath = editor.document.uri.fsPath;
  const meta = metaStore.readMeta(filePath);
  if (!meta) {
    throw new Error("This file has no LeetCode metadata to reset from.");
  }

  const choice = await vscode.window.showWarningMessage(
    `Reset "${path.basename(filePath)}" to the generated template? This overwrites current changes.`,
    { modal: true },
    "Reset"
  );
  if (choice !== "Reset") {
    return { cancelled: true };
  }

  const document = await vscode.workspace.openTextDocument(filePath);
  const targetEditor = await vscode.window.showTextDocument(document, { preview: false });
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  await targetEditor.edit((builder) => builder.replace(fullRange, meta.content));
  await document.save();
  return { ok: true };
}

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function showResult(result) {
  if (result.status === "skipped") {
    vscode.window.showWarningMessage(`File already exists: ${result.path}`);
  } else {
    vscode.window.showInformationMessage(`Created ${result.problemId}. ${result.title}: ${result.path}`);
  }
}

module.exports = { activate, deactivate };
