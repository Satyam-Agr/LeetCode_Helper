// Centralized, portable metadata store. The on-disk .lch directory is the source
// of truth; VS Code globalState is only a disposable fast-path cache.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  CURRENT_META_VERSION,
  MetadataSchemaError,
  canonicalMetadataFileName,
  createMetadata,
  migrateMetadata,
  normalizeComparablePath,
  resolvePortablePath,
  validateMetadataDocument,
} = require("./metadataSchema");

const META_LINKS_KEY = "leetcodeGenerator.metaLinks";
const META_FOLDER = ".lch";
const META_EXT = ".lch";
const LANGUAGE_EXTENSIONS = {
  c: ".c",
  cpp: ".cpp",
  java: ".java",
  javascript: ".js",
  python: ".py",
};

function createMetaStore(context, {
  getMetadataParent = () => null,
  log = () => {},
  now = () => new Date(),
} = {}) {
  let index = null;
  const scanPromises = new Map();
  let linkUpdate = Promise.resolve();
  const lookupPromises = new Map();
  const stats = {
    lastScanAt: null,
    migratedCount: 0,
    invalidCount: 0,
    unsupportedCount: 0,
    ambiguousCount: 0,
    lastLookup: null,
  };

  function getLinks() {
    const stored = context.globalState.get(META_LINKS_KEY);
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  }

  function getMetaPath(solutionPath) {
    const links = getLinks();
    return links[linkKey(solutionPath)] || links[solutionPath] || null;
  }

  function setLink(solutionPath, metaPath) {
    const key = linkKey(solutionPath);
    linkUpdate = linkUpdate.then(async () => {
      const links = { ...getLinks(), [key]: path.resolve(metaPath) };
      if (solutionPath !== key && Object.prototype.hasOwnProperty.call(links, solutionPath)) {
        delete links[solutionPath];
      }
      await context.globalState.update(META_LINKS_KEY, links);
    });
    return linkUpdate;
  }

  function removeLink(solutionPath) {
    const key = linkKey(solutionPath);
    linkUpdate = linkUpdate.then(async () => {
      const links = { ...getLinks() };
      let changed = false;
      for (const candidate of [key, solutionPath]) {
        if (Object.prototype.hasOwnProperty.call(links, candidate)) {
          delete links[candidate];
          changed = true;
        }
      }
      if (changed) {
        await context.globalState.update(META_LINKS_KEY, links);
      }
    });
    return linkUpdate;
  }

  async function writeMeta(metadataParent, solutionPath, rawMeta) {
    const parent = requireMetadataParent(metadataParent);
    const folder = path.join(parent, META_FOLDER);
    const metadata = createMetadata(rawMeta, { solutionPath, metadataParent: parent, now });
    const metaPath = path.join(folder, canonicalMetadataFileName(metadata));

    await fs.promises.mkdir(folder, { recursive: true });
    await assertCompatibleTarget(metaPath, metadata.metadataId);
    await atomicWriteJson(metaPath, metadata);
    await setLink(solutionPath, metaPath);
    invalidateIndex();
    log("metadata.written", { solutionPath, metaPath, version: CURRENT_META_VERSION });
    return metaPath;
  }

  async function findMeta(solutionPath) {
    if (typeof solutionPath !== "string" || !solutionPath.trim()) {
      return recordLookup({ status: "missing", message: "No solution file is active." });
    }
    const absoluteSolution = path.resolve(solutionPath);
    const key = linkKey(absoluteSolution);
    if (lookupPromises.has(key)) {
      return lookupPromises.get(key);
    }

    const promise = findMetaInternal(absoluteSolution).finally(() => lookupPromises.delete(key));
    lookupPromises.set(key, promise);
    return promise;
  }

  async function findMetaInternal(solutionPath) {
    const metadataParent = resolveMetadataParent();
    if (!metadataParent) {
      return recordLookup({
        status: "missing",
        message: "Open a workspace or configure a metadata folder before using LeetCode metadata.",
      });
    }

    const linkedPath = getMetaPath(solutionPath);
    let linkedIssue = null;
    if (linkedPath) {
      const linked = await readEntry(linkedPath);
      if (linked.status === "valid" && matchesStrongly(linked, solutionPath, metadataParent)) {
        return canonicalize(linked, solutionPath, metadataParent, "cache");
      }
      if (linked.status === "invalid" || linked.status === "unsupported") {
        linkedIssue = issueResult(linked);
      }
      await removeLink(solutionPath);
    }

    const hadCurrentIndex = Boolean(index && index.metadataParent === metadataParent);
    const currentIndex = await scanCentral(metadataParent, hadCurrentIndex);
    const strong = currentIndex.entries.filter((entry) =>
      entry.status === "valid" && matchesStrongly(entry, solutionPath, metadataParent)
    );
    const strongResult = await resolveCandidates(strong, solutionPath, metadataParent, "discovery");
    if (strongResult) {
      return strongResult;
    }

    const legacy = currentIndex.entries.filter((entry) =>
      entry.status === "valid" && metadataVersion(entry.raw) === 1 && matchesLegacy(entry, solutionPath)
    );
    const legacyResult = await resolveCandidates(legacy, solutionPath, metadataParent, "legacy-discovery");
    if (legacyResult) {
      return legacyResult;
    }

    const relatedIssue = currentIndex.entries.find((entry) =>
      (entry.status === "invalid" || entry.status === "unsupported") &&
      matchesIssue(entry, solutionPath, metadataParent)
    );
    if (relatedIssue) {
      return recordLookup(issueResult(relatedIssue));
    }

    if (linkedIssue) {
      return recordLookup(linkedIssue);
    }

    return recordLookup({
      status: "missing",
      message: `No matching metadata was found in ${path.join(metadataParent, META_FOLDER)}.`,
    });
  }

  async function resolveCandidates(candidates, solutionPath, metadataParent, source) {
    if (!candidates.length) {
      return null;
    }

    const prepared = [];
    for (const entry of candidates) {
      try {
        prepared.push({
          entry,
          identity: migrateMetadata(entry.raw, { solutionPath, metadataParent, now }).metadata.metadataId,
        });
      } catch (error) {
        return recordLookup(schemaIssueResult(error, entry.metaPath));
      }
    }

    const identities = new Set(prepared.map((candidate) => candidate.identity));
    if (identities.size > 1) {
      stats.ambiguousCount += 1;
      return recordLookup({
        status: "ambiguous",
        message: `Multiple .lch files match ${path.basename(solutionPath)}. Resolve the duplicates in the central .lch folder.`,
        candidates: candidates.map((entry) => entry.metaPath),
      });
    }

    const preferred = candidates.find((entry) =>
      path.basename(entry.metaPath) === canonicalNameIfPresent(entry.raw)
    ) || candidates[0];
    const fresh = await readEntry(preferred.metaPath);
    if (fresh.status !== "valid") {
      return recordLookup(issueResult(fresh));
    }
    const result = await canonicalize(fresh, solutionPath, metadataParent, source);
    if (result.status !== "found") {
      return result;
    }

    // Finish cleanup from an interrupted earlier migration. All candidates
    // were proven to resolve to the same deterministic identity above.
    for (const duplicate of candidates) {
      if (normalizeComparablePath(duplicate.metaPath) === normalizeComparablePath(result.metaPath)) {
        continue;
      }
      await fs.promises.unlink(duplicate.metaPath).then(() => {
        log("metadata.duplicate-removed", { duplicate: duplicate.metaPath, canonical: result.metaPath });
      }).catch((error) => {
        log("metadata.cleanup-pending", {
          sourcePath: duplicate.metaPath,
          canonicalPath: result.metaPath,
          error: error.message,
        });
      });
    }
    if (candidates.length > 1) {
      invalidateIndex();
    }
    return result;
  }

  async function canonicalize(entry, solutionPath, metadataParent, source) {
    let migration;
    try {
      migration = migrateMetadata(entry.raw, { solutionPath, metadataParent, now });
    } catch (error) {
      return recordLookup(schemaIssueResult(error, entry.metaPath));
    }

    let metadata = migration.metadata;
    const folder = path.join(metadataParent, META_FOLDER);
    const canonicalPath = path.join(folder, canonicalMetadataFileName(metadata));
    const sourcePath = path.resolve(entry.metaPath);
    const needsRelocation = normalizeComparablePath(sourcePath) !== normalizeComparablePath(canonicalPath);

    if (migration.migrated || needsRelocation) {
      await fs.promises.mkdir(folder, { recursive: true });
      let canonicalAlreadyExists = false;
      if (needsRelocation && await fileExists(canonicalPath)) {
        const target = await readEntry(canonicalPath);
        if (target.status !== "valid" || target.raw.metadataId !== metadata.metadataId) {
          return recordLookup({
            status: "invalid",
            code: "metadata_migration_conflict",
            message: `Metadata migration conflict: ${path.basename(canonicalPath)} already contains a different record.`,
            metaPath: canonicalPath,
          });
        }
        // An interrupted earlier migration can leave both files behind. The
        // canonical record wins; only refresh its portable locator and then
        // safely remove the duplicate source.
        const canonicalMigration = migrateMetadata(target.raw, { solutionPath, metadataParent, now });
        metadata = canonicalMigration.metadata;
        canonicalAlreadyExists = true;
        if (canonicalMigration.migrated) {
          await atomicWriteJson(canonicalPath, metadata);
        }
      }

      if (!canonicalAlreadyExists) {
        await atomicWriteJson(canonicalPath, metadata);
      }
      const verified = await readEntry(canonicalPath);
      if (verified.status !== "valid" || verified.raw.metadataId !== metadata.metadataId) {
        throw new Error(`Could not verify migrated metadata: ${canonicalPath}`);
      }

      await setLink(solutionPath, canonicalPath);
      if (needsRelocation && await fileExists(sourcePath)) {
        await fs.promises.unlink(sourcePath).catch((error) => {
          log("metadata.cleanup-pending", { sourcePath, canonicalPath, error: error.message });
        });
      }
      stats.migratedCount += 1;
      invalidateIndex();
      log("metadata.migrated", {
        solutionPath,
        from: sourcePath,
        to: canonicalPath,
        version: CURRENT_META_VERSION,
      });
    } else {
      await setLink(solutionPath, canonicalPath);
    }

    return recordLookup({
      status: "found",
      meta: { ...metadata, metaPath: canonicalPath },
      metaPath: canonicalPath,
      source,
      migrated: migration.migrated || needsRelocation,
    });
  }

  async function scanCentral(metadataParent, force = false) {
    if (!force && index && index.metadataParent === metadataParent) {
      return index;
    }
    if (scanPromises.has(metadataParent)) {
      return scanPromises.get(metadataParent);
    }

    const promise = (async () => {
      const folder = path.join(metadataParent, META_FOLDER);
      let names = [];
      try {
        names = (await fs.promises.readdir(folder, { withFileTypes: true }))
          .filter((item) => item.isFile() && item.name.endsWith(META_EXT))
          .map((item) => item.name)
          .sort();
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      const entries = await Promise.all(names.map((name) => readEntry(path.join(folder, name))));
      stats.lastScanAt = toIso(now());
      stats.invalidCount = entries.filter((entry) => entry.status === "invalid").length;
      stats.unsupportedCount = entries.filter((entry) => entry.status === "unsupported").length;
      // Do not let a scan for an obsolete configured folder replace the
      // active index if the user changed settings while I/O was in flight.
      const scannedIndex = { metadataParent, folder, entries };
      if (resolveMetadataParent() === metadataParent) {
        index = scannedIndex;
      }
      log("metadata.scanned", {
        folder,
        files: entries.length,
        invalid: stats.invalidCount,
        unsupported: stats.unsupportedCount,
      });
      return scannedIndex;
    })().finally(() => {
      scanPromises.delete(metadataParent);
    });
    scanPromises.set(metadataParent, promise);
    return promise;
  }

  async function readEntry(metaPath) {
    try {
      const raw = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { status: "invalid", metaPath, error: "Metadata must contain a JSON object." };
      }
      const version = metadataVersion(raw);
      if (!Number.isInteger(version) || version < 1) {
        return { status: "invalid", metaPath, raw, error: "Metadata has an invalid schema version." };
      }
      if (version > CURRENT_META_VERSION) {
        return {
          status: "unsupported",
          metaPath,
          raw,
          error: `Metadata version ${version} is newer than supported version ${CURRENT_META_VERSION}.`,
        };
      }
      if (version === CURRENT_META_VERSION) {
        try {
          validateMetadataDocument(raw);
        } catch (error) {
          return { status: "invalid", metaPath, raw, error: error.message };
        }
      }
      return { status: "valid", metaPath, raw };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { status: "missing", metaPath };
      }
      return { status: "invalid", metaPath, error: error.message };
    }
  }

  function matchesStrongly(entry, solutionPath, metadataParent) {
    const raw = entry.raw;
    if (normalizeComparablePath(raw.solutionPath) === normalizeComparablePath(solutionPath)) {
      return true;
    }
    const resolvedRelative = resolvePortablePath(metadataParent, raw.solutionRelativePath);
    return Boolean(resolvedRelative && normalizeComparablePath(resolvedRelative) === normalizeComparablePath(solutionPath));
  }

  function matchesLegacy(entry, solutionPath) {
    const extension = path.extname(solutionPath).toLowerCase();
    const expectedExtension = LANGUAGE_EXTENSIONS[String(entry.raw.language || "").toLowerCase()];
    if (expectedExtension && extension !== expectedExtension) {
      return false;
    }
    const activeBase = path.basename(solutionPath, extension);
    const storedPath = String(entry.raw.solutionPath || "");
    const storedBase = path.basename(storedPath, path.extname(storedPath));
    return Boolean(storedBase) && activeBase === storedBase;
  }

  function matchesIssue(entry, solutionPath, metadataParent) {
    if (normalizeComparablePath(entry.raw?.solutionPath) === normalizeComparablePath(solutionPath)) {
      return true;
    }
    const relative = resolvePortablePath(metadataParent, entry.raw?.solutionRelativePath);
    if (relative && normalizeComparablePath(relative) === normalizeComparablePath(solutionPath)) {
      return true;
    }
    return path.basename(entry.metaPath, META_EXT) === path.basename(solutionPath, path.extname(solutionPath));
  }

  async function assertCompatibleTarget(metaPath, metadataId) {
    if (!await fileExists(metaPath)) {
      return;
    }
    const existing = await readEntry(metaPath);
    if (existing.status !== "valid" || existing.raw.metadataId !== metadataId) {
      throw new MetadataSchemaError(
        `Metadata target already contains a different record: ${metaPath}`,
        "metadata_write_conflict"
      );
    }
  }

  function getDiagnostics() {
    const metadataParent = resolveMetadataParent();
    return {
      centralFolder: metadataParent ? path.join(metadataParent, META_FOLDER) : null,
      indexSize: index?.entries?.length || 0,
      ...stats,
    };
  }

  function invalidateIndex() {
    index = null;
  }

  function resolveMetadataParent() {
    const value = getMetadataParent();
    return typeof value === "string" && value.trim() ? path.resolve(value) : null;
  }

  function recordLookup(result) {
    stats.lastLookup = {
      status: result.status,
      source: result.source || null,
      message: result.message || null,
      at: toIso(now()),
    };
    return result;
  }

  return {
    writeMeta,
    findMeta,
    getMetaPath,
    getDiagnostics,
    invalidateIndex,
  };
}

