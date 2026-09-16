// Change this only when the Chrome <-> VS Code wire contract becomes
// incompatible. It must match chrome-extension/src/protocol.js.
const BRIDGE_PROTOCOL_VERSION = 3;
const HEADER_PROTOCOL = "x-leetcode-helper-protocol";
const HEADER_TOKEN = "x-leetcode-helper-token";
const EXPECTED_CHROME_EXTENSION_ID = "nceakpghgicobckbbpnhfajkeelimpic";
const EXPECTED_CHROME_EXTENSION_ORIGIN = `chrome-extension://${EXPECTED_CHROME_EXTENSION_ID}`;
const CAPABILITIES = [
  "generate-idempotency",
  "push-acknowledgement",
  "language-guard",
  "diagnostics",
  "token-auth",
  "automatic-pairing",
];

module.exports = {
  BRIDGE_PROTOCOL_VERSION,
  HEADER_PROTOCOL,
  HEADER_TOKEN,
  EXPECTED_CHROME_EXTENSION_ID,
  EXPECTED_CHROME_EXTENSION_ORIGIN,
  CAPABILITIES,
};
