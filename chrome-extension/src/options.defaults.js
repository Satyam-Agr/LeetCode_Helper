export const SUPPORTED_LANGUAGES = new Set(["java", "python", "cpp", "javascript", "c"]);
export const TEMPLATE_VARIABLES = new Set([
  "id",
  "title",
  "slug",
  "difficulty",
  "tags",
  "language",
  "header",
  "code",
]);

export const DEFAULT_SETTINGS = {
  language: "java",
  destinationMode: "workspace",
  destination: "",
  metadataDir: "",
  template: "// Problem: {title}\n// ID: {id}\n// Difficulty: {difficulty}\n// Tags: {tags}\n\n{header}{code}\n",
  filename: "{id}-{slug}",
  padId: 4,
  groupByDifficulty: false,
  defaultHeaders: true,
  openAfterCreate: true,
  autoOpenPushView: true,
  languageHeaders: {
    java: "import java.util.*;\n\n",
    python: "from typing import List, Optional\n\n",
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\n",
    javascript: "",
    c: "#include <stdio.h>\n#include <stdlib.h>\n#include <stdbool.h>\n#include <string.h>\n\n",
  },
};
