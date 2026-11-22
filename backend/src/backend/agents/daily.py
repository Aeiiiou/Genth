"""The daily workflow: GitHub Agent fetches the day's commits, Summary Agent drafts accomplishments,
Supervisor checks citations, and the draft waits for human review. (Phase 5 schedules this.)"""

import asyncio
from collections.abc import Callable
from datetime import date

import httpx
from sqlmodel import Session

from backend.agents.github_agent import SetupProblem, TokenProvider, check_setup, fetch_day, resolve_day
from backend.agents.summary_agent import summarize_day
from backend.db import get_engine
from backend.events import EventBus
from backend.integrations.gemini_client import GeminiClient
from backend.integrations.llm import LLM
from backend.models import DailyRun
from backend.runs import RunContext, launch_run
from backend.secret_store import get_gemini_key, get_github_token
from backend.settings import AISettings, Settings, SettingsError, load_settings

KeyProvider = Callable[[], str | None]
LLMFactory = Callable[[AISettings, str], LLM]


def default_llm_factory(ai: AISettings, key: str) -> LLM:
    return GeminiClient(key, ai.model, fallback_models=ai.fallback_models)


def check_ai_setup(key_provider: KeyProvider = get_gemini_key) -> str:
    key = key_provider()
    if not key:
        raise SetupProblem("Gemini API key not set. In backend/, run: uv run genth-secret gemini")
    return key


def _settings() -> Settings:
    try:
        return load_settings()
    except SettingsError as exc:
        raise SetupProblem(f"settings.json: {exc}") from None


async def _summarize(ctx: RunContext, day: date, settings: Settings, key: str, llm_factory: LLMFactory) -> None:
    llm = llm_factory(settings.ai, key)
    try:
        await ctx.move("summary", "meeting")
        await ctx.move("supervisor", "meeting")
        await ctx.say("supervisor", "Handing today's commits to the Summary Agent")
        await ctx.pause(4)
        await ctx.move("summary", "desk")
        await ctx.move("supervisor", "desk")
        await summarize_day(ctx, day, llm, settings.tz, settings.ai.exclude_merges)
    finally:
        await llm.aclose()
    await ctx.say("supervisor", "All ok", "ok")


async def start_daily_run(
    bus: EventBus,
    day: date | None = None,
    *,
    token_provider: TokenProvider = get_github_token,
    key_provider: KeyProvider = get_gemini_key,
    llm_factory: LLMFactory = default_llm_factory,
    transport: httpx.AsyncBaseTransport | None = None,
    trigger: str = "manual",
) -> tuple[dict, asyncio.Task[None]]:
    settings, token = check_setup(token_provider)
    key = check_ai_setup(key_provider)
    target = resolve_day(settings, day)

    async def script(ctx: RunContext) -> None:
        await fetch_day(ctx, target, settings, token, transport=transport)
        await _summarize(ctx, target, settings, key, llm_factory)

    label = "Daily run" if target == resolve_day(settings, None) else f"Daily run for {target.isoformat()}"
    run, task = await launch_run(bus, "daily", label, script)
    await asyncio.to_thread(_record_daily_run, run["id"], target, trigger)
    return run, task


def _record_daily_run(run_id: int, day: date, trigger: str) -> None:
    with Session(get_engine()) as s:
        s.add(DailyRun(run_id=run_id, work_date=day, trigger=trigger))
        s.commit()


async def start_summary_run(
    bus: EventBus,
    day: date | None = None,
    *,
    key_provider: KeyProvider = get_gemini_key,
    llm_factory: LLMFactory = default_llm_factory,
) -> tuple[dict, asyncio.Task[None]]:
    """Re-drafts a day from commits already stored (no GitHub calls)."""
    settings = _settings()
    key = check_ai_setup(key_provider)
    target = resolve_day(settings, day)

    async def script(ctx: RunContext) -> None:
        await _summarize(ctx, target, settings, key, llm_factory)

    return await launch_run(bus, "summary", "Summary", script)
