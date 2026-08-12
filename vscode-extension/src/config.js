const fs = require("fs");
const path = require("path");

function readServerConfig() {
  const configPath = path.resolve(__dirname, "..", "config.json");
  const fallback = { port: 8765 };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { port: raw.port ?? fallback.port };
  } catch {
    return fallback;
  }
}

module.exports = { readServerConfig };
