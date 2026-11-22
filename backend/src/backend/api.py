import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlmodel import Session, col, select

from backend.agents.mock import RunAlreadyInProgress, start_mock_run
from backend.db import session
from backend.events import EventBus
from backend.models import AgentEvent, Run, Task, event_to_dict, iso, run_to_dict

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


@router.post("/runs/mock", status_code=status.HTTP_202_ACCEPTED)
async def start_mock(request: Request, bus: Bus) -> dict[str, Any]:
    try:
        run, task = await start_mock_run(bus)
    except RunAlreadyInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "a run is already in progress") from None
    request.app.state.tasks.add(task)
    task.add_done_callback(request.app.state.tasks.discard)
    return run


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
