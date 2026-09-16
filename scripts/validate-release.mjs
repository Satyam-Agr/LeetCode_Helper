import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const argumentsList = process.argv.slice(2);
const repositoryRoot = path.resolve(readOption(argumentsList, "--root") || defaultRepositoryRoot);
const expectedTag = readTagArgument(argumentsList);

const chromeManifest = await readJson("chrome-extension/manifest.json");
const chromePackage = await readJson("chrome-extension/package.json");
const chromeLock = await readJson("chrome-extension/package-lock.json");
const vscodePackage = await readJson("vscode-extension/package.json");
const vscodeLock = await readJson("vscode-extension/package-lock.json");

const versions = new Map([
  ["Chrome manifest", chromeManifest.version],
  ["Chrome package", chromePackage.version],
  ["Chrome lockfile", chromeLock.version],
  ["Chrome lockfile root package", chromeLock.packages?.[""]?.version],
  ["VS Code package", vscodePackage.version],
  ["VS Code lockfile", vscodeLock.version],
  ["VS Code lockfile root package", vscodeLock.packages?.[""]?.version],
]);

const version = vscodePackage.version;
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  fail(`VS Code package version must be stable major.minor.patch; received ${JSON.stringify(version)}.`);
}
for (const [label, candidate] of versions) {
  if (candidate !== version) {
    fail(`${label} version ${JSON.stringify(candidate)} does not match ${version}.`);
  }
}
if (expectedTag && expectedTag !== `v${version}`) {
  fail(`Release tag ${expectedTag} does not match package version v${version}.`);
}
if (expectedTag) {
  await validateCustomReleaseNotes(expectedTag);
}

const chromeProtocol = await import(
  pathToFileURL(path.join(repositoryRoot, "chrome-extension/src/protocol.js")).href
);
const vscodeProtocol = require(path.join(repositoryRoot, "vscode-extension/src/protocol.js"));
if (chromeProtocol.BRIDGE_PROTOCOL_VERSION !== vscodeProtocol.BRIDGE_PROTOCOL_VERSION) {
  fail(
    `Bridge protocol mismatch: Chrome=${chromeProtocol.BRIDGE_PROTOCOL_VERSION}, ` +
      `VS Code=${vscodeProtocol.BRIDGE_PROTOCOL_VERSION}.`
  );
}

if (typeof chromeManifest.key !== "string" || chromeManifest.key.length < 100) {
  fail("Chrome manifest is missing the stable public key.");
}
const derivedExtensionId = chromeExtensionId(chromeManifest.key);
for (const [label, expectedId] of [
  ["Chrome protocol", chromeProtocol.EXPECTED_EXTENSION_ID],
  ["VS Code protocol", vscodeProtocol.EXPECTED_CHROME_EXTENSION_ID],
]) {
  if (derivedExtensionId !== expectedId) {
    fail(`${label} expects ${expectedId}, but the manifest key produces ${derivedExtensionId}.`);
  }
}

console.log(`Release metadata is valid for v${version}.`);
console.log(`Bridge protocol: ${chromeProtocol.BRIDGE_PROTOCOL_VERSION}`);
console.log(`Chrome extension ID: ${derivedExtensionId}`);

async function readJson(relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(repositoryRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`Could not read ${relativePath}: ${error.message}`);
  }
}

async function validateCustomReleaseNotes(tag) {
  const relativePath = `.github/release-notes/${tag}.md`;
  const filePath = path.join(repositoryRoot, relativePath);
  let contents;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`No custom release notes found at ${relativePath}; generated notes will be used.`);
      return;
    }
    fail(`Could not read ${relativePath}: ${error.message}`);
  }
  if (!contents.trim()) {
    fail(`${relativePath} is empty. Remove it or add the custom release description.`);
  }
  if (Buffer.byteLength(contents, "utf8") > 64 * 1024) {
    fail(`${relativePath} exceeds the 64 KiB custom release-notes limit.`);
  }
  if (/\{\{[^}]+\}\}|REPLACE_ME|TODO:/i.test(contents)) {
    fail(`${relativePath} still contains a template placeholder.`);
  }
  console.log(`Custom release notes: ${relativePath}`);
}

function readTagArgument(argumentsList) {
  const tag = readOption(argumentsList, "--tag");
  if (!tag) {
    return "";
  }
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail(`Release tag must be stable vMAJOR.MINOR.PATCH; received ${tag}.`);
  }
  return tag;
}

function readOption(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? "" : String(argumentsList[index + 1] || "").trim();
}

function chromeExtensionId(base64Key) {
  let publicKey;
  try {
    publicKey = Buffer.from(base64Key, "base64");
  } catch (error) {
    fail(`Chrome manifest key is not valid base64: ${error.message}`);
  }
  const alphabet = "abcdefghijklmnop";
  return [...crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16)]
    .flatMap((byte) => [alphabet[byte >> 4], alphabet[byte & 15]])
    .join("");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
