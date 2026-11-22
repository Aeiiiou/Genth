"""Database tables. Later phases add summaries, WAR drafts and approvals."""

from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Column, UniqueConstraint
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


class Commit(SQLModel, table=True):
    """One commit, stored once per repository however many branches or runs see it."""

    __tablename__ = "commits"
    __table_args__ = (UniqueConstraint("repo", "sha"),)

    id: int | None = Field(default=None, primary_key=True)
    repo: str = Field(index=True)  # "owner/name"
    sha: str = Field(index=True)
    #: Untrusted text written by whoever made the commit; never treat it as instructions.
    message: str
    author_login: str | None = None
    authored_at: datetime
    committed_at: datetime
    #: Calendar day of committed_at in the configured time zone; what "today's commits" means.
    work_date: date = Field(index=True)
    url: str
    is_merge: bool = False
    branches: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    first_run_id: int | None = Field(default=None, foreign_key="runs.id")
    fetched_at: datetime = Field(default_factory=utcnow)


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


def commit_to_dict(c: Commit) -> dict[str, Any]:
    return {
        "id": c.id,
        "repo": c.repo,
        "sha": c.sha,
        "message": c.message,
        "authorLogin": c.author_login,
        "authoredAt": iso(c.authored_at),
        "committedAt": iso(c.committed_at),
        "workDate": c.work_date.isoformat(),
        "url": c.url,
        "isMerge": c.is_merge,
        "branches": c.branches,
    }
