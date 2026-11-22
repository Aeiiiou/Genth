"""Read-only GitHub REST client: branches and commits, with pagination, retries and rate limits.

Error messages are written for the person running Genth and never include the token.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)

API = "https://api.github.com"
MAX_PAGES = 50
#: Wait for a rate-limit reset only if it is this close; otherwise fail and report it.
MAX_RATE_LIMIT_WAIT_S = 60


class GitHubError(Exception):
    pass


class GitHubAuthError(GitHubError):
    pass


class GitHubRateLimited(GitHubError):
    pass


@dataclass
class CommitRecord:
    repo: str
    sha: str
    message: str
    author_login: str | None
    authored_at: datetime
    committed_at: datetime
    url: str
    is_merge: bool
    branches: set[str] = field(default_factory=set)


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_expiry(value: str | None) -> datetime | None:
    """Parses GitHub's ``github-authentication-token-expiration`` header, e.g. '2026-02-20 08:00:00 UTC'."""
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S %z"):
        try:
            dt = datetime.strptime(value.strip(), fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _repo_path(repo: str) -> str:
    owner, name = repo.split("/", 1)
    return f"/repos/{quote(owner, safe='')}/{quote(name, safe='')}"


class GitHubClient:
    def __init__(
        self,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        max_retries: int = 3,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=API,
            transport=transport,
            timeout=20,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "Genth",
            },
        )
        self._max_retries = max_retries
        self._sleep = sleep
        self.token_expires_at: datetime | None = None

    async def __aenter__(self) -> "GitHubClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        for attempt in range(self._max_retries + 1):
            try:
                r = await self._client.get(url, params=params)
            except httpx.TransportError as exc:
                if attempt == self._max_retries:
                    raise GitHubError(f"Could not reach GitHub ({type(exc).__name__}). Check your connection.") from None
                await self._sleep(2**attempt)
                continue

            if expiry := _parse_expiry(r.headers.get("github-authentication-token-expiration")):
                self.token_expires_at = expiry

            if r.status_code < 400:
                return r
            if r.status_code == 401:
                raise GitHubAuthError("GitHub rejected the token: it is invalid, revoked or expired.")
            if self._is_rate_limited(r):
                wait = self._rate_limit_wait(r)
                if wait > MAX_RATE_LIMIT_WAIT_S or attempt == self._max_retries:
                    raise GitHubRateLimited(f"GitHub rate limit reached; try again in about {int(wait // 60) + 1} min.")
                await self._sleep(wait + 1)
                continue
            if r.status_code == 403:
                raise GitHubError("GitHub denied access. Check that the token can read this repository's contents.")
            if r.status_code == 404:
                raise GitHubError("Not found, or the token has no access to it.")
            if r.status_code == 409:  # empty repository
                return r
            if r.status_code >= 500 and attempt < self._max_retries:
                await self._sleep(2**attempt)
                continue
            raise GitHubError(f"GitHub returned an error (HTTP {r.status_code}).")
        raise GitHubError("GitHub request failed after retries.")  # pragma: no cover

    @staticmethod
    def _is_rate_limited(r: httpx.Response) -> bool:
        if r.status_code == 429:
            return True
        # Primary limit: remaining hits 0. Secondary (abuse) limit: 403 with retry-after.
        return r.status_code == 403 and (r.headers.get("x-ratelimit-remaining") == "0" or "retry-after" in r.headers)

    @staticmethod
    def _rate_limit_wait(r: httpx.Response) -> float:
        if retry_after := r.headers.get("retry-after"):
            return float(retry_after)
        if reset := r.headers.get("x-ratelimit-reset"):
            return max(0.0, float(reset) - datetime.now(UTC).timestamp())
        return 60.0

    async def _paginate(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        url: str | None = path
        query: dict[str, Any] | None = {**params, "per_page": 100}
        for _ in range(MAX_PAGES):
            if url is None:
                break
            r = await self._get(url, query)
            if r.status_code == 409:  # empty repository has no commits/branches
                return []
            items.extend(r.json())
            url = r.links.get("next", {}).get("url")
            query = None  # the next URL already carries the query
        return items

    async def current_login(self) -> str:
        r = await self._get("/user")
        return r.json()["login"]

    async def branches(self, repo: str) -> list[str]:
        return [b["name"] for b in await self._paginate(f"{_repo_path(repo)}/branches", {})]

    async def commits(self, repo: str, *, author: str, since: datetime, until: datetime, branch: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "author": author,
            "since": since.astimezone(UTC).isoformat().replace("+00:00", "Z"),
            "until": until.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        }
        if branch:
            params["sha"] = branch
        return await self._paginate(f"{_repo_path(repo)}/commits", params)

    async def commits_in_window(
        self, repo: str, *, author: str, since: datetime, until: datetime, all_branches: bool
    ) -> dict[str, CommitRecord]:
        """The author's commits in [since, until), de-duplicated by SHA across branches."""
        branch_names: list[str | None] = list(await self.branches(repo)) if all_branches else [None]
        found: dict[str, CommitRecord] = {}
        for branch in branch_names:
            for c in await self.commits(repo, author=author, since=since, until=until, branch=branch):
                sha = c["sha"]
                if sha in found:
                    if branch:
                        found[sha].branches.add(branch)
                    continue
                commit = c["commit"]
                found[sha] = CommitRecord(
                    repo=repo,
                    sha=sha,
                    message=commit["message"],
                    author_login=(c.get("author") or {}).get("login"),
                    authored_at=_parse_time(commit["author"]["date"]),
                    committed_at=_parse_time(commit["committer"]["date"]),
                    url=c["html_url"],
                    is_merge=len(c.get("parents", [])) > 1,
                    branches={branch} if branch else set(),
                )
        # GitHub's since/until filter on the committer date and are inclusive; enforce the window.
        return {sha: rec for sha, rec in found.items() if since <= rec.committed_at < until}
