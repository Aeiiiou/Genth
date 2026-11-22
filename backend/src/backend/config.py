"""Runtime paths. All user data and secrets live outside the repo."""

import os
from pathlib import Path


def _default_data_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) if local else Path.home() / ".local" / "share"
    return base / "Genth"


DATA_DIR = Path(os.environ.get("GENTH_DATA_DIR") or _default_data_dir())
SECRETS_DIR = DATA_DIR / "secrets"
DB_PATH = DATA_DIR / "genth.db"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
