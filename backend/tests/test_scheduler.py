import asyncio
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlmodel import Session, delete

from backend import config
from backend.agents.github_agent import SetupProblem
from backend.db import get_engine, init_db
from backend.events import EventBus
from backend.models import AppState, DailyRun, Run, RunStatus
from backend.scheduler import SINCE_KEY, Scheduler, due_days, next_run_at
from backend.settings import GitHubSettings, ScheduleSettings, Settings, save_settings

MANILA = ZoneInfo("Asia/Manila")
# 2026-11-16 is a Monday.
MON, TUE, WED, FRI, SAT = (date(2026, 11, d) for d in (16, 17, 18, 20, 21))


def at(day: date, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=MANILA).astimezone(UTC)


def settings(enabled=True, time="12:00", weekdays=(0, 1, 2, 3, 4)) -> Settings:
    return Settings(schedule=ScheduleSettings(enabled=enabled, time=time, weekdays=weekdays))


@pytest.fixture(autouse=True)
def clean_db():
    """Each test starts with no daily runs and the scheduler enabled 'since' MON."""
    init_db()
    with Session(get_engine()) as s:
        s.exec(delete(DailyRun))
        s.exec(delete(AppState))
        s.add(AppState(key=SINCE_KEY, value=MON.isoformat()))
        s.commit()


def record(day: date, status: RunStatus, trigger="scheduled", started: datetime | None = None) -> int:
    with Session(get_engine()) as s:
        run = Run(kind="daily", status=status, started_at=started or datetime.now(UTC))
        s.add(run)
        s.flush()
        s.add(DailyRun(run_id=run.id, work_date=day, trigger=trigger))
        s.commit()
        return run.id


def days(due):
    return [(d.day, d.trigger, d.late) for d in due]


def test_nothing_before_the_scheduled_time():
    assert due_days(settings(), at(MON, "11:59")) == []


def test_today_is_due_at_the_scheduled_time():
    assert days(due_days(settings(), at(MON, "12:00"))) == [(MON, "scheduled", False)]


def test_weekends_are_skipped():
    with Session(get_engine()) as s:
        s.get(AppState, SINCE_KEY).value = SAT.isoformat()
        s.commit()
    assert due_days(settings(), at(SAT, "13:00")) == []


def test_completed_day_is_not_run_again_even_if_started_manually():
    record(MON, RunStatus.COMPLETED, trigger="manual")
    assert due_days(settings(), at(MON, "12:30")) == []


def test_missed_days_are_caught_up_oldest_first_and_flagged_late():
    record(MON, RunStatus.COMPLETED)
    due = due_days(settings(), at(WED, "09:00"))  # Tue missed; Wed not yet due
    assert days(due) == [(TUE, "catch-up", True)]


def test_late_start_today_is_flagged():
    assert days(due_days(settings(), at(MON, "15:00"))) == [(MON, "scheduled", True)]


def test_catch_up_never_reaches_before_the_scheduler_was_enabled():
    with Session(get_engine()) as s:
        s.get(AppState, SINCE_KEY).value = WED.isoformat()
        s.commit()
    assert days(due_days(settings(), at(FRI, "08:00"))) == [(WED, "catch-up", True), (date(2026, 11, 19), "catch-up", True)]


def test_failed_run_is_retried_after_a_pause_up_to_three_attempts():
    first = at(MON, "12:00")
    record(MON, RunStatus.FAILED, started=first)
    assert due_days(settings(), first + timedelta(minutes=10)) == []
    assert days(due_days(settings(), first + timedelta(minutes=31))) == [(MON, "retry", True)]
    record(MON, RunStatus.FAILED, started=first + timedelta(minutes=31))
    record(MON, RunStatus.FAILED, started=first + timedelta(minutes=62))
    assert due_days(settings(), first + timedelta(hours=3)) == []  # gave up after 3 attempts


def test_run_in_progress_is_not_duplicated():
    record(MON, RunStatus.RUNNING)
    assert due_days(settings(), at(MON, "12:05")) == []


def test_disabled_schedule_runs_nothing():
    assert due_days(settings(enabled=False), at(MON, "12:00")) == []


def test_custom_time_and_days():
    s = settings(time="16:30", weekdays=(0,))
    assert due_days(s, at(MON, "16:29")) == []
    assert days(due_days(s, at(MON, "16:30"))) == [(MON, "scheduled", False)]
    # Tuesday itself is never due; the only thing due is catching up the missed Monday.
    assert days(due_days(s, at(TUE, "17:00"))) == [(MON, "catch-up", True)]


def test_next_run_at_skips_the_weekend():
    assert next_run_at(settings(), at(FRI, "13:00")) == at(date(2026, 11, 23), "12:00")
    assert next_run_at(settings(), at(MON, "09:00")) == at(MON, "12:00")
    assert next_run_at(settings(enabled=False), at(MON, "09:00")) is None


# --- Scheduler.tick -------------------------------------------------------------------------------


class Recorder:
    """Fake starter: records a completed daily run so the day counts as done."""

    def __init__(self, fail_with: Exception | None = None):
        self.calls: list[tuple[date, str]] = []
        self.fail_with = fail_with

    async def __call__(self, day: date, trigger: str):
        if self.fail_with:
            raise self.fail_with
        self.calls.append((day, trigger))
        run_id = record(day, RunStatus.COMPLETED, trigger=trigger)

        async def done():
            pass

        return {"id": run_id}, asyncio.create_task(done())


async def _tick_with_events(scheduler: Scheduler, bus: EventBus):
    events: list[dict] = []
    async with bus.subscribe() as q:
        result = await scheduler.tick()
        while not q.empty():
            events.append(q.get_nowait())
    return result, events


async def test_tick_runs_due_days_one_at_a_time_and_reports_missed():
    config.ensure_dirs()
    save_settings(Settings(github=GitHubSettings(author="Aeiiiou", repositories=("Aeiiiou/dms",))))
    bus = EventBus()
    starter = Recorder()
    clock = at(WED, "13:00")
    sched = Scheduler(bus, starter, now=lambda: clock)

    first, events = await _tick_with_events(sched, bus)
    assert (first.day, first.trigger) == (MON, "catch-up")
    assert any(e["type"] == "schedule.missed" and "Mon Nov 16" in e["payload"]["message"] for e in events)

    await sched.tick()
    await sched.tick()
    assert starter.calls == [(MON, "catch-up"), (TUE, "catch-up"), (WED, "scheduled")]
    assert await sched.tick() is None  # all caught up


async def test_setup_problem_is_reported_once_not_every_tick():
    config.ensure_dirs()
    save_settings(Settings())
    bus = EventBus()
    sched = Scheduler(bus, Recorder(fail_with=SetupProblem("Gemini API key not set.")), now=lambda: at(MON, "12:01"))
    _, first = await _tick_with_events(sched, bus)
    _, second = await _tick_with_events(sched, bus)
    assert [e["type"] for e in first] == ["schedule.skipped"]
    assert "Gemini API key not set" in first[0]["payload"]["message"]
    assert second == []


async def test_tick_waits_while_another_run_is_in_progress():
    save_settings(Settings())
    bus = EventBus()
    bus.current_run = {"id": 1, "status": "running", "step": None}
    starter = Recorder()
    assert await Scheduler(bus, starter, now=lambda: at(MON, "12:01")).tick() is None
    assert starter.calls == []
