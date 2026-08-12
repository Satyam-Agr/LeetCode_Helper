const { DEFAULT_SETTINGS } = require("./defaultSettings");

const SETTINGS_KEY = "leetcodeGenerator.settings";

function createSettingsStore(context) {
  function getSettings() {
    return {
      ...DEFAULT_SETTINGS,
      ...(context.globalState.get(SETTINGS_KEY) || {}),
    };
  }

  async function saveSettings(nextSettings) {
    const merged = {
      ...getSettings(),
      ...nextSettings,
    };
    await context.globalState.update(SETTINGS_KEY, merged);
    return merged;
  }

  return { getSettings, saveSettings };
}

module.exports = { createSettingsStore };
