from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .config import AppConfig
from .leetcode_client import CodeSnippet, Problem
from .template_engine import RenderContext, render_filename, render_template


class FileGenerationError(Exception):
    """Raised when output paths or files cannot be created."""


@dataclass(frozen=True)
class GeneratedFile:
    path: Path
    content: str
    existed: bool = False


EXTENSIONS = {
    "c": ".c",
    "cpp": ".cpp",
    "java": ".java",
    "javascript": ".js",
    "python": ".py",
}


def build_generated_file(config: AppConfig, problem: Problem, snippet: CodeSnippet) -> GeneratedFile:
    rendered_id = _format_problem_id(problem.problem_id, config.pad_id)
    context = RenderContext(
        problem=problem,
        snippet=snippet,
        configured_language=config.language,
        rendered_id=rendered_id,
    )

    basename = render_filename(config.filename, context)
    extension = _extension_for(config.language)
    directory = config.destination

    if config.group_by_difficulty:
        directory = directory / _safe_directory_name(problem.difficulty)

    path = directory / f"{basename}{extension}"
    content = render_template(config.template, context)
    return GeneratedFile(path=path, content=content, existed=path.exists())


def write_generated_file(generated: GeneratedFile) -> GeneratedFile:
    if generated.path.exists():
        return GeneratedFile(path=generated.path, content=generated.content, existed=True)

    try:
        generated.path.parent.mkdir(parents=True, exist_ok=True)
        generated.path.write_text(generated.content, encoding="utf-8", newline="\n")
    except OSError as exc:
        raise FileGenerationError(f"Could not write file: {exc}") from exc

    return generated


def _format_problem_id(problem_id: str, pad_id: int | None) -> str:
    if pad_id is None:
        return problem_id
    return problem_id.zfill(pad_id)


def _extension_for(language: str) -> str:
    key = language.lower()
    if key not in EXTENSIONS:
        raise FileGenerationError(f"Unsupported language: {language}")
    return EXTENSIONS[key]


def _safe_directory_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "-", name).strip()
    return cleaned or "Unknown"
