const fs = require("fs");
const path = require("path");

const { DEFAULT_SETTINGS } = require("./defaultSettings");
const { sanitizeSettings } = require("./validate");

const SETTINGS_KEY = "leetcodeGenerator.settings";

function createSettingsStore(context) {
  function getSettings() {
    return sanitizeSettings(
      {
        ...DEFAULT_SETTINGS,
        ...(context.globalState.get(SETTINGS_KEY) || {}),
      },
      getValidationOptions()
    );
  }

  async function saveSettings(nextSettings) {
    const merged = sanitizeSettings(
      {
        ...getSettings(),
        ...nextSettings,
      },
      getValidationOptions()
    );
    await context.globalState.update(SETTINGS_KEY, merged);
    return merged;
  }

  // Re-sanitize stored settings (clears missing selected destination / metadataDir)
  // and persist so the options page reflects the cleared fields.
  async function repairInvalidPathsOnBoot() {
    const stored = context.globalState.get(SETTINGS_KEY) || {};
    const repaired = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored }, getValidationOptions());

    if (
      stored.destinationMode !== repaired.destinationMode ||
      stored.destination !== repaired.destination ||
      stored.metadataDir !== repaired.metadataDir
    ) {
      await context.globalState.update(SETTINGS_KEY, repaired);
    }
    return repaired;
  }

  // Resolve the folder for solution files and the parent folder for the .lch metadata
  // folder. Missing configured paths fall back to the workspace root AND are cleared
  // from storage so the user sees an empty field and can debug easily.
  async function resolveUsablePaths(workspaceRoot) {
    const current = getSettings(); // already clears missing paths in-memory
    const stored = context.globalState.get(SETTINGS_KEY) || {};

    const solutionRoot =
      current.destinationMode === "selected" && current.destination && directoryExists(current.destination)
        ? path.resolve(current.destination)
        : requireWorkspace(workspaceRoot);

    const metadataParent =
      current.metadataDir && directoryExists(current.metadataDir)
        ? path.resolve(current.metadataDir)
        : requireWorkspace(workspaceRoot);

    if (
      stored.destinationMode !== current.destinationMode ||
      stored.destination !== current.destination ||
      stored.metadataDir !== current.metadataDir
    ) {
      await context.globalState.update(SETTINGS_KEY, current);
    }

    return { solutionRoot, metadataParent };
  }

  return { getSettings, saveSettings, repairInvalidPathsOnBoot, resolveUsablePaths };
}

function requireWorkspace(workspaceRoot) {
  if (!workspaceRoot) {
    throw new Error("Open a VS Code workspace before generating files.");
  }
  const resolved = path.resolve(workspaceRoot);
  if (!directoryExists(resolved)) {
    throw new Error("The workspace root detected when the bridge started no longer exists.");
  }
  return resolved;
}

function getValidationOptions() {
  return {
    validateDestinationExists: true,
    destinationExists: directoryExists,
  };
}

function directoryExists(directoryPath) {
  if (!directoryPath) {
    return false;
  }
  try {
    return fs.statSync(path.resolve(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { createSettingsStore };
