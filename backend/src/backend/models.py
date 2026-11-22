"""Database tables. Later phases add repositories, commits, summaries, WAR drafts and approvals."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


class RunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    #: The backend stopped while the run was in progress.
    INTERRUPTED = "interrupted"


class TaskStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Run(SQLModel, table=True):
    __tablename__ = "runs"

    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True)  # "mock" now; "daily" from Phase 5
    status: RunStatus = Field(default=RunStatus.RUNNING, index=True)
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None
    error: str | None = None


class Task(SQLModel, table=True):
    __tablename__ = "tasks"

    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="runs.id", index=True)
    agent_id: str = Field(index=True)
    name: str
    status: TaskStatus = Field(default=TaskStatus.RUNNING)
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None


class AgentEvent(SQLModel, table=True):
    __tablename__ = "agent_events"

    id: int | None = Field(default=None, primary_key=True)
    run_id: int | None = Field(default=None, foreign_key="runs.id", index=True)
    agent_id: str | None = Field(default=None, index=True)
    type: str = Field(index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow, index=True)


def iso(dt: datetime | None) -> str | None:
    """ISO-8601 in UTC. SQLite drops tzinfo, so naive values are treated as UTC."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).isoformat()


def event_to_dict(e: AgentEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "runId": e.run_id,
        "agentId": e.agent_id,
        "type": e.type,
        "payload": e.payload,
        "createdAt": iso(e.created_at),
    }


def run_to_dict(r: Run) -> dict[str, Any]:
    return {
        "id": r.id,
        "kind": r.kind,
        "status": r.status,
        "startedAt": iso(r.started_at),
        "finishedAt": iso(r.finished_at),
        "error": r.error,
    }
