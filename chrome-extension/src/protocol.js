// Change this only when the Chrome <-> VS Code wire contract becomes
// incompatible. It must match vscode-extension/src/protocol.js.
export const BRIDGE_PROTOCOL_VERSION = 3;
export const HEADER_PROTOCOL = "X-LeetCode-Helper-Protocol";
export const HEADER_TOKEN = "X-LeetCode-Helper-Token";
export const EXPECTED_EXTENSION_ID = "nceakpghgicobckbbpnhfajkeelimpic";

export const CAPABILITIES = [
  "generate-idempotency",
  "push-acknowledgement",
  "language-guard",
  "diagnostics",
  "token-auth",
  "automatic-pairing",
];
