const DEFAULT_SETTINGS = {
  language: "java",
  destination: "LeetCode",
  template: "// Problem: {title}\n// ID: {id}\n// Difficulty: {difficulty}\n// Tags: {tags}\n\n{header}{code}\n",
  filename: "{id}-{slug}",
  padId: 4,
  groupByDifficulty: true,
  defaultHeaders: true,
  languageHeaders: {
    java: "import java.util.*;\n\n",
    python: "from typing import List, Optional\n\n",
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\n",
    javascript: "",
    c: "#include <stdio.h>\n#include <stdlib.h>\n#include <stdbool.h>\n#include <string.h>\n\n",
  },
  openAfterCreate: true,
};

module.exports = { DEFAULT_SETTINGS };
