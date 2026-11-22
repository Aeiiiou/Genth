"""A scripted demo run that walks through the daily workflow with fake data.

It exercises the event pipeline (DB → bus → WebSocket → 3D office) before the real agents exist.
All numbers it reports are made up and labelled "demo".
"""

import asyncio
import logging

from sqlmodel import Session

from backend import config
from backend.db import get_engine
from backend.events import EventBus
from backend.models import Run, RunStatus, Task, TaskStatus, run_to_dict, utcnow

log = logging.getLogger(__name__)


class RunAlreadyInProgress(Exception):
    pass


def _create_run() -> dict:
    with Session(get_engine()) as s:
        run = Run(kind="mock")
        s.add(run)
        s.commit()
        s.refresh(run)
        return run_to_dict(run)


def _finish_run(run_id: int, status: RunStatus, error: str | None = None) -> None:
    with Session(get_engine()) as s:
        run = s.get(Run, run_id)
        if run:
            run.status, run.finished_at, run.error = status, utcnow(), error
            s.add(run)
            s.commit()


def _start_task(run_id: int, agent_id: str, name: str) -> int:
    with Session(get_engine()) as s:
        task = Task(run_id=run_id, agent_id=agent_id, name=name)
        s.add(task)
        s.commit()
        s.refresh(task)
        assert task.id is not None
        return task.id


def _finish_task(task_id: int) -> None:
    with Session(get_engine()) as s:
        task = s.get(Task, task_id)
        if task:
            task.status, task.finished_at = TaskStatus.COMPLETED, utcnow()
            s.add(task)
            s.commit()


class _Script:
    def __init__(self, bus: EventBus, run_id: int) -> None:
        self.bus, self.run_id = bus, run_id

    async def pause(self, seconds: float) -> None:
        await asyncio.sleep(seconds * config.MOCK_DELAY_SCALE)

    async def say(self, agent: str, text: str, tone: str = "busy") -> None:
        await self.bus.publish("agent.status", agent_id=agent, run_id=self.run_id, text=text, tone=tone, message=text)

    async def move(self, agent: str, spot: str) -> None:
        await self.bus.publish("agent.move", agent_id=agent, run_id=self.run_id, spot=spot,
                               message=f"Heading to the {spot}" if spot != "desk" else "Back to desk")

    async def step(self, message: str) -> None:
        await self.bus.publish("run.step", run_id=self.run_id, message=message)

    async def task(self, agent: str, name: str) -> int:
        return await asyncio.to_thread(_start_task, self.run_id, agent, name)

    async def done(self, task_id: int) -> None:
        await asyncio.to_thread(_finish_task, task_id)


async def _script(bus: EventBus, run_id: int) -> None:
    s = _Script(bus, run_id)
    await bus.publish("run.started", agent_id="supervisor", run_id=run_id, message="Demo run started")

    await s.say("supervisor", "Planning today's run")
    await s.pause(1.5)

    await s.step("Hand-off in the meeting room")
    await s.move("supervisor", "meeting")
    await s.move("github", "meeting")
    await s.say("github", "On my way", "busy")
    await s.pause(5)
    await s.say("supervisor", "Assigned: fetch today's commits")
    await s.pause(1.5)

    await s.step("GitHub Agent fetching commits")
    await s.move("github", "desk")
    await s.move("supervisor", "desk")
    t = await s.task("github", "Fetch commits")
    await s.say("github", "Fetching commits…")
    await s.pause(5)
    await s.say("github", "Found 12 commits (demo)", "ok")
    await s.done(t)
    await s.pause(1)

    await s.step("Summary Agent drafting accomplishments")
    await s.move("github", "cafe")
    await s.say("github", "Coffee break", "waiting")
    t = await s.task("summary", "Draft accomplishments")
    await s.say("summary", "Drafting summaries…")
    await s.pause(4)
    await s.say("summary", "3 accomplishments drafted (demo)", "ok")
    await s.done(t)

    await s.step("Supervisor verifying citations")
    t = await s.task("supervisor", "Verify citations")
    await s.say("supervisor", "Checking every claim cites a commit…")
    await s.pause(3)
    await s.say("supervisor", "All claims cite commits", "ok")
    await s.done(t)

    await s.step("Approval (demo auto-approves)")
    await s.say("summary", "Awaiting your approval", "waiting")
    await s.pause(3)
    await s.say("summary", "Approved (demo)", "ok")

    await s.step("WAR Agent preparing the draft")
    t = await s.task("war", "Map to WAR fields")
    await s.say("war", "Mapping to WAR fields…")
    await s.pause(4)
    await s.say("war", "WAR draft ready (demo)", "ok")
    await s.done(t)
    await s.pause(1.5)

    await s.move("summary", "lounge")
    await s.say("summary", "Taking a break", "waiting")
    await s.move("github", "desk")
    await bus.publish("run.completed", run_id=run_id, message="Demo run completed")
    await s.pause(4)

    # Back to the idle state.
    await s.say("supervisor", "All ok", "ok")
    await s.say("github", "Waiting for 2 PM run", "waiting")
    await s.say("war", "Nothing to file", "waiting")
    await s.move("summary", "desk")
    await s.say("summary", "Idle", "waiting")


async def _run(bus: EventBus, run_id: int) -> None:
    try:
        await _script(bus, run_id)
        await asyncio.to_thread(_finish_run, run_id, RunStatus.COMPLETED)
    except asyncio.CancelledError:
        await asyncio.to_thread(_finish_run, run_id, RunStatus.INTERRUPTED)
        raise
    except Exception as exc:  # surface failures in the office instead of dying silently
        log.exception("demo run %s failed", run_id)
        await asyncio.to_thread(_finish_run, run_id, RunStatus.FAILED, str(exc))
        await bus.publish("run.failed", run_id=run_id, message=f"Demo run failed: {exc}")


async def start_mock_run(bus: EventBus) -> tuple[dict, asyncio.Task[None]]:
    if bus.run_in_progress:
        raise RunAlreadyInProgress
    # Claim the slot before the first await so concurrent requests can't both start a run.
    bus.current_run = {"id": None, "status": "running", "step": "Starting"}
    try:
        run = await asyncio.to_thread(_create_run)
    except Exception:
        bus.current_run = None
        raise
    task = asyncio.create_task(_run(bus, run["id"]), name=f"mock-run-{run['id']}")
    return run, task
