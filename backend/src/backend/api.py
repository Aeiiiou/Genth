import asyncio
import datetime as dt
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlmodel import Session, col, select

from backend import reviews
from backend.agents.daily import check_ai_setup, default_llm_factory, start_daily_run, start_summary_run
from backend.agents.github_agent import SetupProblem, check_setup, start_github_run
from backend.agents.mock import start_mock_run
from backend.db import session
from backend.events import EventBus
from backend.models import (
    AgentEvent,
    Commit,
    Run,
    SummaryBatch,
    SummaryStatus,
    Task,
    commit_to_dict,
    event_to_dict,
    iso,
    run_to_dict,
)
from backend.runs import RunAlreadyInProgress
from backend.secret_store import get_gemini_key, get_github_token
from backend.settings import SettingsError, load_settings

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(session)]


def get_bus(request: Request) -> EventBus:
    return request.app.state.bus


Bus = Annotated[EventBus, Depends(get_bus)]


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/agents")
def agents(bus: Bus) -> dict[str, Any]:
    return bus.snapshot()


@router.get("/runs")
def list_runs(db: DB, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> list[dict[str, Any]]:
    runs = db.exec(select(Run).order_by(col(Run.id).desc()).limit(limit)).all()
    return [run_to_dict(r) for r in runs]


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: DB) -> dict[str, Any]:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found")
    tasks = db.exec(select(Task).where(Task.run_id == run_id).order_by(col(Task.id))).all()
    return {
        **run_to_dict(run),
        "tasks": [
            {"id": t.id, "agentId": t.agent_id, "name": t.name, "status": t.status,
             "startedAt": iso(t.started_at), "finishedAt": iso(t.finished_at)}
            for t in tasks
        ],
    }


@router.get("/events")
def list_events(
    db: DB,
    run_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> list[dict[str, Any]]:
    """Most recent events, oldest first."""
    q = select(AgentEvent)
    if run_id is not None:
        q = q.where(AgentEvent.run_id == run_id)
    rows = db.exec(q.order_by(col(AgentEvent.id).desc()).limit(limit)).all()
    return [event_to_dict(e) for e in reversed(rows)]


def _track(request: Request, task: asyncio.Task[None]) -> None:
    request.app.state.tasks.add(task)
    task.add_done_callback(request.app.state.tasks.discard)


def _token_provider(request: Request):
    # Tests swap in a fake token provider and HTTP transport; production uses the OS credential store.
    return getattr(request.app.state, "github_token_provider", get_github_token)


@router.post("/runs/mock", status_code=status.HTTP_202_ACCEPTED)
async def start_mock(request: Request, bus: Bus) -> dict[str, Any]:
    try:
        run, task = await start_mock_run(bus)
    except RunAlreadyInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "a run is already in progress") from None
    _track(request, task)
    return run


class GitHubRunRequest(BaseModel):
    date: dt.date | None = None


@router.post("/runs/github", status_code=status.HTTP_202_ACCEPTED)
async def start_github(request: Request, bus: Bus, body: GitHubRunRequest | None = None) -> dict[str, Any]:
    try:
        run, task = await start_github_run(
            bus,
            body.date if body else None,
            token_provider=_token_provider(request),
            transport=getattr(request.app.state, "github_transport", None),
        )
    except RunAlreadyInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "a run is already in progress") from None
    except SetupProblem as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    _track(request, task)
    return run


@router.get("/github/status")
def github_status(request: Request) -> dict[str, Any]:
    """Whether GitHub is set up. Reports only whether a token exists, never the token."""
    try:
        settings = load_settings()
    except SettingsError as exc:
        return {"ready": False, "problem": f"settings.json: {exc}", "repositories": [], "author": "", "tokenConfigured": False}
    token_configured = bool(_token_provider(request)())
    try:
        check_setup(_token_provider(request))
        problem = None
    except SetupProblem as exc:
        problem = str(exc)
    return {
        "ready": problem is None,
        "problem": problem,
        "author": settings.github.author,
        "repositories": list(settings.github.repositories),
        "allBranches": settings.github.all_branches,
        "timezone": settings.timezone,
        "today": dt.datetime.now(settings.tz).date().isoformat(),
        "tokenConfigured": token_configured,
    }


@router.get("/commits")
def list_commits(db: DB, day: Annotated[dt.date | None, Query(alias="date")] = None) -> dict[str, Any]:
    """Stored commits for one day (default: today in the configured time zone), newest first."""
    try:
        tz = load_settings().tz
    except SettingsError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"settings.json: {exc}") from None
    target = day or dt.datetime.now(tz).date()
    rows = db.exec(select(Commit).where(Commit.work_date == target).order_by(col(Commit.committed_at).desc())).all()
    return {"date": target.isoformat(), "commits": [commit_to_dict(c) for c in rows]}


# --- AI summaries -------------------------------------------------------------------------------


def _ai_overrides(request: Request) -> dict[str, Any]:
    state = request.app.state
    return {
        "key_provider": getattr(state, "gemini_key_provider", get_gemini_key),
        "llm_factory": getattr(state, "llm_factory", default_llm_factory),
    }


class DayRequest(BaseModel):
    date: dt.date | None = None