async function atomicWriteJson(targetPath, value) {
  const directory = path.dirname(targetPath);
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${token}.tmp`);
  const backupPath = path.join(directory, `.${path.basename(targetPath)}.${token}.bak`);
  const serialized = JSON.stringify(value, null, 2);
  let backedUp = false;

  await fs.promises.mkdir(directory, { recursive: true });
  try {
    await fs.promises.writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    validateMetadataDocument(JSON.parse(await fs.promises.readFile(temporaryPath, "utf8")));

    if (await fileExists(targetPath)) {
      await fs.promises.rename(targetPath, backupPath);
      backedUp = true;
    }
    try {
      await fs.promises.rename(temporaryPath, targetPath);
    } catch (error) {
      if (backedUp && !await fileExists(targetPath)) {
        await fs.promises.rename(backupPath, targetPath).catch(() => {});
      }
      throw error;
    }
    if (backedUp) {
      await fs.promises.unlink(backupPath).catch(() => {});
    }
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => {});
  }
}

async function fileExists(filePath) {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function metadataVersion(raw) {
  return raw.version == null ? 1 : raw.version;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function canonicalNameIfPresent(raw) {
  try {
    return raw.version === CURRENT_META_VERSION && raw.metadataId
      ? canonicalMetadataFileName(raw)
      : null;
  } catch {
    return null;
  }
}

function linkKey(solutionPath) {
  return normalizeComparablePath(solutionPath);
}

function requireMetadataParent(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MetadataSchemaError("A metadata parent folder is required.", "metadata_invalid");
  }
  return path.resolve(value);
}

function issueResult(entry) {
  return {
    status: entry.status,
    code: entry.status === "unsupported" ? "metadata_unsupported" : "metadata_invalid",
    message: `${path.basename(entry.metaPath)}: ${entry.error}`,
    metaPath: entry.metaPath,
  };
}

function schemaIssueResult(error, metaPath) {
  return {
    status: error?.code === "metadata_unsupported" ? "unsupported" : "invalid",
    code: error?.code || "metadata_invalid",
    message: `${path.basename(metaPath)}: ${error.message}`,
    metaPath,
  };
}

module.exports = { createMetaStore, META_FOLDER, META_EXT };
