"""User settings stored in %LOCALAPPDATA%\\Genth\\settings.json (outside the repo, not secret).

Example::

    {
      "timezone": "Asia/Manila",
      "github": {
        "author": "your-login",
        "repositories": ["your-login/repo-a", "your-login/repo-b"],
        "allBranches": true
      }
    }
"""

import json
import re
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend import config

# Strict patterns: these values are interpolated into GitHub API paths.
_LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_REPO = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$")


class SettingsError(Exception):
    pass


@dataclass(frozen=True)
class GitHubSettings:
    author: str = ""
    repositories: tuple[str, ...] = ()
    all_branches: bool = True


@dataclass(frozen=True)
class Settings:
    timezone: str = "Asia/Manila"
    github: GitHubSettings = field(default_factory=GitHubSettings)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def _parse(raw: dict) -> Settings:
    gh = raw.get("github") or {}
    author = str(gh.get("author", "")).strip()
    repos = tuple(str(r).strip() for r in gh.get("repositories", []))
    if author and not _LOGIN.match(author):
        raise SettingsError(f"github.author {author!r} is not a valid GitHub login")
    for r in repos:
        if not _REPO.match(r):
            raise SettingsError(f"github.repositories entry {r!r} must look like 'owner/name'")
    if len(set(r.lower() for r in repos)) != len(repos):
        raise SettingsError("github.repositories contains duplicates")

    timezone = str(raw.get("timezone", "Asia/Manila"))
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise SettingsError(f"timezone {timezone!r} is not a known time zone") from None

    return Settings(
        timezone=timezone,
        github=GitHubSettings(author=author, repositories=repos, all_branches=bool(gh.get("allBranches", True))),
    )


def _serialize(s: Settings) -> dict:
    return {
        "timezone": s.timezone,
        "github": {
            "author": s.github.author,
            "repositories": list(s.github.repositories),
            "allBranches": s.github.all_branches,
        },
    }


def load_settings() -> Settings:
    """Reads settings.json, creating it with empty defaults on first use."""
    path = config.SETTINGS_PATH
    if not path.exists():
        config.ensure_dirs()
        save_settings(Settings())
        return Settings()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SettingsError(f"{path} is not valid JSON: {exc}") from None
    return _parse(raw)


def save_settings(s: Settings) -> None:
    config.SETTINGS_PATH.write_text(json.dumps(_serialize(s), indent=2) + "\n", encoding="utf-8")
