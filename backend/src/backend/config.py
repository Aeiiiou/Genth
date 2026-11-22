"""Runtime settings. All user data and secrets live outside the repo."""

import os
from pathlib import Path


def _default_data_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) if local else Path.home() / ".local" / "share"
    return base / "Genth"


DATA_DIR = Path(os.environ.get("GENTH_DATA_DIR") or _default_data_dir())
SECRETS_DIR = DATA_DIR / "secrets"
DB_PATH = DATA_DIR / "genth.db"
TOKEN_PATH = SECRETS_DIR / "session_token"
SETTINGS_PATH = DATA_DIR / "settings.json"

HOST = "127.0.0.1"
PORT = 8000

#: Browser origins allowed to call the API (the Vite dev server).
ALLOWED_ORIGINS = frozenset(
    os.environ.get("GENTH_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
)
#: Host names accepted in the Host header (any port). Blocks DNS-rebinding attacks.
ALLOWED_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "[::1]"})

#: Multiplier for the pauses that pace runs so the office animation can keep up; 0 = instant (tests).
DELAY_SCALE = float(os.environ.get("GENTH_DELAY_SCALE", "1"))


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)

#: Set GENTH_SCHEDULER=0 to keep the automatic daily run from starting (tests do this).
SCHEDULER_ENABLED = os.environ.get("GENTH_SCHEDULER", "1") != "0"
