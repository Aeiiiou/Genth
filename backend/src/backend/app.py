import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend import config, db
from backend.api import router
from backend.events import EventBus
from backend.security import LocalOnlyMiddleware, load_or_create_token


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.init_db()
    app.state.bus = EventBus()
    app.state.tasks = set()
    yield
    # Stop background runs; each marks its run as interrupted.
    for task in list(app.state.tasks):
        task.cancel()
    await asyncio.gather(*app.state.tasks, return_exceptions=True)
    db.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Genth", lifespan=lifespan)
    app.include_router(router)
    app.add_middleware(LocalOnlyMiddleware, token=load_or_create_token())
    return app


app = create_app()
