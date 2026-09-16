const test = require("node:test");
const assert = require("node:assert/strict");

const { createProblemClient, LeetCodeRequestError, extractSlug } = require("../src/leetcode");

function problemResponse(slug = "two-sum") {
  return {
    data: {
      question: {
        questionId: "1",
        title: "Two Sum",
        titleSlug: slug,
        difficulty: "Easy",
        topicTags: [{ name: "Array" }],
        codeSnippets: [{ lang: "Java", langSlug: "java", code: "class Solution {}" }],
      },
    },
  };
}

test("successful problem responses are cached", async () => {
  let calls = 0;
  const client = createProblemClient({
    postJson: async () => {
      calls += 1;
      return problemResponse();
    },
    now: () => 100,
  });

  const first = await client.fetchProblem("two-sum");
  const second = await client.fetchProblem("two-sum");

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  assert.equal(first.title, "Two Sum");
});

test("concurrent requests for the same slug share one operation", async () => {
  let calls = 0;
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const client = createProblemClient({
    postJson: async () => {
      calls += 1;
      return response;
    },
  });

  const first = client.fetchProblem("two-sum");
  const second = client.fetchProblem("two-sum");
  release(problemResponse());

  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.strictEqual(a, b);
});

test("transient network failures are retried twice", async () => {
  let calls = 0;
  const delays = [];
  const client = createProblemClient({
    postJson: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("timed out");
        error.code = "ETIMEDOUT";
        throw error;
      }
      return problemResponse();
    },
    sleepFn: async (delay) => delays.push(delay),
  });

  const problem = await client.fetchProblem("two-sum");
  assert.equal(problem.id, "1");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("deterministic LeetCode errors are not retried", async () => {
  let calls = 0;
  const client = createProblemClient({
    postJson: async () => {
      calls += 1;
      throw new LeetCodeRequestError("LeetCode returned HTTP 404.", {
        code: "leetcode_http_error",
        httpStatus: 404,
      });
    },
    sleepFn: async () => assert.fail("deterministic failures must not sleep"),
  });

  await assert.rejects(client.fetchProblem("two-sum"), { code: "leetcode_http_error" });
  assert.equal(calls, 1);
});

test("only canonical LeetCode problem URLs are accepted", () => {
  assert.equal(extractSlug("https://leetcode.com/problems/two-sum/description/"), "two-sum");
  assert.throws(() => extractSlug("https://example.com/problems/two-sum/"), { code: "invalid_problem_url" });
});
