// Detects the "code section" of a solution file so we can push only the code
// (not headers/imports/notes) into the LeetCode editor.
//
// Strategy (as specified):
//   1. Take the LeetCode starter snippet stored in the metadata.
//   2. Skip its leading comment/blank lines using LANGUAGE-AWARE comment rules
//      (line comments + multi-line block comments). The first real line of code is
//      the anchor (e.g. `class Solution {`). Remember the leading comments.
//   3. Find that exact anchor line in the user's file.
//   4. Copy from the anchor line down to the last line containing `}` (or EOF for
//      brace-less languages like Python).
//   5. Prepend the snippet's leading comments to the copied code.
//   6. If the anchor is not found, return null (caller falls back to the whole file).

// Line-comment tokens and block-comment [open, close] pairs per language.
function commentRules(language) {
  switch (String(language || "").toLowerCase()) {
    case "python":
      return { lines: ["#"], blocks: [['"""', '"""'], ["'''", "'''"]] };
    case "java":
    case "cpp":
    case "c":
    case "javascript":
      return { lines: ["//"], blocks: [["/*", "*/"]] };
    default:
      // Be permissive for unknown languages.
      return { lines: ["//", "#"], blocks: [["/*", "*/"]] };
  }
}

// Split a snippet into its leading comment lines and the first line of real code.
function splitSnippet(codeSnippet, language) {
  const { lines: lineTokens, blocks } = commentRules(language);
  const snippetLines = String(codeSnippet || "").split(/\r?\n/);
  const leadingComments = [];
  let closingToken = null; // set while inside a multi-line block comment
  let anchor = null;

  for (const line of snippetLines) {
    const trimmed = line.trim();

    if (closingToken) {
      leadingComments.push(line);
      if (trimmed.includes(closingToken)) {
        closingToken = null;
      }
      continue;
    }

    if (trimmed === "") {
      continue; // skip blank lines, don't treat as a comment
    }

    const block = blocks.find(([open]) => trimmed.startsWith(open));
    if (block) {
      const [open, close] = block;
      leadingComments.push(line);
      // Block stays open unless the closing token appears after the opening one.
      const rest = trimmed.slice(open.length);
      if (!rest.includes(close)) {
        closingToken = close;
      }
      continue;
    }

    if (lineTokens.some((token) => trimmed.startsWith(token))) {
      leadingComments.push(line);
      continue;
    }

    anchor = line;
    break;
  }

  return { leadingComments, anchor };
}

function extractCodeSection(fileText, codeSnippet, language) {
  const { leadingComments, anchor } = splitSnippet(codeSnippet, language);
  if (!anchor) {
    return null;
  }

  const target = anchor.trim();
  const fileLines = String(fileText || "").split(/\r?\n/);
  const startIndex = fileLines.findIndex((line) => line.trim() === target);
  if (startIndex === -1) {
    return null;
  }

  // Last line containing a closing brace; fall back to EOF (e.g. Python).
  let endIndex = -1;
  for (let i = fileLines.length - 1; i >= startIndex; i--) {
    if (fileLines[i].includes("}")) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    endIndex = fileLines.length - 1;
  }

  const body = fileLines.slice(startIndex, endIndex + 1).join("\n");
  const prefix = leadingComments.length ? `${leadingComments.join("\n")}\n` : "";
  return prefix + body;
}

module.exports = { extractCodeSection };
