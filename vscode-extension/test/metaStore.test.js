const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createMetaStore } = require("../src/metaStore");
const { canonicalMetadataFileName, createMetadata } = require("../src/metadataSchema");

function createContext(initial = {}) {
  let state = structuredClone(initial);
  return {
    globalState: {
      get(key) {
        return state[key];
      },
      async update(key, value) {
        // Yield once to expose lost-update bugs in concurrent callers.
        await Promise.resolve();
        state = { ...state, [key]: structuredClone(value) };
      },
    },
    state: () => structuredClone(state),
  };
}

function rawMeta(overrides = {}) {
  return {
    url: "https://leetcode.com/problems/two-sum/",
    slug: "two-sum",
    problemId: "1",
    title: "Two Sum",
    difficulty: "Easy",
    tags: ["Array"],
    language: "cpp",
    template: "{code}",
    codeSnippet: "class Solution {};",
    header: "",
    content: "class Solution {};",
    ...overrides,
  };
}

async function makeRoot(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lch-meta-test-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, ".lch"), { recursive: true });
  return root;
}

async function writeJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("writes collision-safe v2 metadata for same-named solutions", async (t) => {
  const root = await makeRoot(t);
  const first = path.join(root, "a", "solution.cpp");
  const second = path.join(root, "b", "solution.cpp");
  await fs.promises.mkdir(path.dirname(first), { recursive: true });
  await fs.promises.mkdir(path.dirname(second), { recursive: true });
  await fs.promises.writeFile(first, "first");
  await fs.promises.writeFile(second, "second");
  const store = createMetaStore(createContext(), { getMetadataParent: () => root });

  const firstMeta = await store.writeMeta(root, first, rawMeta());
  const secondMeta = await store.writeMeta(root, second, rawMeta());

  assert.notEqual(firstMeta, secondMeta);
  assert.match(path.basename(firstMeta), /^0001-two-sum--cpp--[a-f0-9]{12}\.lch$/);
  const firstData = JSON.parse(await fs.promises.readFile(firstMeta, "utf8"));
  assert.equal(firstData.version, 2);
  assert.equal(firstData.solutionRelativePath, "a/solution.cpp");
  assert.equal(firstData.metadataId.length, 64);
});

test("rediscovers metadata with empty extension state and repairs the cache", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const writer = createMetaStore(createContext(), { getMetadataParent: () => root });
  const metaPath = await writer.writeMeta(root, solution, rawMeta());
  const emptyContext = createContext();
  const reader = createMetaStore(emptyContext, { getMetadataParent: () => root });

  const result = await reader.findMeta(solution);

  assert.equal(result.status, "found");
  assert.equal(result.source, "discovery");
  assert.equal(result.metaPath, metaPath);
  assert.equal(Object.values(emptyContext.state()["leetcodeGenerator.metaLinks"])[0], metaPath);
});

test("workspace moves retain the relative identity and refresh absolute paths", async (t) => {
  const container = await makeRoot(t);
  const oldRoot = path.join(container, "old-workspace");
  const newRoot = path.join(container, "new-workspace");
  await fs.promises.mkdir(oldRoot);
  const solution = path.join(oldRoot, "Easy", "two-sum.cpp");
  await fs.promises.mkdir(path.dirname(solution), { recursive: true });
  await fs.promises.writeFile(solution, "code");
  const writer = createMetaStore(createContext(), { getMetadataParent: () => oldRoot });
  const oldMetaPath = await writer.writeMeta(oldRoot, solution, rawMeta());
  const oldData = JSON.parse(await fs.promises.readFile(oldMetaPath, "utf8"));

  await fs.promises.rename(oldRoot, newRoot);
  const movedSolution = path.join(newRoot, "Easy", "two-sum.cpp");
  const reader = createMetaStore(createContext(), { getMetadataParent: () => newRoot });
  const result = await reader.findMeta(movedSolution);

  assert.equal(result.status, "found");
  assert.equal(result.meta.solutionPath, movedSolution);
  assert.equal(result.meta.solutionRelativePath, "Easy/two-sum.cpp");
  assert.equal(result.meta.metadataId, oldData.metadataId);
  assert.equal(result.migrated, true);
});

