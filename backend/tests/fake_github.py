"""A tiny in-memory GitHub REST API for tests (served through httpx.MockTransport)."""

from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

import httpx

PAGE_SIZE = 2  # small, so pagination gets exercised


@dataclass
class FakeCommit:
    sha: str
    message: str
    committed: str  # ISO-8601 with Z
    author: str = "Aeiiiou"
    parents: int = 1


@dataclass
class FakeGitHub:
    #: repo -> branch -> commits on that branch
    repos: dict[str, dict[str, list[FakeCommit]]] = field(default_factory=dict)
    #: Responses to return (in order) before normal handling, e.g. errors to test retries.
    queued: list[httpx.Response] = field(default_factory=list)
    headers: dict[str, str] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _json(self, data, status=200, extra: dict[str, str] | None = None) -> httpx.Response:
        return httpx.Response(status, json=data, headers={**self.headers, **(extra or {})})

    def _page(self, request: httpx.Request, items: list) -> httpx.Response:
        q = parse_qs(urlsplit(str(request.url)).query)
        page = int(q.get("page", ["1"])[0])
        chunk = items[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
        extra = {}
        if page * PAGE_SIZE < len(items):
            nxt = request.url.copy_merge_params({"page": str(page + 1)})
            extra["link"] = f'<{nxt}>; rel="next"'
        return self._json(chunk, extra=extra)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.queued:
            return self.queued.pop(0)
        parts = request.url.path.strip("/").split("/")
        if parts == ["user"]:
            return self._json({"login": "Aeiiiou"})
        if len(parts) >= 4 and parts[0] == "repos":
            repo = f"{parts[1]}/{parts[2]}"
            if repo not in self.repos:
                return self._json({"message": "Not Found"}, 404)
            branches = self.repos[repo]
            if not branches:
                return self._json({"message": "Git Repository is empty."}, 409)
            if parts[3] == "branches":
                return self._page(request, [{"name": b} for b in branches])
            if parts[3] == "commits":
                q = parse_qs(urlsplit(str(request.url)).query)
                branch = q.get("sha", [next(iter(branches))])[0]
                since = datetime.fromisoformat(q["since"][0].replace("Z", "+00:00"))
                until = datetime.fromisoformat(q["until"][0].replace("Z", "+00:00"))
                author = q["author"][0]
                matches = [
                    c for c in branches.get(branch, [])
                    if c.author == author and since <= datetime.fromisoformat(c.committed.replace("Z", "+00:00")) <= until
                ]
                return self._page(request, [self._commit_json(repo, c) for c in matches])
        return self._json({"message": "unexpected request"}, 500)

    @staticmethod
    def _commit_json(repo: str, c: FakeCommit) -> dict:
        return {
            "sha": c.sha,
            "html_url": f"https://github.com/{repo}/commit/{c.sha}",
            "author": {"login": c.author},
            "parents": [{"sha": f"p{i}"} for i in range(c.parents)],
            "commit": {
                "message": c.message,
                "author": {"date": c.committed},
                "committer": {"date": c.committed},
            },
        }
