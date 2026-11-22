"""Provider-neutral interface for the AI model used by the Summary Agent.

Agents depend only on :class:`LLM`; switching providers means adding a client, not changing agents.
"""

from typing import Any, Protocol


class LLMError(Exception):
    """A model call failed. The message is meant for the person watching the office."""


class LLMAuthError(LLMError):
    pass


class LLMRateLimited(LLMError):
    pass


class LLMUnavailable(LLMError):
    """The model is overloaded or temporarily down (worth trying another model)."""


class LLM(Protocol):
    model: str

    async def generate_json(self, *, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        """Returns the model's answer parsed as a JSON object matching ``schema``."""
        ...

    async def aclose(self) -> None: ...
