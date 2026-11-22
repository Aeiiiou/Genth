"""Database tables. Later phases add WAR drafts."""

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


class SummaryStatus(StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    #: A newer draft for the same day replaced this one before it was reviewed.
    SUPERSEDED = "superseded"


class SummaryBatch(SQLModel, table=True):
    """One AI draft of a day's accomplishments, reviewed as a unit."""

    __tablename__ = "summary_batches"

    id: int | None = Field(default=None, primary_key=True)
    work_date: date = Field(index=True)
    run_id: int | None = Field(default=None, foreign_key="runs.id")
    status: SummaryStatus = Field(default=SummaryStatus.PENDING_REVIEW, index=True)
    model: str
    #: Commits the draft was written from (ids), so the review screen can show coverage.
    source_commit_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)
    reviewed_at: datetime | None = None
    review_note: str | None = None


class Accomplishment(SQLModel, table=True):
    __tablename__ = "accomplishments"

    id: int | None = Field(default=None, primary_key=True)
    batch_id: int = Field(foreign_key="summary_batches.id", index=True)
    position: int
    text: str
    #: Every accomplishment must cite at least one stored commit.
    commit_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    #: The AI's wording, kept when the reviewer edits the text.
    original_text: str | None = None


class AuditLog(SQLModel, table=True):
    """Append-only record of every review action, with content before and after."""

    __tablename__ = "audit_log"

    id: int | None = Field(default=None, primary_key=True)
    entity: str = Field(index=True)  # e.g. "summary_batch"
    entity_id: int = Field(index=True)
    action: str  # "created" | "edited" | "approved" | "rejected" | "superseded"
    before: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    after: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    note: str | None = None
    at: datetime = Field(default_factory=utcnow, index=True)


class DailyRun(SQLModel, table=True):
    """Links a daily-workflow run to the work day it covered and what started it."""

    __tablename__ = "daily_runs"

    run_id: int = Field(foreign_key="runs.id", primary_key=True)
    work_date: date = Field(index=True)
    trigger: str  # "manual" | "scheduled" | "catch-up" | "retry"


class AppState(SQLModel, table=True):
    """Small persistent key/value facts, e.g. when the scheduler was first enabled."""

    __tablename__ = "app_state"

    key: str = Field(primary_key=True)
    value: str


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
