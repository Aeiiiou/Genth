import pytest
from starlette.websockets import WebSocketDisconnect

from backend.security import host_allowed
from tests.conftest import WS_URL


def test_health_is_public(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_api_requires_token(client):
    assert client.get("/api/agents").status_code == 401


def test_wrong_token_rejected(client):
    r = client.get("/api/agents", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_valid_token_accepted(client, auth):
    assert client.get("/api/agents", headers=auth).status_code == 200


def test_foreign_host_rejected_even_with_token(client, auth):
    # DNS rebinding: an attacker's domain resolving to 127.0.0.1.
    r = client.get("/api/agents", headers={**auth, "Host": "evil.example:8000"})
    assert r.status_code == 400


def test_foreign_origin_rejected_even_with_token(client, auth):
    r = client.post("/api/runs/mock", headers={**auth, "Origin": "https://evil.example"})
    assert r.status_code == 403


@pytest.mark.parametrize(
    ("host", "ok"),
    [
        ("localhost:5173", True),
        ("127.0.0.1:8000", True),
        ("[::1]:8000", True),
        ("localhost", True),
        ("localhost.evil.example", False),
        ("192.168.1.5:8000", False),
        ("", False),
        (None, False),
    ],
)
def test_host_allowlist(host, ok):
    assert host_allowed(host) is ok


def test_websocket_requires_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(WS_URL) as ws:
            ws.receive_json()
    assert exc.value.reason == "missing or invalid session token"


def test_websocket_rejects_foreign_origin(client, auth):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(WS_URL, headers={**auth, "Origin": "https://evil.example"}) as ws:
            ws.receive_json()
    assert exc.value.reason == "origin not allowed"


def test_websocket_rejects_foreign_host(client, auth):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("ws://evil.example:8000/api/ws", headers=auth) as ws:
            ws.receive_json()
    assert exc.value.reason == "host not allowed"
