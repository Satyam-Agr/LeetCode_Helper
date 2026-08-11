from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ConfigError(Exception):
    """Raised when config.json is missing or invalid."""


@dataclass(frozen=True)
class AppConfig:
    language: str
    destination: Path
    template: str
    filename: str
    pad_id: int | None = None
    group_by_difficulty: bool = False


REQUIRED_FIELDS = ("language", "destination", "template", "filename")


def load_config(config_path: Path | None = None) -> AppConfig:
    path = config_path or _default_config_path()

    if not path.exists():
        raise ConfigError(f"Missing config file: {path}")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Invalid config.json: {exc.msg}") from exc
    except OSError as exc:
        raise ConfigError(f"Could not read config.json: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigError("Invalid config.json: root value must be an object")

    missing = [field for field in REQUIRED_FIELDS if field not in raw]
    if missing:
        raise ConfigError(f"Missing required config field(s): {', '.join(missing)}")

    _validate_string(raw, "language")
    _validate_string(raw, "destination")
    _validate_string(raw, "template")
    _validate_string(raw, "filename")

    pad_id = raw.get("pad_id")
    if pad_id is not None and (not isinstance(pad_id, int) or pad_id < 0):
        raise ConfigError("Invalid config field: pad_id must be a non-negative integer")

    group_by_difficulty = raw.get("group_by_difficulty", False)
    if not isinstance(group_by_difficulty, bool):
        raise ConfigError("Invalid config field: group_by_difficulty must be true or false")

    return AppConfig(
        language=raw["language"].strip().lower(),
        destination=Path(raw["destination"]).expanduser(),
        template=raw["template"],
        filename=raw["filename"],
        pad_id=pad_id,
        group_by_difficulty=group_by_difficulty,
    )


def _validate_string(raw: dict[str, Any], field: str) -> None:
    value = raw.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"Invalid config field: {field} must be a non-empty string")


def _default_config_path() -> Path:
    cwd_config = Path.cwd() / "config.json"
    if cwd_config.exists():
        return cwd_config

    project_config = Path(__file__).resolve().parents[1] / "config.json"
    if project_config.exists():
        return project_config

    return cwd_config
