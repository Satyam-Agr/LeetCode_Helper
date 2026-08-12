const vscode = require("vscode");

const { readServerConfig } = require("./config");
const { generateFromUrl } = require("./generator");
const { createBridgeServer } = require("./server");
const { createSettingsStore } = require("./settingsStore");

let bridge = null;
let activeSettingsStore = null;

async function activate(context) {
  const settingsStore = createSettingsStore(context);
  activeSettingsStore = settingsStore;
  const { port } = readServerConfig();

  bridge = createBridgeServer({
    port,
    settingsStore,
    generateFromUrl: (url, workspaceRoot) => generateFromUrl(url, settingsStore, workspaceRoot),
    getWorkspaceRoot,
    showResult,
    vscode,
  });

  await settingsStore.repairInvalidDestinationOnBoot();

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcodeGenerator.generateFromClipboard", generateFromClipboard),
    vscode.commands.registerCommand("leetcodeGenerator.startServer", () => bridge.start(true)),
    vscode.commands.registerCommand("leetcodeGenerator.stopServer", () => bridge.stop()),
    vscode.commands.registerCommand("leetcodeGenerator.serverStatus", () => bridge.status())
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
    const result = await bridgeGenerate(url);
    showResult(result);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

async function bridgeGenerate(url) {
  if (!activeSettingsStore) {
    throw new Error("LeetCode browser bridge is not ready.");
  }
  return generateFromUrl(url, activeSettingsStore, bridge?.getWorkspaceRoot());
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