test("stale cached paths fall back to central discovery", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const writer = createMetaStore(createContext(), { getMetadataParent: () => root });
  const metaPath = await writer.writeMeta(root, solution, rawMeta());
  const context = createContext({
    "leetcodeGenerator.metaLinks": { [solution.toLowerCase()]: path.join(root, ".lch", "missing.lch") },
  });
  const reader = createMetaStore(context, { getMetadataParent: () => root });

  const result = await reader.findMeta(solution);

  assert.equal(result.status, "found");
  assert.equal(result.metaPath, metaPath);
});

test("migrates a unique v1 file, preserves extensions, and removes the legacy file", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const legacyPath = path.join(root, ".lch", "two-sum.lch");
  await writeJson(legacyPath, rawMeta({ solutionPath: solution, customField: { retained: true } }));
  const context = createContext();
  const store = createMetaStore(context, {
    getMetadataParent: () => root,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  const result = await store.findMeta(solution);

  assert.equal(result.status, "found");
  assert.equal(result.migrated, true);
  assert.equal(result.meta.version, 2);
  assert.deepEqual(result.meta.customField, { retained: true });
  assert.equal(result.meta.createdAt, "2026-01-02T03:04:05.000Z");
  assert.equal(result.meta.updatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(await fs.promises.stat(result.metaPath).then(() => true), true);
  assert.equal(await fs.promises.stat(legacyPath).then(() => true, () => false), false);
});

test("uses a configured metadata parent outside the solution folder", async (t) => {
  const root = await makeRoot(t);
  const solutions = path.join(root, "solutions");
  const metadataParent = path.join(root, "metadata-home");
  await fs.promises.mkdir(solutions);
  await fs.promises.mkdir(metadataParent);
  const solution = path.join(solutions, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const store = createMetaStore(createContext(), { getMetadataParent: () => metadataParent });

  const metaPath = await store.writeMeta(metadataParent, solution, rawMeta());
  const rediscovered = await createMetaStore(createContext(), {
    getMetadataParent: () => metadataParent,
  }).findMeta(solution);

  assert.equal(path.dirname(metaPath), path.join(metadataParent, ".lch"));
  assert.equal(rediscovered.status, "found");
  assert.equal(rediscovered.meta.solutionRelativePath, "../solutions/two-sum.cpp");
});

test("leaves corrupt and future metadata untouched and reports actionable states", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const invalidPath = path.join(root, ".lch", "two-sum.lch");
  await fs.promises.writeFile(invalidPath, "{not json", "utf8");
  let store = createMetaStore(createContext(), { getMetadataParent: () => root });
  let result = await store.findMeta(solution);
  assert.equal(result.status, "invalid");
  assert.match(result.message, /Unexpected|JSON/i);
  assert.equal(await fs.promises.readFile(invalidPath, "utf8"), "{not json");

  await fs.promises.unlink(invalidPath);
  const futurePath = path.join(root, ".lch", "two-sum.lch");
  const future = rawMeta({ version: 99, solutionPath: solution });
  await writeJson(futurePath, future);
  store = createMetaStore(createContext(), { getMetadataParent: () => root });
  result = await store.findMeta(solution);
  assert.equal(result.status, "unsupported");
  assert.match(result.message, /newer than supported/);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(futurePath, "utf8")), future);
});

test("refuses to guess between plausible legacy candidates", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "answer.cpp");
  await fs.promises.writeFile(solution, "code");
  await writeJson(path.join(root, ".lch", "first.lch"), rawMeta({
    solutionPath: path.join("C:\\old", "answer.cpp"),
  }));
  await writeJson(path.join(root, ".lch", "second.lch"), rawMeta({
    slug: "three-sum",
    problemId: "15",
    title: "3Sum",
    url: "https://leetcode.com/problems/three-sum/",
    solutionPath: path.join("D:\\older", "answer.cpp"),
  }));
  const store = createMetaStore(createContext(), { getMetadataParent: () => root });

  const result = await store.findMeta(solution);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
  assert.equal((await fs.promises.readdir(path.join(root, ".lch"))).length, 2);
});

