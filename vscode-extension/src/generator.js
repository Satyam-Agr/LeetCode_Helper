const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const { extractSlug, fetchProblem, normalizeLanguage } = require("./leetcode");

const EXTENSIONS = {
  c: ".c",
  cpp: ".cpp",
  java: ".java",
  javascript: ".js",
  python: ".py",
};

async function generateFromUrl(pageUrl, settingsStore) {
  const slug = extractSlug(pageUrl);
  const problem = await fetchProblem(slug);
  const settings = normalizeSettings(settingsStore.getSettings());
  const generated = buildGeneratedFile(problem, settings);
  const existed = fs.existsSync(generated.path);

  if (!existed) {
    fs.mkdirSync(path.dirname(generated.path), { recursive: true });
    fs.writeFileSync(generated.path, generated.content, { encoding: "utf8", flag: "wx" });
  }

  if (settings.openAfterCreate) {
    const document = await vscode.workspace.openTextDocument(generated.path);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  return {
    status: existed ? "skipped" : "created",
    title: problem.title,
    problemId: problem.id,
    difficulty: problem.difficulty,
    language: generated.languageName,
    path: generated.path,
  };
}

function buildGeneratedFile(problem, settings) {
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
  const root = resolveDestination(settings.destination);
  const directory = settings.groupByDifficulty
    ? path.join(root, cleanPathPart(problem.difficulty || "Unknown"))
    : root;

  return {
    path: path.join(directory, `${basename}${EXTENSIONS[settings.language]}`),
    content: render(settings.template, variables),
    languageName: snippet.lang,
  };
}

function normalizeSettings(settings) {
  return {
    ...settings,
    language: normalizeLanguage(settings.language),
  };
}

function resolveDestination(destination) {
  const trimmed = String(destination || "").trim();
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("Open a VS Code workspace before generating files.");
  }

  return path.resolve(workspaceFolder.uri.fsPath, trimmed);
}

function findSnippet(problem, language) {
  const bySlug = problem.snippets.find((snippet) => normalizeLanguage(snippet.langSlug) === language);
  if (bySlug) {
    return bySlug;
  }

  const byName = problem.snippets.find((snippet) => normalizeLanguage(snippet.lang) === language);
  if (byName) {
    return byName;
  }

  throw new Error(`Missing ${language} snippet for this problem.`);
}

function render(template, variables) {
  return String(template || "").replace(/\{([a-z_]+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Unknown template variable: ${match}`);
    }
    return variables[name];
  });
}

function cleanPathPart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
}

function cleanFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
}

module.exports = { generateFromUrl };
