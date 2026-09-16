const crypto = require("crypto");
const path = require("path");

const CURRENT_META_VERSION = 2;

class MetadataSchemaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MetadataSchemaError";
    this.code = code;
  }
}

const MIGRATIONS = new Map([
  [1, migrateV1ToV2],
]);

function migrateMetadata(raw, { solutionPath, metadataParent, now = () => new Date() }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MetadataSchemaError("Metadata must contain a JSON object.", "metadata_invalid");
  }

  let version = raw.version == null ? 1 : raw.version;
  if (!Number.isInteger(version) || version < 1) {
    throw new MetadataSchemaError("Metadata has an invalid schema version.", "metadata_invalid");
  }
  if (version > CURRENT_META_VERSION) {
    throw new MetadataSchemaError(
      `Metadata version ${version} is newer than supported version ${CURRENT_META_VERSION}.`,
      "metadata_unsupported"
    );
  }

  let metadata = { ...raw, version };
  let migrated = false;
  while (metadata.version < CURRENT_META_VERSION) {
    const migration = MIGRATIONS.get(metadata.version);
    if (!migration) {
      throw new MetadataSchemaError(
        `No migration is available for metadata version ${metadata.version}.`,
        "metadata_unsupported"
      );
    }
    metadata = migration(metadata, { solutionPath, metadataParent, now });
    migrated = true;
  }

  validateCommonFields(metadata);
  const refreshed = refreshSolutionLocator(metadata, { solutionPath, metadataParent, now });
  return {
    metadata: refreshed.metadata,
    migrated: migrated || refreshed.changed,
  };
}

function createMetadata(raw, context) {
  return migrateMetadata({ ...raw, version: CURRENT_META_VERSION }, context).metadata;
}

function migrateV1ToV2(metadata, context) {
  const timestamp = toIso(context.now());
  return {
    ...metadata,
    version: 2,
    createdAt: validTimestamp(metadata.createdAt) || timestamp,
    updatedAt: timestamp,
  };
}

function refreshSolutionLocator(metadata, { solutionPath, metadataParent, now }) {
  const absoluteSolution = requireAbsolutePath(solutionPath, "solution path");
  const absoluteParent = requireAbsolutePath(metadataParent, "metadata parent");
  const relativePath = portableRelativePath(absoluteParent, absoluteSolution);
  const metadataId = createMetadataId(metadata, relativePath);
  const changed =
    normalizeComparablePath(metadata.solutionPath) !== normalizeComparablePath(absoluteSolution) ||
    metadata.solutionRelativePath !== relativePath ||
    metadata.metadataId !== metadataId;

  return {
    changed,
    metadata: {
      ...metadata,
      version: CURRENT_META_VERSION,
      solutionPath: absoluteSolution,
      solutionRelativePath: relativePath,
      metadataId,
      createdAt: validTimestamp(metadata.createdAt) || toIso(now()),
      updatedAt: changed ? toIso(now()) : validTimestamp(metadata.updatedAt) || toIso(now()),
    },
  };
}

function validateCommonFields(metadata) {
  for (const field of ["url", "slug", "problemId", "title", "language"]) {
    if (typeof metadata[field] !== "string" || !metadata[field].trim()) {
      throw new MetadataSchemaError(`Metadata field "${field}" is required.`, "metadata_invalid");
    }
  }
}

function validateMetadataDocument(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new MetadataSchemaError("Metadata must contain a JSON object.", "metadata_invalid");
  }
  if (metadata.version !== CURRENT_META_VERSION) {
    throw new MetadataSchemaError(
      `Metadata must use schema version ${CURRENT_META_VERSION}.`,
      "metadata_invalid"
    );
  }
  validateCommonFields(metadata);
  if (typeof metadata.solutionPath !== "string" || !path.isAbsolute(metadata.solutionPath)) {
    throw new MetadataSchemaError("Metadata requires an absolute solutionPath.", "metadata_invalid");
  }
  if (typeof metadata.solutionRelativePath !== "string" || !metadata.solutionRelativePath.trim()) {
    throw new MetadataSchemaError("Metadata requires solutionRelativePath.", "metadata_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(metadata.metadataId || "")) {
    throw new MetadataSchemaError("Metadata has an invalid metadataId.", "metadata_invalid");
  }
  if (!validTimestamp(metadata.createdAt) || !validTimestamp(metadata.updatedAt)) {
    throw new MetadataSchemaError("Metadata timestamps are invalid.", "metadata_invalid");
  }
  return metadata;
}

function createMetadataId(metadata, relativePath) {
  const identity = [
    String(metadata.slug).trim().toLowerCase(),
    String(metadata.language).trim().toLowerCase(),
    normalizePortablePath(relativePath),
  ].join("\0");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function canonicalMetadataFileName(metadata) {
  const problemId = safePart(String(metadata.problemId).padStart(4, "0"), "problem");
  const slug = safePart(metadata.slug, "solution");
  const language = safePart(metadata.language, "code");
  const id = /^[a-f0-9]{64}$/.test(metadata.metadataId || "")
    ? metadata.metadataId
    : createMetadataId(metadata, metadata.solutionRelativePath || metadata.solutionPath || "unknown");
  return `${problemId}-${slug}--${language}--${id.slice(0, 12)}.lch`;
}

function portableRelativePath(metadataParent, solutionPath) {
  const relative = path.relative(metadataParent, solutionPath);
  if (!relative || path.isAbsolute(relative)) {
    if (!relative) {
      throw new MetadataSchemaError("A metadata record cannot target the metadata parent itself.", "metadata_invalid");
    }
    // Different Windows drives cannot produce a portable relative locator. Retain
    // a normalized absolute fallback; discovery can still use exact-path matching.
    return toPortablePath(solutionPath);
  }
  return toPortablePath(relative);
}

function resolvePortablePath(metadataParent, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    return null;
  }
  return path.resolve(metadataParent, ...relativePath.split("/"));
}

function normalizePortablePath(value) {
  const normalized = toPortablePath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toPortablePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function normalizeComparablePath(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MetadataSchemaError(`A ${label} is required for metadata migration.`, "metadata_invalid");
  }
  return path.resolve(value);
}

function safePart(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

module.exports = {
  CURRENT_META_VERSION,
  MetadataSchemaError,
  canonicalMetadataFileName,
  createMetadata,
  migrateMetadata,
  normalizeComparablePath,
  resolvePortablePath,
  validateMetadataDocument,
};
