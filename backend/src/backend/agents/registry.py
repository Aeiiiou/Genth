"""The office's agents. IDs must match the frontend layout (frontend/src/office/layout).

IDs are stable (they're stored with every event); display names can change freely.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentInfo:
    id: str
    name: str
    idle_text: str
    idle_tone: str = "waiting"


AGENTS: dict[str, AgentInfo] = {
    a.id: a
    for a in (
        AgentInfo("supervisor", "Boss Cheats", "All ok", "ok"),
        AgentInfo("github", "MEDG", "Waiting for the 12:00 run"),
        AgentInfo("summary", "Lil Ed", "Idle"),
        AgentInfo("reviewer", "Glorious YK", "Ready to check citations"),
        AgentInfo("war", "Young King", "Nothing to file"),
        AgentInfo("govops", "MEDG_PHP", "GovOps link not set up yet"),
    )
}

#: Named places an agent can walk to; the frontend maps each to positions on a floor.
#: "visit:<agent id>" (standing beside that agent's desk) is also accepted.
SPOTS = frozenset({"desk", "meeting", "meeting_head", "presenter", "cafe", "gaming", "lounge", "lobby", "records"})


def name(agent_id: str) -> str:
    return AGENTS[agent_id].name if agent_id in AGENTS else agent_id


def valid_spot(spot: object) -> bool:
    if not isinstance(spot, str):
        return False
    if spot.startswith("visit:"):
        return spot[6:] in AGENTS
    return spot in SPOTS
