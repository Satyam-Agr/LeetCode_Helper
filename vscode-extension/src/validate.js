const { DEFAULT_SETTINGS } = require("./defaultSettings");
const { normalizeLanguage } = require("./leetcode");

const SUPPORTED_LANGUAGES = new Set(["java", "python", "cpp", "javascript", "c"]);
const TEMPLATE_VARIABLES = new Set(["id", "title", "slug", "difficulty", "tags", "language", "header", "code"]);
const ALLOWED_KEYS = new Set([
  "language",
  "destinationMode",
  "destination",
  "metadataDir",
  "template",
  "filename",
  "padId",
  "groupByDifficulty",
  "defaultHeaders",
  "languageHeaders",
  "openAfterCreate",
  "autoOpenPushView",
]);
const DESTINATION_MODES = new Set(["workspace", "selected"]);

function validateSettings(settings, options = {}) {
  try {
    sanitizeSettings(settings, options);
    return null;
  } catch (error) {
    return error;
  }
}

function sanitizeSettings(settings, options = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Settings must be an object.");
  }

  for (const key of Object.keys(settings)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }
  }

  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    languageHeaders: {
      ...DEFAULT_SETTINGS.languageHeaders,
      ...(settings.languageHeaders || {}),
    },
  };

  const sanitized = {
    language: normalizeLanguage(merged.language),
    destinationMode: sanitizeDestinationMode(merged.destinationMode),
    destination: sanitizePath(merged.destination, "destination"),
    metadataDir: sanitizePath(merged.metadataDir, "metadataDir"),
    template: requireString(merged.template, "template"),
    filename: requireString(merged.filename, "filename").trim(),
    padId: requireInteger(merged.padId, "padId", 0, 20),
    groupByDifficulty: requireBoolean(merged.groupByDifficulty, "groupByDifficulty"),
    defaultHeaders: requireBoolean(merged.defaultHeaders, "defaultHeaders"),
    openAfterCreate: requireBoolean(merged.openAfterCreate, "openAfterCreate"),
    autoOpenPushView: requireBoolean(merged.autoOpenPushView, "autoOpenPushView"),
    languageHeaders: sanitizeHeaders(merged.languageHeaders),
  };

  if (!SUPPORTED_LANGUAGES.has(sanitized.language)) {
    throw new Error(`Unsupported language: ${merged.language}`);
  }

  if (sanitized.destinationMode === "selected" && !sanitized.destination) {
    sanitized.destinationMode = "workspace";
  }

  // Clear paths that no longer exist so the options page shows an empty field.
  if (options.validateDestinationExists) {
    if (sanitized.destinationMode === "selected" && !options.destinationExists?.(sanitized.destination)) {
      sanitized.destinationMode = "workspace";
      sanitized.destination = "";
    }
    if (sanitized.metadataDir && !options.destinationExists?.(sanitized.metadataDir)) {
      sanitized.metadataDir = "";
    }
  }

  if (sanitized.destinationMode === "workspace") {
    sanitized.destination = "";
  }

  if (/[\\/]/.test(sanitized.filename)) {
    throw new Error("filename cannot contain path separators.");
  }

  validateTemplateVariables(sanitized.filename, "filename");
  validateTemplateVariables(sanitized.template, "template");

  if (!sanitized.template.includes("{code}")) {
    throw new Error("template must include {code}.");
  }

  return sanitized;
}

function sanitizeDestinationMode(value) {
  if (value === undefined || value === null || value === "") {
    return "workspace";
  }
  if (!DESTINATION_MODES.has(value)) {
    throw new Error("destinationMode must be workspace or selected.");
  }
  return value;
}

function sanitizePath(value, name) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (/[\0<>|?*]/.test(trimmed)) {
    throw new Error(`${name} contains invalid path characters.`);
  }
  return trimmed;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("languageHeaders must be an object.");
  }

  const sanitized = {};
  for (const language of SUPPORTED_LANGUAGES) {
    const value = headers[language] ?? "";
    if (typeof value !== "string") {
      throw new Error(`languageHeaders.${language} must be a string.`);
    }
    if (value.length > 10000) {
      throw new Error(`languageHeaders.${language} is too long.`);
    }
    sanitized[language] = value;
  }
  return sanitized;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be true or false.`);
  }
  return value;
}

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function validateTemplateVariables(value, fieldName) {
  const withoutTokens = String(value).replace(/\{[a-z_]+\}/g, "");
  if (/[{}]/.test(withoutTokens)) {
    throw new Error(`${fieldName} variables must use complete {name} syntax.`);
  }

  const matches = String(value).matchAll(/\{([^{}]+)\}/g);
  for (const match of matches) {
    if (!TEMPLATE_VARIABLES.has(match[1])) {
      throw new Error(`${fieldName} contains unknown template variable: {${match[1]}}`);
    }
  }
}

module.exports = { sanitizeSettings, validateSettings };
