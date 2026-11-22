"""Runs the daily workflow automatically at the configured local time on the configured weekdays.

Instead of sleeping until the run time (which breaks when the PC sleeps), it wakes every
``TICK_S`` seconds and asks: which scheduled days are due and not yet done? That makes catch-up
after downtime and sleep the normal path rather than a special case.

A day is done once a daily run for it has completed, whether the scheduler or you started it.
Failed attempts are retried a few times, spaced out. Catch-up never reaches back before the day
the scheduler was first enabled, so turning it on doesn't backfill old weeks.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlmodel import Session, col, select

from backend.agents.github_agent import SetupProblem
from backend.db import get_engine
from backend.events import EventBus
from backend.models import AppState, DailyRun, Run, RunStatus
from backend.settings import Settings, SettingsError, load_settings

log = logging.getLogger(__name__)

TICK_S = 30
#: A run starting this long after its scheduled time is reported as missed.
LATE_AFTER = timedelta(minutes=15)
MAX_ATTEMPTS = 3
RETRY_AFTER = timedelta(minutes=30)
#: How far back catch-up looks (in calendar days), on top of the "since enabled" limit.
CATCH_UP_DAYS = 7
SINCE_KEY = "schedule_since"

Starter = Callable[[date, str], Awaitable[tuple[dict, asyncio.Task[None]]]]


@dataclass(frozen=True)
class DueDay:
    day: date
    scheduled_at: datetime
    trigger: str  # "scheduled" | "catch-up" | "retry"
    late: bool


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def scheduled_at(settings: Settings, day: date) -> datetime:
    h, m = settings.schedule.hour_minute
    return datetime.combine(day, time(h, m), tzinfo=settings.tz)


def get_since(s: Session, today: date) -> date:
    """The day the scheduler was first enabled; set to today on first use."""
    row = s.get(AppState, SINCE_KEY)
    if row is None:
        row = AppState(key=SINCE_KEY, value=today.isoformat())
        s.add(row)
        s.commit()
    return date.fromisoformat(row.value)


def day_attempts(s: Session, day: date) -> list[tuple[str, RunStatus, datetime]]:
    """(trigger, status, started_at) of every daily run for a day, oldest first."""
    rows = s.exec(
        select(DailyRun.trigger, Run.status, Run.started_at)
        .join(Run, col(Run.id) == col(DailyRun.run_id))
        .where(DailyRun.work_date == day)
        .order_by(col(Run.id))
    ).all()
    return [(t, RunStatus(st), _utc(at)) for t, st, at in rows]


def due_days(settings: Settings, now: datetime) -> list[DueDay]:
    """Scheduled days that should run now, oldest first."""
    sched = settings.schedule
    if not sched.enabled:
        return []
    today = now.astimezone(settings.tz).date()
    due: list[DueDay] = []
    with Session(get_engine()) as s:
        since = get_since(s, today)
        for offset in range(CATCH_UP_DAYS, -1, -1):
            day = today - timedelta(days=offset)
            if day < since or day.weekday() not in sched.weekdays:
                continue
            at = scheduled_at(settings, day)
            if now < at:
                continue
            attempts = day_attempts(s, day)
            if any(st == RunStatus.COMPLETED for _, st, _ in attempts):
                continue
            if any(st == RunStatus.RUNNING for _, st, _ in attempts):
                continue
            automatic = [a for a in attempts if a[0] != "manual"]
            if automatic:
                if len(automatic) >= MAX_ATTEMPTS or now - automatic[-1][2] < RETRY_AFTER:
                    continue
                trigger = "retry"
            else:
                trigger = "scheduled" if day == today else "catch-up"
            due.append(DueDay(day, at, trigger, late=now - at > LATE_AFTER))
    return due


def next_run_at(settings: Settings, now: datetime) -> datetime | None:
    """When the next scheduled run (from now on) will happen, ignoring catch-up and retries."""
    if not settings.schedule.enabled or not settings.schedule.weekdays:
        return None
    local_today = now.astimezone(settings.tz).date()
    for offset in range(0, 8):
        day = local_today + timedelta(days=offset)
        at = scheduled_at(settings, day)
        if day.weekday() in settings.schedule.weekdays and at > now:
            return at
    return None  # pragma: no cover


class Scheduler:
    def __init__(
        self,
        bus: EventBus,
        starter: Starter,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        tick_s: float = TICK_S,
    ) -> None:
        self.bus = bus
        self.starter = starter
        self.now = now
        self.tick_s = tick_s
        #: Setup problems already reported, so a missing key isn't announced every 30 seconds.
        self._reported: set[tuple[date, str]] = set()

    async def run_forever(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # never let one bad tick stop scheduling
                log.exception("scheduler tick failed")
            await asyncio.sleep(self.tick_s)

    async def tick(self) -> DueDay | None:
        """Starts at most one due run and waits for it. Returns what it ran, if anything."""
        if self.bus.run_in_progress:
            return None
        try:
            settings = load_settings()
        except SettingsError:
            return None
        due = await asyncio.to_thread(due_days, settings, self.now())
        if not due:
            return None

        item = due[0]
        label = item.day.strftime("%a %b %d")
        try:
            run, task = await self.starter(item.day, item.trigger)
        except SetupProblem as exc:
            if (item.day, str(exc)) not in self._reported:
                self._reported.add((item.day, str(exc)))
                await self.bus.publish("schedule.skipped", message=f"Automatic run for {label} skipped: {exc}", warning="setup")
            return None
        except Exception as exc:  # e.g. another run started in between
            log.warning("scheduled run for %s could not start: %s", item.day, exc)
            return None

        if item.trigger == "catch-up" or (item.trigger == "scheduled" and item.late):
            await self.bus.publish(
                "schedule.missed",
                run_id=run["id"],
                message=f"Missed the {settings.schedule.time} run for {label} (backend was off or asleep); catching up now",
                warning="missed",
            )
        elif item.trigger == "retry":
            await self.bus.publish("schedule.retry", run_id=run["id"], message=f"Retrying the automatic run for {label}")
        await asyncio.gather(task, return_exceptions=True)
        return item
