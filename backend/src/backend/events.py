"""Event bus: every agent event is saved to SQLite, then pushed to live subscribers (WebSockets).

The bus also keeps the latest status and location of each agent plus the current run, so a client
that (re)connects gets a snapshot and is immediately in sync.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlmodel import Session

from backend.agents.registry import AGENTS, valid_spot
from backend.db import get_engine
from backend.models import AgentEvent, event_to_dict

QUEUE_SIZE = 256

Event = dict[str, Any]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self.agent_status: dict[str, dict[str, str]] = {
            a.id: {"text": a.idle_text, "tone": a.idle_tone} for a in AGENTS.values()
        }
        self.agent_spot: dict[str, str] = {a: "desk" for a in AGENTS}
        self.current_run: dict[str, Any] | None = None

    async def publish(
        self,
        type: str,
        *,
        agent_id: str | None = None,
        run_id: int | None = None,
        **payload: Any,
    ) -> Event:
        if agent_id is not None and agent_id not in AGENTS:
            raise ValueError(f"unknown agent {agent_id!r}")
        if type == "agent.move" and not valid_spot(payload.get("spot")):
            raise ValueError(f"unknown spot {payload.get('spot')!r}")

        event = await asyncio.to_thread(self._persist, AgentEvent(type=type, agent_id=agent_id, run_id=run_id, payload=payload))
        self._apply(event)
        for q in list(self._subscribers):
            if q.full():  # slow client: drop its oldest event rather than block everyone
                q.get_nowait()
            q.put_nowait(event)
        return event

    @staticmethod
    def _persist(event: AgentEvent) -> Event:
        with Session(get_engine()) as s:
            s.add(event)
            s.commit()
            s.refresh(event)
            return event_to_dict(event)

    def _apply(self, e: Event) -> None:
        p, agent = e["payload"], e["agentId"]
        match e["type"]:
            case "agent.status":
                self.agent_status[agent] = {"text": p["text"], "tone": p.get("tone", "busy")}
            case "agent.move":
                self.agent_spot[agent] = p["spot"]
            case "run.started":
                self.current_run = {"id": e["runId"], "status": "running", "step": p.get("message")}
            case "run.step" if self.current_run:
                self.current_run["step"] = p.get("message")
            case "run.completed" | "run.failed" | "run.interrupted" if self.current_run:
                self.current_run = {**self.current_run, "status": e["type"].removeprefix("run."), "step": p.get("message")}

    def snapshot(self) -> Event:
        return {
            "type": "snapshot",
            "agents": {a: {"status": self.agent_status[a], "spot": self.agent_spot[a]} for a in AGENTS},
            "run": self.current_run,
        }

    @property
    def run_in_progress(self) -> bool:
        return bool(self.current_run and self.current_run["status"] == "running")

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[Event]]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers.add(q)
        try:
            yield q
        finally:
            self._subscribers.discard(q)
