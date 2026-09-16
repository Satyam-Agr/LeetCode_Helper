const crypto = require("crypto");

const PAIRING_TOKEN_KEY = "leetcodeGenerator.pairingToken";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function createPairingStore(context) {
  let token = normalizeToken(context.globalState.get(PAIRING_TOKEN_KEY));
  let ready = Promise.resolve();
  if (!token) {
    token = createToken();
    // Keep activation synchronous so the bridge can bind immediately. VS Code's
    // globalState update is queued and the in-memory token is already usable.
    ready = Promise.resolve(context.globalState.update(PAIRING_TOKEN_KEY, token));
  }

  function getToken() {
    // VS Code global state is shared by extension hosts. Refresh on every bridge
    // authentication so a secondary window observes rotations made by the current
    // port owner before it later takes over the port.
    const sharedToken = normalizeToken(context.globalState.get(PAIRING_TOKEN_KEY));
    if (sharedToken) {
      token = sharedToken;
    }
    return token;
  }

  async function rotateToken() {
    token = createToken();
    await context.globalState.update(PAIRING_TOKEN_KEY, token);
    return token;
  }

  function fingerprint() {
    return crypto.createHash("sha256").update(getToken()).digest("hex").slice(0, 12);
  }

  return { getToken, rotateToken, fingerprint, ready };
}

function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

module.exports = { createPairingStore, PAIRING_TOKEN_KEY };
