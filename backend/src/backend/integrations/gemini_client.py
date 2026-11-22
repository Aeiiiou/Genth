"""Google Gemini API client (REST, generateContent with JSON output).

The API key travels in the ``x-goog-api-key`` header, never in a URL, so it can't end up in logs.
Error messages never include it.
"""

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from backend.integrations.llm import LLMAuthError, LLMError, LLMRateLimited, LLMUnavailable

API = "https://generativelanguage.googleapis.com/v1beta"
#: Wait out a quota error only if Google says it clears this soon.
MAX_QUOTA_WAIT_S = 60


def _error_info(r: httpx.Response) -> tuple[str, str, float | None]:
    """(status, reason, retry_delay_seconds) from a Google API error body."""
    try:
        err = r.json().get("error", {})
    except ValueError:
        return "", "", None
    reason, delay = "", None
    for d in err.get("details", []) or []:
        reason = d.get("reason", reason)
        if (m := re.fullmatch(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay", "")))) is not None:
            delay = float(m.group(1))
    return str(err.get("status", "")), reason, delay


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        fallback_models: tuple[str, ...] = (),
        transport: httpx.AsyncBaseTransport | None = None,
        max_retries: int = 3,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        #: The model that produced the last answer (changes if a fallback was used).
        self.model = model
        self._models = (model, *[m for m in fallback_models if m != model])
        self._client = httpx.AsyncClient(
            base_url=API,
            transport=transport,
            timeout=120,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        )
        self._max_retries = max_retries
        self._sleep = sleep

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "GeminiClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def _request(self, method: str, path: str, body: dict | None = None, model: str | None = None) -> dict[str, Any]:
        for attempt in range(self._max_retries + 1):
            try:
                r = await self._client.request(method, path, json=body)
            except httpx.TransportError as exc:
                if attempt == self._max_retries:
                    raise LLMError(f"Could not reach Gemini ({type(exc).__name__}). Check your connection.") from None
                await self._sleep(2**attempt)
                continue

            if r.status_code < 400:
                return r.json()
            status, reason, delay = _error_info(r)
            if reason == "API_KEY_INVALID" or r.status_code == 401:
                raise LLMAuthError("Gemini rejected the API key: it is invalid or was deleted.")
            if r.status_code == 403:
                raise LLMAuthError("Gemini refused the request: the API key lacks access to this API or model.")
            if r.status_code == 404:
                raise LLMError(f"Model {model or self.model!r} is not available. Set ai.model in settings.json.")
            if r.status_code == 429:
                wait = delay if delay is not None else 30.0
                if wait > MAX_QUOTA_WAIT_S or attempt == self._max_retries:
                    raise LLMRateLimited("Gemini free-tier quota reached; try again later (quotas reset per minute and per day).")
                await self._sleep(wait + 1)
                continue
            if r.status_code >= 500:  # e.g. 503 "model overloaded", common on the free tier
                if attempt < self._max_retries:
                    await self._sleep(2 ** (attempt + 1))
                    continue
                raise LLMUnavailable(f"Gemini model {model or self.model!r} is overloaded or unavailable right now (HTTP {r.status_code}).")
            raise LLMError(f"Gemini returned an error (HTTP {r.status_code}{', ' + status if status else ''}).")
        raise LLMError("Gemini request failed after retries.")  # pragma: no cover

    async def list_models(self) -> list[str]:
        """Model names usable with generateContent (also a cheap way to check the key)."""
        data = await self._request("GET", "/models?pageSize=200")
        return [
            m["name"].removeprefix("models/")
            for m in data.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
        ]

    async def generate_json(self, *, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
        }
        last: LLMUnavailable | None = None
        for model in self._models:
            try:
                data = await self._request("POST", f"/models/{quote(model, safe='')}:generateContent", body, model)
            except LLMUnavailable as exc:
                last = exc  # overloaded: try the next model
                continue
            self.model = model
            return self._parse_answer(data)
        assert last is not None
        if len(self._models) > 1:
            raise LLMUnavailable(f"All configured Gemini models are overloaded right now ({', '.join(self._models)}). Try again in a few minutes.")
        raise last

    @staticmethod
    def _parse_answer(data: dict[str, Any]) -> dict[str, Any]:
        candidates = data.get("candidates") or []
        if not candidates:
            block = (data.get("promptFeedback") or {}).get("blockReason")
            raise LLMError(f"Gemini returned no answer{f' (blocked: {block})' if block else ''}.")
        cand = candidates[0]
        if cand.get("finishReason") not in (None, "STOP", "MAX_TOKENS"):
            raise LLMError(f"Gemini stopped early ({cand.get('finishReason')}).")
        # Skip "thought" parts from thinking models; the answer is the remaining text.
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            raise LLMError("Gemini's answer was not valid JSON.") from None
        if not isinstance(parsed, dict):
            raise LLMError("Gemini's answer was not a JSON object.")
        return parsed
