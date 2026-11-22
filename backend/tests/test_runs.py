import pytest

from backend import config
from backend.agents.registry import valid_spot
from tests.conftest import WS_URL


def _events_until(ws, event_type: str, limit: int = 200) -> list[dict]:
    seen = []
    for _ in range(limit):
        e = ws.receive_json()
        seen.append(e)
        if e["type"] == event_type:
            return seen
    raise AssertionError(f"never received {event_type}; got {[e['type'] for e in seen]}")


def test_snapshot_on_connect(client, auth):
    with client.websocket_connect(WS_URL, headers=auth) as ws:
        snap = ws.receive_json()
    assert snap["type"] == "snapshot"
    assert set(snap["agents"]) == {"supervisor", "github", "summary", "reviewer", "war", "govops"}
    assert snap["agents"]["github"]["spot"] == "desk"


def test_mock_run_streams_events_and_records_tasks(client, auth):
    with client.websocket_connect(WS_URL, headers=auth) as ws:
        ws.receive_json()  # snapshot
        r = client.post("/api/runs/mock", headers=auth)
        assert r.status_code == 202
        run_id = r.json()["id"]
        events = _events_until(ws, "run.completed")

    types = [e["type"] for e in events]
    assert types[0] == "run.started"
    assert all(e["runId"] == run_id for e in events)
    moves = [(e["agentId"], e["payload"]["spot"]) for e in events if e["type"] == "agent.move"]
    # Boss chairs the meeting, MEDG presents, then carries the commits to Lil Ed.
    assert ("supervisor", "meeting_head") in moves
    assert moves.index(("github", "presenter")) < moves.index(("github", "visit:summary")) < moves.index(("github", "desk"))
    assert all((a, "meeting") in moves for a in ("summary", "reviewer", "war", "govops"))
    assert any(e["type"] == "agent.speech" and e["agentId"] == "supervisor" for e in events)
    assert all("message" in e["payload"] for e in events)

    run = client.get(f"/api/runs/{run_id}", headers=auth).json()
    assert [t["agentId"] for t in run["tasks"]] == ["github", "summary", "reviewer", "war", "govops"]
    assert all(t["status"] == "completed" for t in run["tasks"])

    stored = client.get("/api/events", params={"run_id": run_id, "limit": 500}, headers=auth).json()
    assert [e["id"] for e in stored][: len(events)] == [e["id"] for e in events]


def test_second_run_rejected_while_one_is_running_and_shutdown_interrupts_it(client, auth, monkeypatch):
    monkeypatch.setattr(config, "DELAY_SCALE", 1.0)  # keep the first run going
    first = client.post("/api/runs/mock", headers=auth)
    assert first.status_code == 202
    assert client.post("/api/runs/mock", headers=auth).status_code == 409

    # Leaving the client shuts the app down mid-run.
    client.__exit__(None, None, None)
    from fastapi.testclient import TestClient

    from backend.app import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as fresh:
        run = fresh.get(f"/api/runs/{first.json()['id']}", headers=auth).json()
    assert run["status"] == "interrupted"


def test_unknown_run_404(client, auth):
    assert client.get("/api/runs/999999", headers=auth).status_code == 404


@pytest.mark.parametrize(
    ("spot", "ok"),
    [("desk", True), ("meeting_head", True), ("visit:summary", True), ("visit:nobody", False), ("roof", False), (None, False)],
)
def test_move_spots_are_validated(spot, ok):
    assert valid_spot(spot) is ok
