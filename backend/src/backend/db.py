from collections.abc import Iterator

from sqlalchemy import Engine, event, update
from sqlmodel import Session, SQLModel, create_engine

from backend import config
from backend.models import Run, RunStatus, utcnow

_engine: Engine | None = None


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(f"sqlite:///{config.DB_PATH}", connect_args={"check_same_thread": False})
        event.listen(_engine, "connect", _sqlite_pragmas)
    return _engine


def init_db() -> None:
    """Create tables and mark runs left 'running' by a previous process as interrupted."""
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.exec(
            update(Run)
            .where(Run.status == RunStatus.RUNNING)  # type: ignore[arg-type]
            .values(status=RunStatus.INTERRUPTED, finished_at=utcnow())
        )
        s.commit()


def dispose() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None


def session() -> Iterator[Session]:
    """FastAPI dependency."""
    with Session(get_engine()) as s:
        yield s
