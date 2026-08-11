from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from .config import ConfigError, load_config
from .file_generator import FileGenerationError, build_generated_file, write_generated_file
from .leetcode_client import LeetCodeError, fetch_problem, find_language_snippet
from .template_engine import TemplateError


SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    if len(args) != 1:
        print("Usage: lcgen <leetcode-problem-url>")
        return 2

    try:
        slug = extract_slug(args[0])
    except ValueError:
        print(f"{ERROR} Could not extract LeetCode slug")
        return 1

    try:
        config = load_config()
    except ConfigError as exc:
        print(f"{ERROR} {exc}")
        return 1

    print("Fetching problem...")

    try:
        problem = fetch_problem(slug)
        snippet = find_language_snippet(problem, config.language)
        generated = build_generated_file(config, problem, snippet)
    except LeetCodeError as exc:
        print(f"{ERROR} {exc}")
        return 1
    except (FileGenerationError, TemplateError) as exc:
        print(f"{ERROR} {exc}")
        return 1

    print(f"{SUCCESS} {problem.title}")
    print(f"{SUCCESS} Problem ID: {problem.problem_id}")
    print(f"{SUCCESS} Difficulty: {problem.difficulty}")
    print(f"{SUCCESS} Language: {snippet.lang}")
    print(f"{SUCCESS} Template applied")
    print()
    print("Creating:")
    print(_display_path(generated.path))
    print()

    if generated.path.exists():
        print("File already exists:")
        print(_display_path(generated.path))
        print()
        print("Skipped.")
        return 0

    try:
        write_generated_file(generated)
    except FileGenerationError as exc:
        print(f"{ERROR} {exc}")
        return 1

    print(f"{SUCCESS} File created successfully")
    return 0


def extract_slug(value: str) -> str:
    parsed = urlparse(value.strip())

    if parsed.scheme and parsed.netloc:
        host = parsed.netloc.lower()
        if host not in {"leetcode.com", "www.leetcode.com"}:
            raise ValueError("not a LeetCode URL")

        parts = [part for part in Path(parsed.path).parts if part not in {"/", "\\"}]
        if len(parts) >= 2 and parts[0] == "problems":
            slug = parts[1]
        else:
            raise ValueError("missing /problems/<slug>/ path")
    else:
        raise ValueError("expected a LeetCode problem URL")

    if not SLUG_PATTERN.fullmatch(slug):
        raise ValueError("invalid slug")

    return slug


def _display_path(path: Path) -> str:
    return str(path).replace("\\", "/")


def _can_print(value: str) -> bool:
    encoding = sys.stdout.encoding or "utf-8"
    try:
        value.encode(encoding)
    except UnicodeEncodeError:
        return False
    return True


SUCCESS = "✓" if _can_print("✓") else "+"
ERROR = "✗" if _can_print("✗") else "x"


if __name__ == "__main__":
    raise SystemExit(main())
