from __future__ import annotations

from dataclasses import dataclass

from .leetcode_client import CodeSnippet, Problem


class TemplateError(Exception):
    """Raised when a configured template cannot be rendered."""


@dataclass(frozen=True)
class RenderContext:
    problem: Problem
    snippet: CodeSnippet
    configured_language: str
    rendered_id: str


def render_template(template: str, context: RenderContext) -> str:
    return _render(template, _variables(context))


def render_filename(pattern: str, context: RenderContext) -> str:
    filename = _render(pattern, _variables(context))
    if "/" in filename or "\\" in filename:
        raise TemplateError("Invalid filename: filename pattern cannot contain path separators")
    if not filename.strip():
        raise TemplateError("Invalid filename: filename pattern rendered an empty name")
    return filename


def _render(template: str, variables: dict[str, str]) -> str:
    try:
        return template.format(**variables)
    except KeyError as exc:
        name = exc.args[0]
        raise TemplateError(f"Unknown template variable: {{{name}}}") from exc
    except ValueError as exc:
        raise TemplateError(f"Invalid template syntax: {exc}") from exc


def _variables(context: RenderContext) -> dict[str, str]:
    return {
        "id": context.rendered_id,
        "title": context.problem.title,
        "slug": context.problem.slug,
        "difficulty": context.problem.difficulty,
        "language": context.snippet.lang,
        "code": context.snippet.code,
    }
