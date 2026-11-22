import asyncio
import datetime as dt
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlmodel import Session, col, select

from backend.agents.github_agent import SetupProblem, check_setup, start_github_run
from backend.agents.mock import start_mock_run
from backend.db import session
from backend.events import EventBus
from backend.models import AgentEvent, Commit, Run, Task, commit_to_dict, event_to_dict, iso, run_to_dict
from backend.runs import RunAlreadyInProgress
from backend.secret_store import get_github_token
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
