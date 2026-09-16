import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "chrome-extension");
const distRoot = path.join(repositoryRoot, "dist");
const requestedOutput = process.argv[2] || path.join("dist", "chrome-extension");
const outputRoot = path.resolve(repositoryRoot, requestedOutput);
const runtimeEntries = ["manifest.json", "options.html", "resources", "src", "styles"];

if (outputRoot === distRoot || !outputRoot.startsWith(`${distRoot}${path.sep}`)) {
  fail(`Chrome staging output must be a child of ${distRoot}.`);
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

for (const entry of runtimeEntries) {
  const source = path.join(sourceRoot, entry);
  const destination = path.join(outputRoot, entry);
  await copyRuntimeEntry(source, destination);
}

const stagedFiles = await listFiles(outputRoot);
if (!stagedFiles.includes("manifest.json")) {
  fail("The staged Chrome extension is missing manifest.json at its root.");
}
for (const blocked of ["node_modules", "test", "e2e", "test-results", "playwright-report", ".git"]) {
  if (stagedFiles.some((file) => file.split("/").includes(blocked))) {
    fail(`The staged Chrome extension unexpectedly contains ${blocked}.`);
  }
}

console.log(`Staged ${stagedFiles.length} Chrome runtime files in ${outputRoot}.`);

async function copyRuntimeEntry(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) {
    fail(`Refusing to package symbolic link: ${source}`);
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const child of await fs.readdir(source)) {
      await copyRuntimeEntry(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  if (!stat.isFile()) {
    fail(`Unsupported runtime entry: ${source}`);
  }
  await fs.copyFile(source, destination);
}

async function listFiles(root) {
  const result = [];
  async function visit(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        result.push(relative);
      } else {
        fail(`Unsupported staged entry: ${relative}`);
      }
    }
  }
  await visit(root);
  return result.sort();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
