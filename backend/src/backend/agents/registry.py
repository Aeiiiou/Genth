"""The office's agents. IDs must match the frontend layout (frontend/src/office/layout)."""

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
        AgentInfo("supervisor", "Supervisor", "All ok", "ok"),
        AgentInfo("github", "GitHub Agent", "Waiting for 2 PM run"),
        AgentInfo("summary", "Summary Agent", "Idle"),
        AgentInfo("war", "WAR Agent", "Nothing to file"),
    )
}

#: Named places an agent can walk to. The frontend maps each to tile positions.
SPOTS = frozenset({"desk", "meeting", "cafe", "lounge", "commons"})
