"""Run lifecycle shared by every kind of run (demo, GitHub fetch, and later the daily run).

``launch_run`` claims the single run slot, records the run, executes the script in the background,
and always leaves the run in a final state (completed, failed or interrupted) with an event.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from sqlmodel import Session

from backend import config
from backend.agents.registry import name
from backend.db import get_engine
from backend.events import EventBus
from backend.models import Run, RunStatus, Task, TaskStatus, run_to_dict, utcnow

log = logging.getLogger(__name__)


class RunAlreadyInProgress(Exception):
    pass


class RunFailed(Exception):
    """A failure with a message meant for the person watching the office."""


def _create_run(kind: str) -> dict:
    with Session(get_engine()) as s:
        run = Run(kind=kind)
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


def _finish_task(task_id: int, status: TaskStatus) -> None:
    with Session(get_engine()) as s:
        task = s.get(Task, task_id)
        if task:
            task.status, task.finished_at = status, utcnow()
            s.add(task)
            s.commit()


class RunContext:
    """What a run script uses to talk to the office."""

    def __init__(self, bus: EventBus, run_id: int) -> None:
        self.bus, self.run_id = bus, run_id

    async def pause(self, seconds: float) -> None:
        """Gives the office time to animate; scaled by GENTH_DELAY_SCALE (0 in tests)."""
        await asyncio.sleep(seconds * config.DELAY_SCALE)

    async def say(self, agent: str, text: str, tone: str = "busy") -> None:
        await self.bus.publish("agent.status", agent_id=agent, run_id=self.run_id, text=text, tone=tone, message=text)

    async def speak(self, agent: str, text: str) -> None:
        """A line of dialogue: shown as a speech bubble over the agent and in the feed."""
        await self.bus.publish("agent.speech", agent_id=agent, run_id=self.run_id, text=text, message=f"“{text}”")

    async def move(self, agent: str, spot: str) -> None:
        if spot == "desk":
            message = "Back to desk"
        elif spot.startswith("visit:"):
            message = f"Walking over to {name(spot[6:])}"
        else:
            message = f"Heading to the {spot.replace('_', ' ')}"
        await self.bus.publish("agent.move", agent_id=agent, run_id=self.run_id, spot=spot, message=message)

    async def step(self, message: str) -> None:
        await self.bus.publish("run.step", run_id=self.run_id, message=message)

    async def notice(self, agent: str | None, message: str, **payload: object) -> None:
        await self.bus.publish("run.notice", agent_id=agent, run_id=self.run_id, message=message, **payload)

    async def start_task(self, agent: str, name: str) -> int:
        return await asyncio.to_thread(_start_task, self.run_id, agent, name)

    async def finish_task(self, task_id: int, status: TaskStatus = TaskStatus.COMPLETED) -> None:
        await asyncio.to_thread(_finish_task, task_id, status)


Script = Callable[[RunContext], Awaitable[None]]


async def _execute(bus: EventBus, run_id: int, label: str, script: Script) -> None:
    ctx = RunContext(bus, run_id)
    try:
        await bus.publish("run.started", agent_id="supervisor", run_id=run_id, message=f"{label} started")
        await script(ctx)
        await asyncio.to_thread(_finish_run, run_id, RunStatus.COMPLETED)
        await bus.publish("run.completed", run_id=run_id, message=f"{label} completed")
    except asyncio.CancelledError:
        await asyncio.to_thread(_finish_run, run_id, RunStatus.INTERRUPTED)
        raise
    except RunFailed as exc:
        await asyncio.to_thread(_finish_run, run_id, RunStatus.FAILED, str(exc))
        await bus.publish("run.failed", run_id=run_id, message=f"{label} failed: {exc}")
    except Exception as exc:
        log.exception("run %s (%s) crashed", run_id, label)
        await asyncio.to_thread(_finish_run, run_id, RunStatus.FAILED, f"internal error: {type(exc).__name__}")
        await bus.publish("run.failed", run_id=run_id, message=f"{label} failed: internal error (see backend log)")


async def launch_run(bus: EventBus, kind: str, label: str, script: Script) -> tuple[dict, asyncio.Task[None]]:
    if bus.run_in_progress:
        raise RunAlreadyInProgress
    # Claim the slot before the first await so concurrent requests can't both start a run.
    bus.current_run = {"id": None, "status": "running", "step": "Starting"}
    try:
        run = await asyncio.to_thread(_create_run, kind)
    except Exception:
        bus.current_run = None
        raise
    task = asyncio.create_task(_execute(bus, run["id"], label, script), name=f"run-{run['id']}-{kind}")
    return run, task
