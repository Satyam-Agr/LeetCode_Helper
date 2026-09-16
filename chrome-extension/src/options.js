import {
  chooseFolder,
  getBridgeHealth,
  getSettings,
  saveSettings,
} from "./http.js";
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES, TEMPLATE_VARIABLES } from "./options.defaults.js";

const statusEl = document.querySelector("#status");
const formEl = document.querySelector("#settingsForm");
const reloadButton = document.querySelector("#reload");
const resetButton = document.querySelector("#reset");
const saveButton = document.querySelector("#save");
const chooseDestinationButton = document.querySelector("#chooseDestination");
const selectedDestinationField = document.querySelector("#selectedDestinationField");
const chooseMetadataButton = document.querySelector("#chooseMetadata");
const clearMetadataButton = document.querySelector("#clearMetadata");
const testConnectionButton = document.querySelector("#testConnection");

const fields = {
  language: document.querySelector("#language"),
  destinationModeWorkspace: document.querySelector("#destinationModeWorkspace"),
  destinationModeSelected: document.querySelector("#destinationModeSelected"),
  destination: document.querySelector("#destination"),
  metadataDir: document.querySelector("#metadataDir"),
  filename: document.querySelector("#filename"),
  padId: document.querySelector("#padId"),
  groupByDifficulty: document.querySelector("#groupByDifficulty"),
  defaultHeaders: document.querySelector("#defaultHeaders"),
  openAfterCreate: document.querySelector("#openAfterCreate"),
  autoOpenPushView: document.querySelector("#autoOpenPushView"),
  template: document.querySelector("#template"),
  headerJava: document.querySelector("#headerJava"),
  headerPython: document.querySelector("#headerPython"),
  headerCpp: document.querySelector("#headerCpp"),
  headerJavascript: document.querySelector("#headerJavascript"),
  headerC: document.querySelector("#headerC"),
};

reloadButton.addEventListener("click", load);
resetButton.addEventListener("click", reset);
saveButton.addEventListener("click", save);
chooseDestinationButton.addEventListener("click", chooseDestination);
chooseMetadataButton.addEventListener("click", chooseMetadata);
clearMetadataButton.addEventListener("click", clearMetadata);
testConnectionButton.addEventListener("click", testConnection);
formEl.addEventListener("input", () => {
  updateDestinationVisibility();
  validateForm(false);
});

load();

