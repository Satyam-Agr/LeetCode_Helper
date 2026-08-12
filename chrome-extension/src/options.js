import { getSettings, saveSettings } from "./api.js";

const statusEl = document.querySelector("#status");
const settingsEl = document.querySelector("#settings");
const reloadButton = document.querySelector("#reload");
const saveButton = document.querySelector("#save");

reloadButton.addEventListener("click", load);
saveButton.addEventListener("click", save);

load();

async function load() {
  setStatus("Loading settings...");
  try {
    const settings = await getSettings();
    settingsEl.value = JSON.stringify(settings, null, 2);
    setStatus("Settings loaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function save() {
  setStatus("Saving settings...");
  try {
    const settings = JSON.parse(settingsEl.value);
    const saved = await saveSettings(settings);
    settingsEl.value = JSON.stringify(saved, null, 2);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
