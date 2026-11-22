"""Localhost-only access control.

Every request must
  1. carry a Host header naming localhost (blocks DNS rebinding),
  2. come from an allowed browser Origin, if it has one (blocks other websites), and
  3. present the session token as ``Authorization: Bearer <token>``.

The token lives in %LOCALAPPDATA%\\Genth\\secrets\\session_token. The Vite dev proxy reads it and
adds the header, so the browser never holds it. ``/api/health`` only needs checks 1 and 2.
"""

import hmac
import secrets
from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from backend import config

PUBLIC_PATHS = frozenset({"/api/health"})


def load_or_create_token() -> str:
    config.ensure_dirs()
    path = config.TOKEN_PATH
    if path.exists():
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    return token


def _headers(scope: Scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


def host_allowed(host: str | None) -> bool:
    if not host:
        return False
    hostname = urlsplit(f"//{host}").hostname or ""
    if ":" in hostname:  # IPv6 literals come back without brackets
        hostname = f"[{hostname}]"
    return hostname in config.ALLOWED_HOSTNAMES


def origin_allowed(origin: str | None) -> bool:
    return origin is None or origin in config.ALLOWED_ORIGINS


def token_valid(header: str | None, token: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].encode(), token.encode())


class LocalOnlyMiddleware:
    """Pure ASGI middleware so it covers both HTTP and WebSocket connections."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = _headers(scope)
        problem: tuple[int, str] | None = None
        if not host_allowed(headers.get("host")):
            problem = (400, "host not allowed")
        elif not origin_allowed(headers.get("origin")):
            problem = (403, "origin not allowed")
        elif scope["path"] not in PUBLIC_PATHS and not token_valid(headers.get("authorization"), self.token):
            problem = (401, "missing or invalid session token")

        if problem is None:
            await self.app(scope, receive, send)
        elif scope["type"] == "websocket":
            # Rejecting before accept makes the server answer the handshake with 403.
            await send({"type": "websocket.close", "code": 1008, "reason": problem[1]})
        else:
            await JSONResponse({"detail": problem[1]}, status_code=problem[0])(scope, receive, send)
