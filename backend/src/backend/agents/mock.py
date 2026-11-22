"""A scripted demo run that walks through the whole workflow with fake data.

It shows the office choreography end to end, including the steps whose real agents don't exist yet
(Young King's WAR draft and MEDG_PHP's GovOps submission). Every number is made up and labelled "demo".
"""

import asyncio

from backend.agents.registry import AGENTS
from backend.events import EventBus
from backend.runs import RunContext, launch_run

ATTENDEES = ("summary", "reviewer", "war", "govops")


async def _script(s: RunContext) -> None:
    # Meeting.
    await s.say("supervisor", "Calling the team meeting")
    await s.speak("supervisor", "Team, meeting in the 3F meeting room! (demo)")
    await s.step("Team meeting in the 3F meeting room")
    await s.move("supervisor", "meeting_head")
    await s.move("github", "presenter")
    for a in ATTENDEES:
        await s.move(a, "meeting")
    await s.pause(16)
    await s.speak("supervisor", "MEDG, what did we ship today?")
    await s.pause(2)

    await s.step("MEDG presenting commits")
    t = await s.start_task("github", "Fetch commits")
    await s.say("github", "Presenting today's commits")
    for repo, n in (("govops", 5), ("dms", 4), ("locator", 3)):
        await s.speak("github", f"{repo}: {n} commits (demo).")
        await s.pause(2)
    await s.say("github", "12 commits today (demo)", "ok")
    await s.finish_task(t)
    await s.speak("supervisor", "Thanks MEDG. Lil Ed, please turn these into accomplishments.")
    await s.pause(2)
    await s.step("Meeting ended")
    await s.move("supervisor", "desk")
    for a in ATTENDEES:
        await s.move(a, "desk")

    # Hand-off to Lil Ed.
    await s.move("github", "visit:summary")
    await s.pause(10)
    await s.speak("github", "Here are today's commits, Lil Ed.")
    await s.pause(2)
    await s.speak("summary", "Got them, thanks!")
    await s.move("github", "desk")

    await s.step("Lil Ed drafting accomplishments")
    t = await s.start_task("summary", "Draft accomplishments")
    await s.say("summary", "Drafting summaries…")
    await s.pause(5)
    await s.finish_task(t)

    # Citation check.
    await s.move("summary", "visit:reviewer")
    await s.pause(8)
    await s.speak("summary", "Glorious YK, can you check the citations?")
    await s.step("Glorious YK checking citations")
    t = await s.start_task("reviewer", "Verify citations")
    await s.say("reviewer", "Checking every claim cites a commit…")
    await s.pause(3)
    await s.speak("reviewer", "All 3 statements cite real commits. Looks good! (demo)")
    await s.say("reviewer", "All claims cite commits", "ok")
    await s.finish_task(t)
    await s.move("summary", "desk")
    await s.move("reviewer", "visit:supervisor")
    await s.pause(16)
    await s.speak("reviewer", "Boss, the draft is checked and ready.")
    await s.pause(2)
    await s.speak("supervisor", "Great. Approving it for the demo.")
    await s.move("reviewer", "desk")

    # WAR and GovOps (later phases, faked here).
    await s.step("Young King preparing the WAR (demo)")
    await s.move("supervisor", "visit:war")
    await s.pause(16)
    await s.speak("supervisor", "Young King, put this week's WAR together.")
    await s.pause(2)
    t = await s.start_task("war", "Map to WAR fields")
    await s.say("war", "Mapping to WAR fields…")
    await s.speak("war", "On it, boss!")
    await s.pause(4)
    await s.say("war", "WAR draft ready (demo)", "ok")
    await s.finish_task(t)
    await s.move("war", "visit:govops")
    await s.pause(8)
    await s.speak("war", "MEDG_PHP, this one's ready for GovOps.")
    await s.step("MEDG_PHP dry-run submission (demo)")
    t = await s.start_task("govops", "Dry-run submission (demo)")
    await s.say("govops", "Dry run: nothing is sent")
    await s.pause(3)
    await s.speak("govops", "Dry run OK. Nothing was actually submitted. (demo)")
    await s.finish_task(t)
    await s.move("war", "desk")
    await s.move("supervisor", "desk")
    await s.pause(4)

    # Everyone off to celebrate, then back to idle.
    await s.speak("supervisor", "Nice work everyone. Coffee's on me!")
    await s.move("github", "cafe")
    await s.move("summary", "cafe")
    await s.move("reviewer", "gaming")
    await s.pause(6)
    for info in AGENTS.values():
        await s.say(info.id, info.idle_text, info.idle_tone)


async def start_mock_run(bus: EventBus) -> tuple[dict, asyncio.Task[None]]:
    return await launch_run(bus, "mock", "Demo run", _script)