async def _launch(request: Request, starter) -> dict[str, Any]:
    try:
        run, task = await starter
    except RunAlreadyInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "a run is already in progress") from None
    except SetupProblem as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    _track(request, task)
    return run


@router.post("/runs/daily", status_code=status.HTTP_202_ACCEPTED)
async def start_daily(request: Request, bus: Bus, body: DayRequest | None = None) -> dict[str, Any]:
    """Fetch the day's commits, then draft accomplishments for review."""
    return await _launch(
        request,
        start_daily_run(
            bus,
            body.date if body else None,
            token_provider=_token_provider(request),
            transport=getattr(request.app.state, "github_transport", None),
            **_ai_overrides(request),
        ),
    )


@router.post("/runs/summary", status_code=status.HTTP_202_ACCEPTED)
async def start_summary(request: Request, bus: Bus, body: DayRequest | None = None) -> dict[str, Any]:
    """Re-draft a day from commits already stored."""
    return await _launch(request, start_summary_run(bus, body.date if body else None, **_ai_overrides(request)))


@router.get("/ai/status")
def ai_status(request: Request) -> dict[str, Any]:
    """Whether the AI is set up. Reports only whether a key exists, never the key."""
    try:
        ai = load_settings().ai
    except SettingsError as exc:
        return {"ready": False, "problem": f"settings.json: {exc}", "keyConfigured": False}
    try:
        check_ai_setup(_ai_overrides(request)["key_provider"])
        problem = None
    except SetupProblem as exc:
        problem = str(exc)
    return {"ready": problem is None, "problem": problem, "provider": ai.provider, "model": ai.model, "keyConfigured": problem is None}


@router.get("/summaries")
def list_summaries(
    db: DB,
    status_filter: Annotated[SummaryStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[dict[str, Any]]:
    q = select(SummaryBatch)
    if status_filter is not None:
        q = q.where(SummaryBatch.status == status_filter)
    batches = db.exec(q.order_by(col(SummaryBatch.id).desc()).limit(limit)).all()
    return [reviews.batch_to_dict(db, b) for b in batches]


def _review_call(fn, *args) -> Any:
    try:
        return fn(*args)
    except reviews.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
    except reviews.ReviewError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT if "already" in str(exc) else status.HTTP_400_BAD_REQUEST, str(exc)) from None


@router.get("/summaries/{batch_id}")
def get_summary(batch_id: int, db: DB) -> dict[str, Any]:
    batch = _review_call(reviews.get_batch, db, batch_id)
    return {**reviews.batch_to_dict(db, batch), "audit": reviews.audit_trail(db, batch_id)}


class ItemIn(BaseModel):
    id: int | None = None
    text: str
    commitIds: list[int]


class ItemsIn(BaseModel):
    items: list[ItemIn]


@router.put("/summaries/{batch_id}/items")
def edit_summary(batch_id: int, body: ItemsIn, db: DB) -> dict[str, Any]:
    edits = [reviews.ItemEdit(text=i.text, commit_ids=i.commitIds, id=i.id) for i in body.items]
    batch = _review_call(reviews.edit_items, db, batch_id, edits)
    return reviews.batch_to_dict(db, batch)


class DecisionIn(BaseModel):
    note: str | None = None


async def _decide(batch_id: int, db: Session, bus: EventBus, approve: bool, note: str | None) -> dict[str, Any]:
    fn = reviews.approve if approve else reviews.reject
    batch = _review_call(fn, db, batch_id, note)
    verb = "approved" if approve else "rejected"
    await bus.publish(
        f"summary.{verb}",
        agent_id="summary",
        batchId=batch_id,
        date=batch.work_date.isoformat(),
        message=f"You {verb} the summary for {batch.work_date.isoformat()}",
    )
    await bus.publish(
        "agent.status", agent_id="summary", text="Approved by you" if approve else "Rejected by you",
        tone="ok" if approve else "waiting", message=f"Summary {verb}",
    )
    return reviews.batch_to_dict(db, batch)


@router.post("/summaries/{batch_id}/approve")
async def approve_summary(batch_id: int, db: DB, bus: Bus, body: DecisionIn | None = None) -> dict[str, Any]:
    return await _decide(batch_id, db, bus, True, body.note if body else None)


@router.post("/summaries/{batch_id}/reject")
async def reject_summary(batch_id: int, db: DB, bus: Bus, body: DecisionIn | None = None) -> dict[str, Any]:
    return await _decide(batch_id, db, bus, False, body.note if body else None)


async def _wait_for_disconnect(ws: WebSocket) -> None:
    try:
        while True:
            await ws.receive_text()  # the client never needs to send; this just notices it leaving
    except WebSocketDisconnect:
        return


@router.websocket("/ws")
async def events_ws(ws: WebSocket) -> None:
    bus: EventBus = ws.app.state.bus
    await ws.accept()
    async with bus.subscribe() as queue:
        await ws.send_json(bus.snapshot())
        disconnected = asyncio.create_task(_wait_for_disconnect(ws))
        try:
            while True:
                next_event = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait({next_event, disconnected}, return_when=asyncio.FIRST_COMPLETED)
                if disconnected in done:
                    next_event.cancel()
                    return
                await ws.send_json(next_event.result())
        except (WebSocketDisconnect, RuntimeError):
            return
        finally:
            disconnected.cancel()
