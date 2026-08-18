// Per-solution metadata, stored cph-style. For each generated file we write a
// JSON file with a custom ".lch" extension inside a ".lch" folder. A globalState
// map remembers { solutionFilePath -> metadataFilePath } so the sidebar can find
// the metadata for whatever file is active.

const fs = require("fs");
const path = require("path");

const META_LINKS_KEY = "leetcodeGenerator.metaLinks";
const META_FOLDER = ".lch";
const META_EXT = ".lch";

function createMetaStore(context) {
  function getLinks() {
    return context.globalState.get(META_LINKS_KEY) || {};
  }

  async function setLink(solutionPath, metaPath) {
    const links = { ...getLinks() };
    links[solutionPath] = metaPath;
    await context.globalState.update(META_LINKS_KEY, links);
  }

  function getMetaPath(solutionPath) {
    return getLinks()[solutionPath] || null;
  }

  // `parentDir` is the folder that should contain the ".lch" folder.
  async function writeMeta(parentDir, solutionPath, meta) {
    const folder = path.join(parentDir, META_FOLDER);
    fs.mkdirSync(folder, { recursive: true });

    const base = path.basename(solutionPath, path.extname(solutionPath));
    const metaPath = path.join(folder, `${base}${META_EXT}`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    await setLink(solutionPath, metaPath);
    return metaPath;
  }

  // Returns parsed metadata (with `metaPath`) for a solution file, or null.
  function readMeta(solutionPath) {
    const metaPath = getMetaPath(solutionPath);
    if (!metaPath || !fs.existsSync(metaPath)) {
      return null;
    }
    try {
      return { ...JSON.parse(fs.readFileSync(metaPath, "utf8")), metaPath };
    } catch {
      return null;
    }
  }

  return { writeMeta, readMeta, getMetaPath };
}

module.exports = { createMetaStore, META_FOLDER, META_EXT };
