import json
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.agents.github_agent import day_window
from backend.app import create_app
from backend.integrations.github_client import GitHubAuthError, GitHubClient, GitHubRateLimited
from backend.settings import GitHubSettings, Settings, SettingsError, _parse, save_settings
from tests.conftest import BASE_URL, WS_URL
from tests.fake_github import FakeCommit, FakeGitHub

TOKEN = "github_pat_TEST_SECRET_VALUE_123"
MANILA = ZoneInfo("Asia/Manila")
REPOS = ("Aeiiiou/govops", "Aeiiiou/dms", "Aeiiiou/locator")


def configure(repos=REPOS, author="Aeiiiou"):
    config.ensure_dirs()
    save_settings(Settings(github=GitHubSettings(author=author, repositories=tuple(repos))))


def make_client(fake: FakeGitHub, token: str | None = TOKEN) -> TestClient:
    app = create_app()
    app.state.github_token_provider = lambda: token
    app.state.github_transport = fake.transport()
    return TestClient(app, base_url=BASE_URL)


def run_and_collect(client: TestClient, auth: dict, day: str) -> tuple[dict, list[dict]]:
    with client.websocket_connect(WS_URL, headers=auth) as ws:
        ws.receive_json()  # snapshot
        r = client.post("/api/runs/github", json={"date": day}, headers=auth)
        assert r.status_code == 202, r.text
        events = []
        for _ in range(300):
            e = ws.receive_json()
            events.append(e)
            if e["type"] in ("run.completed", "run.failed"):
                return r.json(), events
    raise AssertionError("run never finished")


def manila(day: str, hhmm: str) -> str:
    """A Manila wall-clock time on `day`, as the UTC ISO string GitHub would return."""
    local = datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=MANILA)
    return local.astimezone(UTC).isoformat().replace("+00:00", "Z")


def sample_github(day: str) -> FakeGitHub:
    shared = FakeCommit("c2", "Fix login redirect", manila(day, "11:00"))
    return FakeGitHub(
        repos={
            "Aeiiiou/govops": {
                "main": [
                    FakeCommit("c1", "Add WAR export", manila(day, "09:15")),
                    shared,
                    FakeCommit("c0", "Yesterday's work", manila(day, "00:00").replace("T16", "T15")),  # 23:xx day before
                    FakeCommit("cx", "Someone else", manila(day, "10:00"), author="teammate"),
                ],
                "feature/maps": [shared, FakeCommit("c3", "Map clustering", manila(day, "15:30"))],
            },
            "Aeiiiou/dms": {},  # empty repository
            "Aeiiiou/locator": {"main": [FakeCommit("m1", "Merge branch 'x'", manila(day, "17:00"), parents=2)]},
        }
    )


@pytest.fixture
def auth_headers(auth):
    return auth


def test_day_window_is_a_manila_calendar_day():
    start, end = day_window(date(2026, 11, 20), MANILA)
    assert start.astimezone(UTC) == datetime(2026, 11, 19, 16, tzinfo=UTC)
    assert end - start == timedelta(days=1)


def test_fetch_stores_each_commit_once_across_branches_and_reruns(auth):
    day = "2026-11-02"
    configure()
    fake = sample_github(day)
    with make_client(fake) as client:
        _, events = run_and_collect(client, auth, day)
        assert events[-1]["type"] == "run.completed", [e["payload"].get("message") for e in events]

        commits = client.get("/api/commits", params={"date": day}, headers=auth).json()["commits"]
        by_sha = {c["sha"]: c for c in commits}
        # Only the author's commits, only that day, the shared one once with both branches.
        assert set(by_sha) == {"c1", "c2", "c3", "m1"}
        assert by_sha["c2"]["branches"] == ["feature/maps", "main"]
        assert by_sha["m1"]["isMerge"] is True
        assert all(c["workDate"] == day for c in commits)

        statuses = [e["payload"]["text"] for e in events if e["type"] == "agent.status" and e["agentId"] == "github"]
        assert statuses[-1] == "4 commits today (4 new)"

        # Re-running the same day adds nothing.
        _, events2 = run_and_collect(client, auth, day)
        assert events2[-1]["type"] == "run.completed"
        again = client.get("/api/commits", params={"date": day}, headers=auth).json()["commits"]
        assert len(again) == 4
        statuses2 = [e["payload"]["text"] for e in events2 if e["type"] == "agent.status" and e["agentId"] == "github"]
        assert statuses2[-1] == "4 commits today (0 new)"


def test_rerun_records_new_branches_for_known_commits(auth):
    day = "2026-11-03"
    configure(repos=["Aeiiiou/govops"])
    c = FakeCommit("b1", "Work", manila(day, "10:00"))
    fake = FakeGitHub(repos={"Aeiiiou/govops": {"main": [c]}})
    with make_client(fake) as client:
        run_and_collect(client, auth, day)
        fake.repos["Aeiiiou/govops"]["release"] = [c]
        _, events = run_and_collect(client, auth, day)
        commits = client.get("/api/commits", params={"date": day}, headers=auth).json()["commits"]
    assert commits[0]["branches"] == ["main", "release"]
    assert any("seen on new branches" in e["payload"].get("message", "") for e in events)


