const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const { extractSlug, fetchProblem, normalizeLanguage } = require("./leetcode");
const { EXTENSIONS, render, cleanPathPart, cleanFileName, findSnippet } = require("./render");

// Generate a solution file from a LeetCode problem URL, and write a ".lch"
// metadata file alongside it (used later for pushing / resetting).
async function generateFromUrl(pageUrl, { settingsStore, metaStore, workspaceRoot }) {
  const slug = extractSlug(pageUrl);
  const problem = await fetchProblem(slug);
  const settings = normalizeSettings(settingsStore.getSettings());
  const { solutionRoot, metadataParent } = await settingsStore.resolveUsablePaths(workspaceRoot);

  const built = buildGeneratedFile(problem, settings, solutionRoot);
  const existed = fs.existsSync(built.path);

  if (!existed) {
    fs.mkdirSync(path.dirname(built.path), { recursive: true });
    fs.writeFileSync(built.path, built.content, { encoding: "utf8", flag: "wx" });
  }

  const canonicalUrl = `https://leetcode.com/problems/${problem.slug}/`;
  const meta = {
    version: 1,
    url: canonicalUrl,
    slug: problem.slug,
    problemId: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
    language: settings.language,
    template: settings.template,
    codeSnippet: built.snippetCode,
    header: built.header,
    content: built.content,
    solutionPath: built.path,
    createdAt: new Date().toISOString(),
  };
  const metaPath = await metaStore.writeMeta(metadataParent, built.path, meta);

  if (settings.openAfterCreate) {
    const document = await vscode.workspace.openTextDocument(built.path);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  return {
    status: existed ? "skipped" : "created",
    title: problem.title,
    problemId: problem.id,
    difficulty: problem.difficulty,
    language: built.languageName,
    path: built.path,
    metaPath,
    url: canonicalUrl,
  };
}

function buildGeneratedFile(problem, settings, solutionRoot) {
  if (!EXTENSIONS[settings.language]) {
    throw new Error(`Unsupported language: ${settings.language}`);
  }

  const snippet = findSnippet(problem, settings.language);
  const renderedId = String(problem.id).padStart(settings.padId, "0");
  const header = settings.defaultHeaders ? settings.languageHeaders?.[settings.language] || "" : "";
  const variables = {
    id: renderedId,
    title: problem.title,
    slug: problem.slug,
    difficulty: problem.difficulty,
    tags: problem.tags.join(", "),
    language: snippet.lang,
    header,
    code: snippet.code,
  };

  const basename = cleanFileName(render(settings.filename, variables));
  if (!basename) {
    throw new Error("Filename pattern rendered an invalid file name.");
  }

  const directory = settings.groupByDifficulty
    ? path.join(solutionRoot, cleanPathPart(problem.difficulty || "Unknown"))
    : solutionRoot;

  return {
    path: path.join(directory, `${basename}${EXTENSIONS[settings.language]}`),
    content: render(settings.template, variables),
    languageName: snippet.lang,
    snippetCode: snippet.code,
    header,
  };
}

function normalizeSettings(settings) {
  return {
    ...settings,
    language: normalizeLanguage(settings.language),
  };
}

module.exports = { generateFromUrl };
