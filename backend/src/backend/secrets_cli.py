"""Store or remove Genth secrets without them ever appearing on screen or in shell history.

    uv run genth-secret github            # prompt (hidden) for the GitHub token, verify it, store it
    uv run genth-secret github --delete   # remove it
"""

import argparse
import asyncio
import getpass
import sys

from backend.integrations.github_client import GitHubClient, GitHubError
from backend.secret_store import GITHUB_TOKEN, delete_secret, set_secret

TOKEN_PREFIXES = ("github_pat_", "ghp_")


async def _verify(token: str) -> tuple[str, str | None]:
    async with GitHubClient(token) as gh:
        login = await gh.current_login()
        expires = gh.token_expires_at
    return login, expires.date().isoformat() if expires else None


def _github(delete: bool) -> int:
    if delete:
        print("GitHub token removed." if delete_secret(GITHUB_TOKEN) else "No GitHub token was stored.")
        return 0

    token = getpass.getpass("Paste your GitHub token (input is hidden): ").strip()
    if not token:
        print("Nothing entered; no changes made.")
        return 1
    if not token.startswith(TOKEN_PREFIXES):
        print("That doesn't look like a GitHub personal access token (expected 'github_pat_…').")
        return 1

    print("Checking the token with GitHub…")
    try:
        login, expires = asyncio.run(_verify(token))
    except GitHubError as exc:
        print(f"GitHub didn't accept it: {exc}")
        return 1

    set_secret(GITHUB_TOKEN, token)
    print(f"Saved to the system credential store. Token belongs to: {login}")
    if expires:
        print(f"It expires on {expires}.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="genth-secret", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", choices=["github"], help="which secret to manage")
    parser.add_argument("--delete", action="store_true", help="remove the stored secret")
    args = parser.parse_args()
    sys.exit(_github(args.delete))
