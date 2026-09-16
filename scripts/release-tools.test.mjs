import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(repositoryRoot, "scripts", "validate-release.mjs");
const preparer = path.join(repositoryRoot, "scripts", "prepare-version.mjs");
const currentVersion = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, "vscode-extension", "package.json"), "utf8")
).version;
const currentTag = `v${currentVersion}`;
const requiredFiles = [
  "chrome-extension/manifest.json",
  "chrome-extension/package.json",
  "chrome-extension/package-lock.json",
  "chrome-extension/src/protocol.js",
  "vscode-extension/package.json",
  "vscode-extension/package-lock.json",
  "vscode-extension/src/protocol.js",
];

test("release validation accepts synchronized stable metadata", async (t) => {
  const fixture = await createFixture(t);
  const result = validate(fixture, currentTag);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`valid for v${currentVersion.replaceAll(".", "\\.")}`));
});

test("release validation rejects component version drift", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "chrome-extension", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.version = "9.9.9";
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  const result = validate(fixture, currentTag);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});

test("release validation rejects pre-release tags", async (t) => {
  const fixture = await createFixture(t);
  const result = validate(fixture, `${currentTag}-beta.1`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stable vMAJOR\.MINOR\.PATCH/);
});

test("release validation rejects a changed Chrome identity", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "chrome-extension", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.key = Buffer.from("different-public-key").toString("base64").repeat(8);
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  const result = validate(fixture, currentTag);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest key produces/);
});

test("version preparation updates every release version together", async (t) => {
  const fixture = await createFixture(t);
  const prepared = spawnSync(process.execPath, [preparer, "9.8.7", "--root", fixture], {
    encoding: "utf8",
  });
  assert.equal(prepared.status, 0, prepared.stderr);

  const result = validate(fixture, "v9.8.7");
  assert.equal(result.status, 0, result.stderr);
});

test("release validation accepts a completed custom notes file", async (t) => {
  const fixture = await createFixture(t);
  const notesPath = path.join(fixture, ".github", "release-notes", `${currentTag}.md`);
  await fs.mkdir(path.dirname(notesPath), { recursive: true });
  await fs.writeFile(notesPath, "## Highlights\n\nA carefully described release.\n", "utf8");

  const result = validate(fixture, currentTag);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Custom release notes:/);
});

test("release validation rejects unfinished custom notes", async (t) => {
  const fixture = await createFixture(t);
  const notesPath = path.join(fixture, ".github", "release-notes", `${currentTag}.md`);
  await fs.mkdir(path.dirname(notesPath), { recursive: true });
  await fs.writeFile(notesPath, "## Highlights\n\nTODO: describe this release.\n", "utf8");

  const result = validate(fixture, currentTag);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /template placeholder/);
});

test("release validation rejects an empty custom notes file", async (t) => {
  const fixture = await createFixture(t);
  const notesPath = path.join(fixture, ".github", "release-notes", `${currentTag}.md`);
  await fs.mkdir(path.dirname(notesPath), { recursive: true });
  await fs.writeFile(notesPath, "\n", "utf8");

  const result = validate(fixture, currentTag);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is empty/);
});

function validate(fixture, tag) {
  return spawnSync(process.execPath, [validator, "--root", fixture, "--tag", tag], {
    encoding: "utf8",
  });
}

async function createFixture(t) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "leetcode-release-test-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  for (const relativePath of requiredFiles) {
    const destination = path.join(fixture, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(repositoryRoot, relativePath), destination);
  }
  return fixture;
}
