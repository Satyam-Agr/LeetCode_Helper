from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass


GRAPHQL_ENDPOINT = "https://leetcode.com/graphql"


class LeetCodeError(Exception):
    """Raised when problem data cannot be retrieved from LeetCode."""


@dataclass(frozen=True)
class CodeSnippet:
    lang: str
    lang_slug: str
    code: str


@dataclass(frozen=True)
class Problem:
    problem_id: str
    title: str
    slug: str
    difficulty: str
    code_snippets: list[CodeSnippet]


QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    difficulty
    codeSnippets {
      lang
      langSlug
      code
    }
  }
}
"""


def fetch_problem(slug: str) -> Problem:
    payload = json.dumps(
        {
            "query": QUERY,
            "variables": {"titleSlug": slug},
            "operationName": "questionData",
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        GRAPHQL_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "leetcode-template-generator/0.1",
            "Referer": f"https://leetcode.com/problems/{slug}/",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        raise LeetCodeError("Failed to fetch problem data") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LeetCodeError("Failed to parse LeetCode response") from exc

    if parsed.get("errors"):
        raise LeetCodeError("LeetCode API returned an error")

    question = parsed.get("data", {}).get("question")
    if not question:
        raise LeetCodeError("Invalid LeetCode slug or problem not found")

    snippets = [
        CodeSnippet(
            lang=item.get("lang", ""),
            lang_slug=item.get("langSlug", ""),
            code=item.get("code", ""),
        )
        for item in question.get("codeSnippets", [])
    ]

    return Problem(
        problem_id=str(question.get("questionId", "")),
        title=str(question.get("title", "")),
        slug=str(question.get("titleSlug", slug)),
        difficulty=str(question.get("difficulty", "")),
        code_snippets=snippets,
    )


def find_language_snippet(problem: Problem, language: str) -> CodeSnippet:
    desired = normalize_language(language)

    for snippet in problem.code_snippets:
        if normalize_language(snippet.lang_slug) == desired:
            return snippet

    for snippet in problem.code_snippets:
        if normalize_language(snippet.lang) == desired:
            return snippet

    raise LeetCodeError(f"Missing language snippet for: {language}")


def normalize_language(language: str) -> str:
    aliases = {
        "c++": "cpp",
        "cpp": "cpp",
        "js": "javascript",
        "javascript": "javascript",
        "python3": "python",
        "python": "python",
        "py": "python",
    }
    value = language.strip().lower().replace(" ", "")
    return aliases.get(value, value)
