"""GitHub Agent: fetches the configured author's commits for one day and stores each exactly once.

Deterministic code, no AI model. Re-running a day is safe: commits are unique per (repo, SHA);
a re-run only adds commits that are new and records any extra branches a commit appeared on.
"""

import asyncio
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlmodel import Session, select

from backend.db import get_engine
from backend.events import EventBus
from backend.integrations.github_client import CommitRecord, GitHubClient, GitHubError
from backend.models import Commit, TaskStatus
from backend.runs import RunContext, RunFailed, launch_run
from backend.secret_store import get_github_token
from backend.settings import Settings, SettingsError, load_settings

#: Warn when GitHub says the token expires within this many days.
EXPIRY_WARNING_DAYS = 14

TokenProvider = Callable[[], str | None]


class SetupProblem(Exception):
    """Genth isn't configured enough to fetch commits; the message says how to fix it."""


def day_window(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """[start, end) of a calendar day in the given time zone, as aware datetimes."""
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def check_setup(token_provider: TokenProvider = get_github_token) -> tuple[Settings, str]:
    try:
        settings = load_settings()
    except SettingsError as exc:
        raise SetupProblem(f"settings.json: {exc}") from None
    if not settings.github.author:
        raise SetupProblem("Set github.author in %LOCALAPPDATA%\\Genth\\settings.json.")
    if not settings.github.repositories:
        raise SetupProblem("Add repositories to github.repositories in %LOCALAPPDATA%\\Genth\\settings.json.")
    token = token_provider()
    if not token:
        raise SetupProblem("GitHub token not set. In backend/, run: uv run genth-secret github")
    return settings, token


def resolve_day(settings: Settings, day: date | None) -> date:
    """The requested day, defaulting to today in the configured time zone; never in the future."""
    today = datetime.now(settings.tz).date()
    target = day or today
    if target > today:
        raise SetupProblem("Can't work on a future date.")
    return target


def store_commits(records: list[CommitRecord], tz: ZoneInfo, run_id: int | None) -> tuple[int, int]:
    """Upserts commits. Returns (new, updated) counts; 'updated' means new branches were recorded."""
    new = updated = 0
    with Session(get_engine()) as s:
        for rec in records:
            existing = s.exec(select(Commit).where(Commit.repo == rec.repo, Commit.sha == rec.sha)).first()
            if existing is None:
                s.add(
                    Commit(
                        repo=rec.repo,
                        sha=rec.sha,
                        message=rec.message,
                        author_login=rec.author_login,
                        authored_at=rec.authored_at.astimezone(UTC),
                        committed_at=rec.committed_at.astimezone(UTC),
                        work_date=rec.committed_at.astimezone(tz).date(),
                        url=rec.url,
                        is_merge=rec.is_merge,
                        branches=sorted(rec.branches),
                        first_run_id=run_id,
                    )
                )
                new += 1
            elif not rec.branches.issubset(existing.branches):
                existing.branches = sorted(set(existing.branches) | rec.branches)
                s.add(existing)
                updated += 1
        s.commit()
    return new, updated


def _short(repo: str) -> str:
    return repo.split("/", 1)[1]


async def fetch_day(
    ctx: RunContext,
    day: date,
    settings: Settings,
    token: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    gh_settings = settings.github
    since, until = day_window(day, settings.tz)

    await ctx.say("supervisor", "Assigning today's commit fetch")
    await ctx.step("Hand-off to the GitHub Agent")
    await ctx.move("github", "meeting")
    await ctx.move("supervisor", "meeting")
    await ctx.pause(5)
    await ctx.move("github", "desk")
    await ctx.move("supervisor", "desk")
    await ctx.say("supervisor", "Waiting for the GitHub Agent", "waiting")

    await ctx.step(f"Fetching commits for {day.isoformat()}")
    task = await ctx.start_task("github", f"Fetch commits {day.isoformat()}")
    records: list[CommitRecord] = []
    try:
        async with GitHubClient(token, transport=transport) as gh:
            for repo in gh_settings.repositories:
                await ctx.say("github", f"Reading {_short(repo)}…")
                try:
                    found = await gh.commits_in_window(
                        repo, author=gh_settings.author, since=since, until=until, all_branches=gh_settings.all_branches
                    )
                except GitHubError as exc:
                    raise RunFailed(f"{repo}: {exc}") from None
                records.extend(found.values())
                await ctx.notice("github", f"{_short(repo)}: {len(found)} commit{'s' if len(found) != 1 else ''}",
                                 repo=repo, count=len(found))
            expires_at = gh.token_expires_at
    except RunFailed as exc:
        await ctx.finish_task(task, TaskStatus.FAILED)
        await ctx.say("github", "Fetch failed", "error")
        await ctx.say("supervisor", "Run stopped: see the feed", "error")
        raise exc

    new, updated = await asyncio.to_thread(store_commits, records, settings.tz, ctx.run_id)
    await ctx.finish_task(task)

    total = len(records)
    summary = f"{total} commit{'s' if total != 1 else ''} today ({new} new)"
    await ctx.say("github", summary, "ok")
    if updated:
        await ctx.notice("github", f"{updated} known commit{'s' if updated != 1 else ''} seen on new branches")

    if expires_at:
        days_left = (expires_at - datetime.now(UTC)).days
        if days_left <= EXPIRY_WARNING_DAYS:
            await ctx.notice(
                "github",
                f"GitHub token expires in {max(days_left, 0)} day(s), on {expires_at.date().isoformat()}. Create a new one soon.",
                warning="token_expiring",
                expiresAt=expires_at.isoformat(),
            )
    await ctx.say("supervisor", "All ok", "ok")


async def start_github_run(
    bus: EventBus,
    day: date | None = None,
    *,
    token_provider: TokenProvider = get_github_token,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[dict, asyncio.Task[None]]:
    """Validates setup up front (so the caller can report problems), then launches the run."""
    settings, token = check_setup(token_provider)
    target = resolve_day(settings, day)

    async def script(ctx: RunContext) -> None:
        await fetch_day(ctx, target, settings, token, transport=transport)

    return await launch_run(bus, "github", "Commit fetch", script)
