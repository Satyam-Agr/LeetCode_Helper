const https = require("https");

const GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";

const QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    difficulty
    topicTags {
      name
      slug
    }
    codeSnippets {
      lang
      langSlug
      code
    }
  }
}
`;

function extractSlug(pageUrl) {
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new Error("Could not read a valid URL from the current tab.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && host !== "www.leetcode.com") {
    throw new Error("Open a LeetCode problem page before using this extension.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "problems") {
    throw new Error("This is LeetCode, but not a problem page.");
  }

  const slug = parts[1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Could not extract a valid LeetCode problem slug.");
  }

  return slug;
}

async function fetchProblem(slug) {
  const parsed = await postJson(
    GRAPHQL_ENDPOINT,
    {
      query: QUERY,
      variables: { titleSlug: slug },
      operationName: "questionData",
    },
    {
      "Content-Type": "application/json",
      "User-Agent": "leetcode-template-generator-vscode/0.1",
      Referer: `https://leetcode.com/problems/${slug}/`,
    }
  );

  if (parsed.errors?.length) {
    throw new Error("LeetCode API returned an error.");
  }

  const question = parsed.data?.question;
  if (!question) {
    throw new Error("Problem not found. The URL may be invalid or private.");
  }

  return {
    id: String(question.questionId || ""),
    title: String(question.title || ""),
    slug: String(question.titleSlug || slug),
    difficulty: String(question.difficulty || ""),
    tags: (question.topicTags || []).map((tag) => tag.name).filter(Boolean),
    snippets: question.codeSnippets || [],
  };
}

function postJson(endpoint, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`LeetCode returned HTTP ${response.statusCode}.`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Could not parse LeetCode response."));
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("LeetCode request timed out."));
    });
    request.on("error", () => {
      reject(new Error("Failed to fetch problem data from LeetCode."));
    });
    request.write(body);
    request.end();
  });
}

function normalizeLanguage(language) {
  const aliases = {
    "c++": "cpp",
    cpp: "cpp",
    js: "javascript",
    javascript: "javascript",
    py: "python",
    python: "python",
    python3: "python",
  };
  const value = String(language || "").trim().toLowerCase().replace(/\s+/g, "");
  return aliases[value] || value;
}

module.exports = { extractSlug, fetchProblem, normalizeLanguage };
