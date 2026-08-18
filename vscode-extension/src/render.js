// Pure helpers for turning a fetched problem + settings into file content.
const { normalizeLanguage } = require("./leetcode");

const EXTENSIONS = {
  c: ".c",
  cpp: ".cpp",
  java: ".java",
  javascript: ".js",
  python: ".py",
};

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

module.exports = { EXTENSIONS, render, cleanPathPart, cleanFileName, findSnippet };
