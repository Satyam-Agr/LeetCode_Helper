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

async function generateFromUrl(pageUrl, settingsStore, workspaceRoot) {
  const slug = extractSlug(pageUrl);
  const problem = await fetchProblem(slug);
  const settings = normalizeSettings(settingsStore.getSettings());
  const generated = buildGeneratedFile(problem, settings, workspaceRoot);
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

function buildGeneratedFile(problem, settings, workspaceRoot) {
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

  const root = resolveDestination(settings, workspaceRoot);
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

function resolveDestination(settings, workspaceRoot) {
  if (settings.destinationMode === "selected") {
    const selectedDestination = String(settings.destination || "").trim();
    const selectedRoot = selectedDestination ? path.resolve(selectedDestination) : "";
    if (selectedRoot && directoryExists(selectedRoot)) {
      return selectedRoot;
    }
  }

  return resolveWorkspaceRoot(workspaceRoot);
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) {
    throw new Error("Open a VS Code workspace before generating files.");
  }

  const resolved = path.resolve(workspaceRoot);
  if (!directoryExists(resolved)) {
    throw new Error("The workspace root detected when the bridge started no longer exists.");
  }
  return resolved;
}

function directoryExists(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
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
