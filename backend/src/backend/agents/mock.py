"""A scripted demo run that walks through the daily workflow with fake data.

It exercises the event pipeline (DB → bus → WebSocket → 3D office) for the steps whose real agents
don't exist yet. Every number it reports is made up and labelled "demo".
"""

import asyncio

from backend.events import EventBus
from backend.runs import RunContext, launch_run


async def _script(s: RunContext) -> None:
    await s.say("supervisor", "Planning today's run")
    await s.pause(1.5)

    await s.step("Hand-off in the meeting room")
    await s.move("supervisor", "meeting")
    await s.move("github", "meeting")
    await s.say("github", "On my way")
    await s.pause(5)
    await s.say("supervisor", "Assigned: fetch today's commits")
    await s.pause(1.5)

    await s.step("GitHub Agent fetching commits")
    await s.move("github", "desk")
    await s.move("supervisor", "desk")
    t = await s.start_task("github", "Fetch commits")
    await s.say("github", "Fetching commits…")
    await s.pause(5)
    await s.say("github", "Found 12 commits (demo)", "ok")
    await s.finish_task(t)
    await s.pause(1)

    await s.step("Summary Agent drafting accomplishments")
    await s.move("github", "cafe")
    await s.say("github", "Coffee break", "waiting")
    t = await s.start_task("summary", "Draft accomplishments")
    await s.say("summary", "Drafting summaries…")
    await s.pause(4)
    await s.say("summary", "3 accomplishments drafted (demo)", "ok")
    await s.finish_task(t)

    await s.step("Supervisor verifying citations")
    t = await s.start_task("supervisor", "Verify citations")
    await s.say("supervisor", "Checking every claim cites a commit…")
    await s.pause(3)
    await s.say("supervisor", "All claims cite commits", "ok")
    await s.finish_task(t)

    await s.step("Approval (demo auto-approves)")
    await s.say("summary", "Awaiting your approval", "waiting")
    await s.pause(3)
    await s.say("summary", "Approved (demo)", "ok")

    await s.step("WAR Agent preparing the draft")
    t = await s.start_task("war", "Map to WAR fields")
    await s.say("war", "Mapping to WAR fields…")
    await s.pause(4)
    await s.say("war", "WAR draft ready (demo)", "ok")
    await s.finish_task(t)
    await s.pause(1.5)

    await s.move("summary", "lounge")
    await s.say("summary", "Taking a break", "waiting")
    await s.move("github", "desk")
    await s.pause(4)

    # Back to the idle state.
    await s.say("supervisor", "All ok", "ok")
    await s.say("github", "Waiting for 2 PM run", "waiting")
    await s.say("war", "Nothing to file", "waiting")
    await s.move("summary", "desk")
    await s.say("summary", "Idle", "waiting")


async def start_mock_run(bus: EventBus) -> tuple[dict, asyncio.Task[None]]:
    return await launch_run(bus, "mock", "Demo run", _script)
