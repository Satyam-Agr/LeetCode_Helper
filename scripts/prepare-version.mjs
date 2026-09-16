import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const requested = String(argumentsList[0] || "").replace(/^v/, "");
const rootIndex = argumentsList.indexOf("--root");
const repositoryRoot = path.resolve(
  rootIndex === -1 ? defaultRepositoryRoot : String(argumentsList[rootIndex + 1] || "")
);

if (!/^\d+\.\d+\.\d+$/.test(requested)) {
  fail("Usage: node scripts/prepare-version.mjs <major.minor.patch> [--root <repository>]");
}

if (rootIndex !== -1 && !argumentsList[rootIndex + 1]) {
  fail("--root requires a repository path.");
}

const files = [
  ["chrome-extension/manifest.json", updateVersion],
  ["chrome-extension/package.json", updateVersion],
  ["chrome-extension/package-lock.json", updateLockVersion],
  ["vscode-extension/package.json", updateVersion],
  ["vscode-extension/package-lock.json", updateLockVersion],
];

for (const [relativePath, updater] of files) {
  const filePath = path.join(repositoryRoot, relativePath);
  const document = JSON.parse(await fs.readFile(filePath, "utf8"));
  updater(document, requested, relativePath);
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`Updated ${relativePath} to ${requested}`);
}

console.log("\nNext steps:");
console.log(`  Optional notes: .github/release-notes/v${requested}.md`);
console.log("  node scripts/validate-release.mjs");
console.log(`  git commit -am \"Release ${requested}\"`);
console.log(`  git tag v${requested}`);
console.log(`  git push origin main v${requested}`);

function updateVersion(document, version, relativePath) {
  if (typeof document.name !== "string" || !document.name) {
    fail(`${relativePath} does not look like a package or manifest.`);
  }
  document.version = version;
}

function updateLockVersion(document, version, relativePath) {
  if (!document.packages?.[""]) {
    fail(`${relativePath} does not contain the root lockfile package.`);
  }
  document.version = version;
  document.packages[""].version = version;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
