import os
import tempfile

# Must be set before backend.config is imported: tests never touch the real %LOCALAPPDATA%\Genth.
os.environ["GENTH_DATA_DIR"] = tempfile.mkdtemp(prefix="genth-test-")
os.environ["GENTH_MOCK_DELAY_SCALE"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app import create_app  # noqa: E402
from backend.security import load_or_create_token  # noqa: E402

BASE_URL = "http://127.0.0.1:8000"
ORIGIN = "http://localhost:5173"
# Starlette's websocket_connect ignores base_url and would send "Host: testserver", which the
# DNS-rebinding check rightly rejects, so WebSocket tests use an absolute localhost URL.
WS_URL = "ws://127.0.0.1:8000/api/ws"


@pytest.fixture
def token() -> str:
    return load_or_create_token()


@pytest.fixture
def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Origin": ORIGIN}


@pytest.fixture
def client():
    with TestClient(create_app(), base_url=BASE_URL) as c:
        yield c
