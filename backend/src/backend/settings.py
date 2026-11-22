"""User settings stored in %LOCALAPPDATA%\\Genth\\settings.json (outside the repo, not secret).

Example::

    {
      "timezone": "Asia/Manila",
      "ai": {"provider": "gemini", "model": "gemini-flash-latest"},
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

# Strict patterns: these values are interpolated into API paths.
_LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
_REPO = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$")


class SettingsError(Exception):
    pass


@dataclass(frozen=True)
class GitHubSettings:
    author: str = ""
    repositories: tuple[str, ...] = ()
    all_branches: bool = True


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class ScheduleSettings:
    enabled: bool = True
    #: Local time (in Settings.timezone) of the automatic daily run, HH:MM.
    time: str = "12:00"
    #: Days the run happens; Monday is 0.
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)

    @property
    def hour_minute(self) -> tuple[int, int]:
        h, m = self.time.split(":")
        return int(h), int(m)


PROVIDERS = ("gemini",)


@dataclass(frozen=True)
class AISettings:
    provider: str = "gemini"
    #: "gemini-flash-latest" tracks Google's current Flash model (free tier eligible).
    model: str = "gemini-flash-latest"
    #: Tried in order when the main model is overloaded (HTTP 503), which happens on the free tier.
    fallback_models: tuple[str, ...] = ("gemini-flash-lite-latest",)
    #: Merge commits rarely describe work; leave them out of the prompt.
    exclude_merges: bool = True


@dataclass(frozen=True)
class Settings:
    timezone: str = "Asia/Manila"
    github: GitHubSettings = field(default_factory=GitHubSettings)
    ai: AISettings = field(default_factory=AISettings)
    schedule: ScheduleSettings = field(default_factory=ScheduleSettings)

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

    ai_raw = raw.get("ai") or {}
    provider = str(ai_raw.get("provider", "gemini"))
    model = str(ai_raw.get("model", AISettings.model))
    if provider not in PROVIDERS:
        raise SettingsError(f"ai.provider {provider!r} is not supported (use one of: {', '.join(PROVIDERS)})")
    fallbacks = tuple(str(m) for m in ai_raw.get("fallbackModels", AISettings.fallback_models))
    for m in (model, *fallbacks):
        if not _MODEL.match(m):
            raise SettingsError(f"ai model name {m!r} is not valid")

    sched_raw = raw.get("schedule") or {}
    time_str = str(sched_raw.get("time", ScheduleSettings.time))
    if not _TIME.match(time_str):
        raise SettingsError(f"schedule.time {time_str!r} must be HH:MM (24-hour)")
    day_names = [str(d).lower()[:3] for d in sched_raw.get("weekdays", [WEEKDAYS[i] for i in ScheduleSettings.weekdays])]
    if bad := [d for d in day_names if d not in WEEKDAYS]:
        raise SettingsError(f"schedule.weekdays has unknown day(s): {', '.join(bad)}")
    schedule = ScheduleSettings(
        enabled=bool(sched_raw.get("enabled", True)),
        time=time_str,
        weekdays=tuple(sorted({WEEKDAYS.index(d) for d in day_names})),
    )

    return Settings(
        schedule=schedule,
        timezone=timezone,
        github=GitHubSettings(author=author, repositories=repos, all_branches=bool(gh.get("allBranches", True))),
        ai=AISettings(
            provider=provider,
            model=model,
            fallback_models=fallbacks,
            exclude_merges=bool(ai_raw.get("excludeMerges", True)),
        ),
    )


def _serialize(s: Settings) -> dict:
    return {
        "timezone": s.timezone,
        "github": {
            "author": s.github.author,
            "repositories": list(s.github.repositories),
            "allBranches": s.github.all_branches,
        },
        "ai": {
            "provider": s.ai.provider,
            "model": s.ai.model,
            "fallbackModels": list(s.ai.fallback_models),
            "excludeMerges": s.ai.exclude_merges,
        },
        "schedule": {
            "enabled": s.schedule.enabled,
            "time": s.schedule.time,
            "weekdays": [WEEKDAYS[i] for i in s.schedule.weekdays],
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
