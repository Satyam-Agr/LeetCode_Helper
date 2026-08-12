const fs = require("fs");
const path = require("path");

const { DEFAULT_SETTINGS } = require("./defaultSettings");
const { sanitizeSettings } = require("./validate");

const SETTINGS_KEY = "leetcodeGenerator.settings";

function createSettingsStore(context) {
  function getSettings() {
    return sanitizeSettings({
      ...DEFAULT_SETTINGS,
      ...(context.globalState.get(SETTINGS_KEY) || {}),
    }, getValidationOptions());
  }

  async function saveSettings(nextSettings) {
    const merged = sanitizeSettings({
      ...getSettings(),
      ...nextSettings,
    }, getValidationOptions());
    await context.globalState.update(SETTINGS_KEY, merged);
    return merged;
  }

  async function repairInvalidDestinationOnBoot() {
    const stored = context.globalState.get(SETTINGS_KEY) || {};
    const repaired = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
    }, getValidationOptions());

    if (
      stored.destinationMode !== repaired.destinationMode ||
      stored.destination !== repaired.destination
    ) {
      await context.globalState.update(SETTINGS_KEY, repaired);
    }
    return repaired;
  }

  return { getSettings, saveSettings, repairInvalidDestinationOnBoot };
}

function getValidationOptions() {
  return {
    validateDestinationExists: true,
    destinationExists,
  };
}

function destinationExists(destination) {
  if (!destination) {
    return false;
  }

  try {
    return fs.statSync(path.resolve(destination)).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { createSettingsStore };
