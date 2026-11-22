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


#: Agents who join the morning meeting (besides Boss Cheats at the head and MEDG presenting).
MEETING_ATTENDEES = ("summary", "reviewer", "war", "govops")
#: Seconds to let everyone reach the 3F meeting room (walking + elevator).
GATHER_SECONDS = 16


async def fetch_day(
    ctx: RunContext,
    day: date,
    settings: Settings,
    token: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    hand_off_to_summary: bool = False,
) -> int:
    """Runs the commit meeting: Boss calls everyone in, MEDG presents the day's commits as he fetches
    them, then (optionally) carries them over to Lil Ed. Returns how many commits the day has."""
    gh_settings = settings.github
    since, until = day_window(day, settings.tz)
    when = "today" if day == datetime.now(settings.tz).date() else day.strftime("%b %d")

    # Boss calls the meeting; everyone heads to the 3F meeting room.
    await ctx.say("supervisor", "Calling the team meeting")
    await ctx.speak("supervisor", "Team, meeting in the 3F meeting room!")
    await ctx.step("Team meeting in the 3F meeting room")
    await ctx.move("supervisor", "meeting_head")
    await ctx.move("github", "presenter")
    for agent in MEETING_ATTENDEES:
        await ctx.move(agent, "meeting")
    await ctx.say("github", "Heading to the meeting")
    await ctx.pause(GATHER_SECONDS)

    await ctx.speak("supervisor", f"MEDG, what did we ship {when}?")
    await ctx.pause(2)

    # MEDG presents while he fetches.
    await ctx.step(f"MEDG presenting commits for {day.isoformat()}")
    task = await ctx.start_task("github", f"Fetch commits {day.isoformat()}")
    await ctx.say("github", "Presenting today's commits")
    await ctx.speak("github", "Pulling the commits from GitHub…")
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
                count = f"{len(found)} commit{'s' if len(found) != 1 else ''}"
                await ctx.notice("github", f"{_short(repo)}: {count}", repo=repo, count=len(found))
                await ctx.speak("github", f"{_short(repo)}: {count}.")
                await ctx.pause(1.5)
            expires_at = gh.token_expires_at
    except RunFailed as exc:
        await ctx.finish_task(task, TaskStatus.FAILED)
        await ctx.say("github", "Fetch failed", "error")
        await ctx.speak("github", "GitHub isn't cooperating, boss.")
        await ctx.say("supervisor", "Run stopped: see the feed", "error")
        await _end_meeting(ctx)
        raise exc

    new, updated = await asyncio.to_thread(store_commits, records, settings.tz, ctx.run_id)
    await ctx.finish_task(task)

    total = len(records)
    await ctx.say("github", f"{total} commit{'s' if total != 1 else ''} today ({new} new)", "ok")
    await ctx.speak("github", f"That's {total} commit{'s' if total != 1 else ''} in total." if total else "No commits this time.")
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
    await ctx.pause(2)

    # Wrap up the meeting.
    if total and hand_off_to_summary:
        await ctx.speak("supervisor", "Thanks MEDG. Lil Ed, please turn these into accomplishments.")
    elif total:
        await ctx.speak("supervisor", "Thanks MEDG, good work.")
    else:
        await ctx.speak("supervisor", "Quiet day. Meeting adjourned!")
    await ctx.pause(2)
    await ctx.step("Meeting ended")
    await _end_meeting(ctx, keep_github=bool(total and hand_off_to_summary))

    if total and hand_off_to_summary:
        # MEDG carries the commits to Lil Ed's office.
        await ctx.move("github", "visit:summary")
        await ctx.say("github", "Delivering the commits to Lil Ed")
        await ctx.pause(10)
        await ctx.speak("github", "Here are today's commits, Lil Ed.")
        await ctx.pause(2)
        await ctx.speak("summary", "Got them, thanks!")
        await ctx.pause(1.5)
        await ctx.move("github", "desk")
    await ctx.say("supervisor", "All ok", "ok")
    return total


async def _end_meeting(ctx: RunContext, keep_github: bool = False) -> None:
    """Everyone leaves the meeting room for their desks."""
    await ctx.move("supervisor", "desk")
    for agent in MEETING_ATTENDEES:
        await ctx.move(agent, "desk")
    if not keep_github:
        await ctx.move("github", "desk")


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