async function load() {
  setStatus("Checking VS Code connection...");
  try {
    const health = await getBridgeHealth();
    const settings = await getSettings();
    fillForm({ ...DEFAULT_SETTINGS, ...settings });
    validateForm(false);
    setStatus(`Connected to VS Code ${health.extensionVersion} (protocol ${health.protocolVersion}).`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function testConnection() {
  setStatus("Testing VS Code connection...");
  try {
    const health = await getBridgeHealth();
    setStatus(`Connection healthy: VS Code ${health.extensionVersion}, protocol ${health.protocolVersion}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function save() {
  setStatus("Saving settings...");
  try {
    validateForm(true);
    if (!formEl.checkValidity()) {
      setStatus("Fix the highlighted settings before saving.", true);
      return;
    }

    const settings = readForm();
    const saved = await saveSettings(settings);
    fillForm(saved);
    validateForm(false);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function chooseDestination() {
  setStatus("Choosing solution folder...");
  try {
    const destination = await chooseFolder();
    fields.destinationModeSelected.checked = true;
    fields.destination.value = destination;
    updateDestinationVisibility();
    validateForm(false);
    setStatus("Solution folder selected.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function chooseMetadata() {
  setStatus("Choosing metadata folder...");
  try {
    fields.metadataDir.value = await chooseFolder();
    validateForm(false);
    setStatus("Metadata folder selected.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function clearMetadata() {
  fields.metadataDir.value = "";
  validateForm(false);
  setStatus("Metadata folder cleared. It will use the workspace root.");
}

function reset() {
  fillForm(DEFAULT_SETTINGS);
  validateForm(false);
  setStatus("Defaults loaded. Click Save to apply them.");
}

function fillForm(settings) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    languageHeaders: {
      ...DEFAULT_SETTINGS.languageHeaders,
      ...(settings.languageHeaders || {}),
    },
  };

  fields.language.value = merged.language;
  fields.destinationModeWorkspace.checked = merged.destinationMode !== "selected";
  fields.destinationModeSelected.checked = merged.destinationMode === "selected";
  fields.destination.value = merged.destination;
  fields.metadataDir.value = merged.metadataDir;
  fields.filename.value = merged.filename;
  fields.padId.value = String(merged.padId);
  fields.groupByDifficulty.checked = Boolean(merged.groupByDifficulty);
  fields.defaultHeaders.checked = Boolean(merged.defaultHeaders);
  fields.openAfterCreate.checked = Boolean(merged.openAfterCreate);
  fields.autoOpenPushView.checked = Boolean(merged.autoOpenPushView);
  fields.template.value = merged.template;
  fields.headerJava.value = merged.languageHeaders.java || "";
  fields.headerPython.value = merged.languageHeaders.python || "";
  fields.headerCpp.value = merged.languageHeaders.cpp || "";
  fields.headerJavascript.value = merged.languageHeaders.javascript || "";
  fields.headerC.value = merged.languageHeaders.c || "";
  updateDestinationVisibility();
}

function readForm() {
  const destinationMode = fields.destinationModeSelected.checked ? "selected" : "workspace";
  return {
    language: fields.language.value,
    destinationMode,
    destination: destinationMode === "selected" ? fields.destination.value.trim() : "",
    metadataDir: fields.metadataDir.value.trim(),
    template: fields.template.value,
    filename: fields.filename.value.trim(),
    padId: Number(fields.padId.value),
    groupByDifficulty: fields.groupByDifficulty.checked,
    defaultHeaders: fields.defaultHeaders.checked,
    openAfterCreate: fields.openAfterCreate.checked,
    autoOpenPushView: fields.autoOpenPushView.checked,
    languageHeaders: {
      java: fields.headerJava.value,
      python: fields.headerPython.value,
      cpp: fields.headerCpp.value,
      javascript: fields.headerJavascript.value,
      c: fields.headerC.value,
    },
  };
}

function validateForm(showBrowserMessages) {
  clearCustomValidity();

  if (!SUPPORTED_LANGUAGES.has(fields.language.value)) {
    fields.language.setCustomValidity("Choose a supported language.");
  }

  if (fields.destinationModeSelected.checked && !fields.destination.value.trim()) {
    fields.destination.setCustomValidity("Choose a solution folder or use workspace root.");
  } else if (/[\0<>|?*]/.test(fields.destination.value)) {
    fields.destination.setCustomValidity("Solution folder contains invalid path characters.");
  }

  if (/[\0<>|?*]/.test(fields.metadataDir.value)) {
    fields.metadataDir.setCustomValidity("Metadata folder contains invalid path characters.");
  }

  if (!fields.filename.value.trim()) {
    fields.filename.setCustomValidity("Filename pattern is required.");
  } else if (/[\\/]/.test(fields.filename.value)) {
    fields.filename.setCustomValidity("Filename pattern cannot contain path separators.");
  } else {
    const error = validateTemplateVariables(fields.filename.value);
    if (error) {
      fields.filename.setCustomValidity(error);
    }
  }

  const padId = Number(fields.padId.value);
  if (!Number.isInteger(padId) || padId < 0 || padId > 20) {
    fields.padId.setCustomValidity("Pad ID must be an integer from 0 to 20.");
  }

  if (!fields.template.value.trim()) {
    fields.template.setCustomValidity("Template is required.");
  } else if (!fields.template.value.includes("{code}")) {
    fields.template.setCustomValidity("Template must include {code}.");
  } else {
    const error = validateTemplateVariables(fields.template.value);
    if (error) {
      fields.template.setCustomValidity(error);
    }
  }

  for (const field of [
    fields.headerJava,
    fields.headerPython,
    fields.headerCpp,
    fields.headerJavascript,
    fields.headerC,
  ]) {
    if (field.value.length > 10000) {
      field.setCustomValidity("Header snippets must stay under 10,000 characters.");
    }
  }

  if (showBrowserMessages) {
    formEl.reportValidity();
  }
}

function updateDestinationVisibility() {
  const useSelectedDestination = fields.destinationModeSelected.checked;
  selectedDestinationField.classList.toggle("hidden", !useSelectedDestination);
  fields.destination.disabled = !useSelectedDestination;
  chooseDestinationButton.disabled = !useSelectedDestination;
}

function clearCustomValidity() {
  for (const field of Object.values(fields)) {
    field.setCustomValidity("");
  }
}

function validateTemplateVariables(value) {
  const withoutTokens = value.replace(/\{[a-z_]+\}/g, "");
  if (/[{}]/.test(withoutTokens)) {
    return "Template variables must use complete {name} syntax.";
  }

  const matches = value.matchAll(/\{([^{}]+)\}/g);
  for (const match of matches) {
    if (!TEMPLATE_VARIABLES.has(match[1])) {
      return `Unknown template variable: {${match[1]}}.`;
    }
  }
  return "";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
