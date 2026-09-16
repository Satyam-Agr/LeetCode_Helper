const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BRIDGE_PROTOCOL_VERSION,
  EXPECTED_CHROME_EXTENSION_ID,
} = require("../src/protocol");

const chromeRoot = path.resolve(__dirname, "..", "..", "chrome-extension");

test("Chrome and VS Code declare the same bridge protocol version", () => {
  const chromeProtocol = fs.readFileSync(path.join(chromeRoot, "src", "protocol.js"), "utf8");
  const match = chromeProtocol.match(/BRIDGE_PROTOCOL_VERSION\s*=\s*(\d+)/);

  assert.ok(match, "Chrome protocol version declaration was not found");
  assert.equal(Number(match[1]), BRIDGE_PROTOCOL_VERSION);
});

test("manifest public key produces the server's allowed Chrome extension ID", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(chromeRoot, "manifest.json"), "utf8"));
  const digest = crypto.createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest();
  const alphabet = "abcdefghijklmnop";
  let derivedId = "";
  for (const byte of digest.subarray(0, 16)) {
    derivedId += alphabet[byte >> 4] + alphabet[byte & 15];
  }

  assert.equal(derivedId, EXPECTED_CHROME_EXTENSION_ID);
});