def test_requests_use_author_and_manila_window(auth):
    day = "2026-11-04"
    configure(repos=["Aeiiiou/govops"])
    fake = FakeGitHub(repos={"Aeiiiou/govops": {"main": []}})
    with make_client(fake) as client:
        run_and_collect(client, auth, day)
    commit_reqs = [r for r in fake.requests if r.url.path.endswith("/commits")]
    assert commit_reqs
    params = commit_reqs[0].url.params
    assert params["author"] == "Aeiiiou"
    assert params["since"] == "2026-11-03T16:00:00Z"
    assert params["until"] == "2026-11-04T16:00:00Z"
    assert params["sha"] == "main"
    assert all(r.headers["authorization"] == f"Bearer {TOKEN}" for r in fake.requests)
    assert all(r.method == "GET" for r in fake.requests)  # read-only


def test_missing_token_is_reported_up_front(auth):
    configure()
    with make_client(FakeGitHub(), token=None) as client:
        r = client.post("/api/runs/github", json={}, headers=auth)
        status = client.get("/api/github/status", headers=auth).json()
    assert r.status_code == 400
    assert "genth-secret github" in r.json()["detail"]
    assert status["ready"] is False and status["tokenConfigured"] is False


def test_missing_repositories_reported(auth):
    configure(repos=[])
    with make_client(FakeGitHub()) as client:
        r = client.post("/api/runs/github", json={}, headers=auth)
    assert r.status_code == 400
    assert "repositories" in r.json()["detail"]


def test_future_date_rejected(auth):
    configure()
    tomorrow = (datetime.now(MANILA).date() + timedelta(days=1)).isoformat()
    with make_client(FakeGitHub()) as client:
        r = client.post("/api/runs/github", json={"date": tomorrow}, headers=auth)
    assert r.status_code == 400


def test_rejected_token_fails_the_run_clearly_without_leaking_it(auth):
    day = "2026-11-05"
    configure(repos=["Aeiiiou/govops"])
    fake = FakeGitHub(repos={"Aeiiiou/govops": {"main": []}}, queued=[httpx.Response(401, json={"message": "Bad credentials"})])
    with make_client(fake) as client:
        run, events = run_and_collect(client, auth, day)
        stored = client.get("/api/runs/" + str(run["id"]), headers=auth).json()
        all_events = client.get("/api/events", params={"limit": 500}, headers=auth).text
        status_text = client.get("/api/github/status", headers=auth).text
    assert events[-1]["type"] == "run.failed"
    assert "rejected the token" in events[-1]["payload"]["message"]
    assert stored["status"] == "failed"
    assert TOKEN not in json.dumps(events) and TOKEN not in all_events and TOKEN not in status_text


def test_inaccessible_repo_names_the_repo(auth):
    day = "2026-11-06"
    configure(repos=["Aeiiiou/secret-repo"])
    with make_client(FakeGitHub(repos={})) as client:
        _, events = run_and_collect(client, auth, day)
    assert events[-1]["type"] == "run.failed"
    assert "Aeiiiou/secret-repo" in events[-1]["payload"]["message"]


def test_expiring_token_warns(auth):
    day = "2026-11-07"
    configure(repos=["Aeiiiou/govops"])
    soon = (datetime.now(UTC) + timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S UTC")
    fake = FakeGitHub(repos={"Aeiiiou/govops": {"main": []}}, headers={"github-authentication-token-expiration": soon})
    with make_client(fake) as client:
        _, events = run_and_collect(client, auth, day)
    warnings = [e for e in events if e["payload"].get("warning") == "token_expiring"]
    assert warnings and "expires in" in warnings[0]["payload"]["message"]


# --- client-level behaviour -------------------------------------------------------------------


async def _client(fake: FakeGitHub, sleeps: list[float]) -> GitHubClient:
    async def fake_sleep(s: float) -> None:
        sleeps.append(s)

    return GitHubClient(TOKEN, transport=fake.transport(), sleep=fake_sleep)


async def test_rate_limit_waits_for_a_close_reset_then_retries():
    reset = int(datetime.now(UTC).timestamp()) + 5
    fake = FakeGitHub(queued=[httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(reset)})])
    sleeps: list[float] = []
    async with await _client(fake, sleeps) as gh:
        assert await gh.current_login() == "Aeiiiou"
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 7


async def test_rate_limit_with_a_distant_reset_fails_fast():
    reset = int(datetime.now(UTC).timestamp()) + 3600
    fake = FakeGitHub(queued=[httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(reset)})])
    async with await _client(fake, []) as gh:
        with pytest.raises(GitHubRateLimited):
            await gh.current_login()


async def test_server_errors_are_retried_with_backoff():
    fake = FakeGitHub(queued=[httpx.Response(502), httpx.Response(503)])
    sleeps: list[float] = []
    async with await _client(fake, sleeps) as gh:
        assert await gh.current_login() == "Aeiiiou"
    assert sleeps == [1, 2]


async def test_auth_error_is_not_retried():
    fake = FakeGitHub(queued=[httpx.Response(401)])
    sleeps: list[float] = []
    async with await _client(fake, sleeps) as gh:
        with pytest.raises(GitHubAuthError):
            await gh.current_login()
    assert sleeps == []


@pytest.mark.parametrize(
    "raw",
    [
        {"github": {"repositories": ["not-a-repo"]}},
        {"github": {"repositories": ["Aeiiiou/../etc"]}},
        {"github": {"author": "bad login!"}},
        {"github": {"repositories": ["Aeiiiou/a", "aeiiiou/A"]}},
        {"timezone": "Mars/Olympus"},
    ],
)
def test_settings_validation(raw):
    with pytest.raises(SettingsError):
        _parse(raw)
