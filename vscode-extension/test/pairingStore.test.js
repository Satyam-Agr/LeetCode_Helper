const test = require("node:test");
const assert = require("node:assert/strict");

const { createPairingStore, PAIRING_TOKEN_KEY } = require("../src/pairingStore");

function createContext(initial = {}) {
  const values = { ...initial };
  return {
    values,
    globalState: {
      get: (key) => values[key],
      update: async (key, value) => {
        values[key] = value;
      },
    },
  };
}

test("pairing store creates and persists a high-entropy token", async () => {
  const context = createContext();
  const store = createPairingStore(context);
  await store.ready;

  assert.match(store.getToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(context.values[PAIRING_TOKEN_KEY], store.getToken());
  assert.match(store.fingerprint(), /^[a-f0-9]{12}$/);
});

test("pairing token remains stable until explicitly rotated", async () => {
  const initial = "c".repeat(43);
  const context = createContext({ [PAIRING_TOKEN_KEY]: initial });
  const store = createPairingStore(context);

  assert.equal(store.getToken(), initial);
  const rotated = await store.rotateToken();
  assert.notEqual(rotated, initial);
  assert.equal(context.values[PAIRING_TOKEN_KEY], rotated);
});

test("pairing store refreshes a token rotated by another VS Code window", () => {
  const initial = "f".repeat(43);
  const replacement = "g".repeat(43);
  const context = createContext({ [PAIRING_TOKEN_KEY]: initial });
  const store = createPairingStore(context);

  context.values[PAIRING_TOKEN_KEY] = replacement;

  assert.equal(store.getToken(), replacement);
});
