const path = require("path");
const vscode = require("vscode");

const { readServerConfig } = require("./config");
const { generateFromUrl } = require("./generator");
const { createBridgeServer } = require("./server");
const { createSettingsStore } = require("./settingsStore");
const { createMetaStore } = require("./metaStore");
const { extractCodeSection } = require("./codeExtract");
const { PushViewProvider } = require("./pushView");
const { createPairingStore } = require("./pairingStore");
const { BRIDGE_PROTOCOL_VERSION, CAPABILITIES } = require("./protocol");
const { buildDiagnosticsReport } = require("./diagnostics");

let bridge = null;
let settingsStore = null;
let metaStore = null;
let pushViewProvider = null;
let outputChannel = null;
let pairingStore = null;

async function activate(context) {
  settingsStore = createSettingsStore(context);
  outputChannel = vscode.window.createOutputChannel("LeetCode Helper");
  context.subscriptions.push(outputChannel);
  const log = createLogger(outputChannel);
  metaStore = createMetaStore(context, {
    getMetadataParent: () => {
      const configured = settingsStore.getSettings().metadataDir;
      return configured || getWorkspaceRoot();
    },
    log,
  });
  pairingStore = createPairingStore(context);
  const { port } = readServerConfig();

  bridge = createBridgeServer({
    port,
    settingsStore,
    // Generation writes the solution file and its ".lch" metadata.
    generateFromUrl: (url, workspaceRoot, requestId) =>
      generateFromUrl(url, { settingsStore, metaStore, workspaceRoot, requestId, log }),
    getWorkspaceRoot,
    showResult,
    vscode,
    log,
    // Reflect bridge availability (e.g. a secondary window) in the sidebar.
    onBridgeStatusChange: () => void pushViewProvider?.refresh(),
    getAuthToken: () => pairingStore.getToken(),
    extensionVersion: context.extension?.packageJSON?.version || "unknown",
  });

  // Bind before awaited setup so a Chrome click made during VS Code startup can connect.
  bridge.start(false);
  await pairingStore.ready;
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
    vscode.commands.registerCommand("leetcodeGenerator.rotatePairingToken", rotatePairingToken),
    vscode.commands.registerCommand("leetcodeGenerator.runDiagnostics", runDiagnostics),
    vscode.window.registerWebviewViewProvider("leetcodeGenerator.pushView", pushViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void pushViewProvider?.refresh();
      void maybeAutoOpenPushView();
    })
  );

}

async function rotatePairingToken() {
  const choice = await vscode.window.showWarningMessage(
    "Rotate the LeetCode Helper authentication token? Chrome will reconnect automatically.",
    { modal: true },
    "Rotate Token"
  );
  if (choice !== "Rotate Token") {
    return;
  }
  await pairingStore.rotateToken();
  vscode.window.showInformationMessage(
    "Authentication token rotated. Chrome will pair again automatically on its next request."
  );
  pushViewProvider?.refresh();
}

async function runDiagnostics() {
  const checkedAt = new Date();
  const diagnostics = bridge?.getDiagnostics?.() || null;
  const workspaceRoot = getWorkspaceRoot();
  const settings = settingsStore?.getSettings?.() || {};
  const target = await getPushTarget();
  let resolvedPaths = null;
  let pathError = null;

  try {
    resolvedPaths = await settingsStore.resolveUsablePaths(workspaceRoot);
  } catch (error) {
    pathError = error.message;
  }

  const lines = buildDiagnosticsReport({
    checkedAt,
    diagnostics,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    capabilities: CAPABILITIES,
    tokenFingerprint: pairingStore?.fingerprint?.(),
    workspaceRoot,
    settings,
    target,
    resolvedPaths,
    pathError,
    metadataDiagnostics: metaStore?.getDiagnostics?.() || null,
  });

  outputChannel.appendLine("");
  for (const line of lines) {
    outputChannel.appendLine(line);
  }
  outputChannel.show(true);
  vscode.window.showInformationMessage("LeetCode Helper diagnostics written to the Output panel.");
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
    const requestId = `clipboard-${Date.now()}`;
    const result = await generateFromUrl(url, {
      settingsStore,
      metaStore,
      workspaceRoot: getWorkspaceRoot(),
      requestId,
      log: createLogger(outputChannel),
    });
    showResult(result);
    void pushViewProvider?.refresh();
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

// Describe the active editor for the push view (no URL is exposed to the webview).
async function getPushTarget() {
  const bridgeStatus = bridge ? bridge.getStatusInfo() : { running: false, conflict: false };
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { name: null, hasMeta: false, bridgeOk: bridgeStatus.running, bridgeConflict: bridgeStatus.conflict };
  }
  const filePath = editor.document.uri.fsPath;
  const lookup = await metaStore.findMeta(filePath);
  const meta = lookup.status === "found" ? lookup.meta : null;
  return {
    name: path.basename(filePath),
    hasMeta: Boolean(meta),
    language: meta?.language || null,
    bridgeOk: bridgeStatus.running,
    bridgeConflict: bridgeStatus.conflict,
    metadataStatus: lookup.status,
    metadataMessage: lookup.status === "found" ? null : lookup.message,
    metadataSource: lookup.source || null,
    metadataMigrated: Boolean(lookup.migrated),
  };
}

// When the "auto-open push view" flag is on, reveal the sidebar as soon as a file
// with linked .lch metadata becomes active.
async function maybeAutoOpenPushView() {
  try {
    if (!settingsStore.getSettings().autoOpenPushView) {
      return;
    }
    if ((await getPushTarget()).hasMeta) {
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
  const lookup = await metaStore.findMeta(filePath);
  if (lookup.status !== "found") {
    throw new Error(lookup.message || "This file has no LeetCode metadata. Generate it from Chrome first.");
  }
  const meta = lookup.meta;

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

  const result = await bridge.pushCode({
    url: meta.url,
    code,
    language: meta.language || null,
    submitAction,
    onProgress,
  });
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
  const lookup = await metaStore.findMeta(filePath);
  if (lookup.status !== "found") {
    throw new Error(lookup.message || "This file has no LeetCode metadata to reset from.");
  }
  const meta = lookup.meta;

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

function createLogger(channel) {
  return (event, details = {}) => {
    if (!channel) {
      return;
    }
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : "";
    channel.appendLine(`${new Date().toISOString()} ${event}${suffix}`);
  };
}

module.exports = { activate, deactivate };
