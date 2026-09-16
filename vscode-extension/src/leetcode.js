const https = require("https");

const GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [0, 250, 750];

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

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  maxFreeSockets: 2,
  timeout: 30000,
});

class LeetCodeRequestError extends Error {
  constructor(message, { code = "leetcode_request_failed", retryable = false, httpStatus = null } = {}) {
    super(message);
    this.name = "LeetCodeRequestError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

function extractSlug(pageUrl) {
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new LeetCodeRequestError("Could not read a valid URL from the current tab.", {
      code: "invalid_problem_url",
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && host !== "www.leetcode.com") {
    throw new LeetCodeRequestError("Open a LeetCode problem page before using this extension.", {
      code: "invalid_problem_url",
    });
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "problems") {
    throw new LeetCodeRequestError("This is LeetCode, but not a problem page.", {
      code: "invalid_problem_url",
    });
  }

  const slug = parts[1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new LeetCodeRequestError("Could not extract a valid LeetCode problem slug.", {
      code: "invalid_problem_url",
    });
  }

  return slug;
}

function createProblemClient({
  postJson = postJsonOnce,
  now = () => Date.now(),
  sleepFn = sleep,
  cacheTtlMs = CACHE_TTL_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function fetchProblem(slug, { log = () => {}, requestId = null } = {}) {
    const cached = cache.get(slug);
    if (cached && cached.expiresAt > now()) {
      log("leetcode.cache-hit", { requestId, slug });
      return cached.problem;
    }
    if (cached) {
      cache.delete(slug);
    }

    const current = inFlight.get(slug);
    if (current) {
      log("leetcode.inflight-join", { requestId, slug });
      return current;
    }

    const operation = requestProblem(slug, { log, requestId });
    inFlight.set(slug, operation);

    try {
      const problem = await operation;
      cache.set(slug, { problem, expiresAt: now() + cacheTtlMs });
      return problem;
    } finally {
      if (inFlight.get(slug) === operation) {
        inFlight.delete(slug);
      }
    }
  }

  async function requestProblem(slug, { log, requestId }) {
    let lastError = null;

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs) {
        await sleepFn(delayMs);
      }

      const startedAt = now();
      log("leetcode.request-start", { requestId, slug, attempt: attempt + 1 });

      try {
        const parsed = await postJson(
          GRAPHQL_ENDPOINT,
          {
            query: QUERY,
            variables: { titleSlug: slug },
            operationName: "questionData",
          },
          {
            "Content-Type": "application/json",
            "User-Agent": "leetcode-template-generator-vscode/1.0",
            Referer: `https://leetcode.com/problems/${slug}/`,
          }
        );

        const problem = parseProblemResponse(parsed, slug);
        log("leetcode.request-complete", {
          requestId,
          slug,
          attempt: attempt + 1,
          durationMs: now() - startedAt,
        });
        return problem;
      } catch (error) {
        lastError = normalizeRequestError(error);
        log("leetcode.request-failed", {
          requestId,
          slug,
          attempt: attempt + 1,
          durationMs: now() - startedAt,
          code: lastError.code,
          retryable: lastError.retryable,
        });

        if (!lastError.retryable || attempt === retryDelaysMs.length - 1) {
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  return { fetchProblem, clearCache: () => cache.clear() };
}

function parseProblemResponse(parsed, slug) {
  if (parsed.errors?.length) {
    throw new LeetCodeRequestError("LeetCode API returned an error.", {
      code: "leetcode_api_error",
    });
  }

  const question = parsed.data?.question;
  if (!question) {
    throw new LeetCodeRequestError("Problem not found. The URL may be invalid or private.", {
      code: "problem_not_found",
    });
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

function postJsonOnce(endpoint, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        agent: keepAliveAgent,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new LeetCodeRequestError(`LeetCode returned HTTP ${statusCode}.`, {
                code: statusCode === 429 ? "leetcode_rate_limited" : "leetcode_http_error",
                retryable: statusCode === 429 || statusCode >= 500,
                httpStatus: statusCode,
              })
            );
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(
              new LeetCodeRequestError("Could not parse LeetCode response.", {
                code: "leetcode_invalid_response",
              })
            );
          }
        });
      }
    );

    request.on("timeout", () => {
      const timeoutError = new Error("LeetCode request timed out.");
      timeoutError.code = "ETIMEDOUT";
      request.destroy(timeoutError);
    });
    request.on("error", (error) => reject(normalizeRequestError(error)));
    request.write(body);
    request.end();
  });
}

function normalizeRequestError(error) {
  if (error instanceof LeetCodeRequestError) {
    return error;
  }

  const retryableCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENETDOWN",
    "ENETUNREACH",
    "ETIMEDOUT",
  ]);
  const retryable = retryableCodes.has(error?.code) || /socket hang up|timed out/i.test(error?.message || "");
  return new LeetCodeRequestError(
    retryable ? "Failed to fetch problem data from LeetCode after retrying." : "Failed to fetch problem data from LeetCode.",
    { code: retryable ? "leetcode_network_error" : "leetcode_request_failed", retryable }
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const defaultProblemClient = createProblemClient();

module.exports = {
  extractSlug,
  fetchProblem: defaultProblemClient.fetchProblem,
  normalizeLanguage,
  createProblemClient,
  LeetCodeRequestError,
};