test("deduplicates an interrupted migration while keeping the canonical copy", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  const canonical = createMetadata(rawMeta({
    solutionPath: solution,
    canonicalOnly: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  }), { solutionPath: solution, metadataParent: root });
  const canonicalPath = path.join(root, ".lch", canonicalMetadataFileName(canonical));
  await writeJson(canonicalPath, canonical);
  const duplicatePath = path.join(root, ".lch", "two-sum.lch");
  await writeJson(duplicatePath, rawMeta({ solutionPath: solution, legacyOnly: true }));
  const store = createMetaStore(createContext(), { getMetadataParent: () => root });

  const result = await store.findMeta(solution);

  assert.equal(result.status, "found");
  assert.equal(result.meta.canonicalOnly, true);
  assert.equal(result.meta.legacyOnly, undefined);
  assert.equal(await fs.promises.stat(duplicatePath).then(() => true, () => false), false);
});

test("reports a migration conflict without overwriting either file", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "answer.cpp");
  const otherSolution = path.join(root, "other.cpp");
  await fs.promises.writeFile(solution, "code");
  await fs.promises.writeFile(otherSolution, "other");
  const legacyPath = path.join(root, ".lch", "legacy.lch");
  const legacy = rawMeta({ solutionPath: solution });
  await writeJson(legacyPath, legacy);
  const intended = createMetadata(legacy, { solutionPath: solution, metadataParent: root });
  const targetPath = path.join(root, ".lch", canonicalMetadataFileName(intended));
  const conflicting = createMetadata(rawMeta({
    slug: "three-sum",
    problemId: "15",
    title: "3Sum",
    url: "https://leetcode.com/problems/three-sum/",
    solutionPath: otherSolution,
  }), { solutionPath: otherSolution, metadataParent: root });
  await writeJson(targetPath, conflicting);
  const store = createMetaStore(createContext(), { getMetadataParent: () => root });

  const result = await store.findMeta(solution);

  assert.equal(result.status, "invalid");
  assert.equal(result.code, "metadata_migration_conflict");
  assert.deepEqual(JSON.parse(await fs.promises.readFile(legacyPath, "utf8")), legacy);
  assert.equal((await fs.promises.readFile(targetPath, "utf8")).includes("three-sum"), true);
});

test("coalesces concurrent discovery and migration", async (t) => {
  const root = await makeRoot(t);
  const solution = path.join(root, "two-sum.cpp");
  await fs.promises.writeFile(solution, "code");
  await writeJson(path.join(root, ".lch", "two-sum.lch"), rawMeta({ solutionPath: solution }));
  const store = createMetaStore(createContext(), { getMetadataParent: () => root });

  const [first, second, third] = await Promise.all([
    store.findMeta(solution),
    store.findMeta(solution),
    store.findMeta(solution),
  ]);

  assert.equal(first.status, "found");
  assert.equal(second.metaPath, first.metaPath);
  assert.equal(third.metaPath, first.metaPath);
  assert.equal(store.getDiagnostics().migratedCount, 1);
});

test("serializes concurrent global-state cache repairs", async (t) => {
  const root = await makeRoot(t);
  const first = path.join(root, "first.cpp");
  const second = path.join(root, "second.cpp");
  await fs.promises.writeFile(first, "first");
  await fs.promises.writeFile(second, "second");
  const context = createContext();
  const writer = createMetaStore(context, { getMetadataParent: () => root });

  await Promise.all([
    writer.writeMeta(root, first, rawMeta()),
    writer.writeMeta(root, second, rawMeta({
      slug: "three-sum",
      problemId: "15",
      title: "3Sum",
      url: "https://leetcode.com/problems/three-sum/",
    })),
  ]);

  assert.equal(Object.keys(context.state()["leetcodeGenerator.metaLinks"]).length, 2);
});
