import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend import config, db
from backend.agents.daily import start_daily_run
from backend.api import router
from backend.events import EventBus
from backend.scheduler import Scheduler
from backend.security import LocalOnlyMiddleware, load_or_create_token


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.init_db()
    app.state.bus = EventBus()
    app.state.tasks = set()
    if config.SCHEDULER_ENABLED:
        bus = app.state.bus

        async def starter(day, trigger):
            return await start_daily_run(bus, day, trigger=trigger)

        app.state.tasks.add(asyncio.create_task(Scheduler(bus, starter).run_forever(), name="scheduler"))
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
