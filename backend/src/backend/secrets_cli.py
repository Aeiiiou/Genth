"""Store or remove Genth secrets without them ever appearing on screen or in shell history.

    uv run genth-secret github            # prompt (hidden) for the GitHub token, verify it, store it
    uv run genth-secret gemini            # prompt (hidden) for the Gemini API key, verify it, store it
    uv run genth-secret github --delete   # remove a stored secret
"""

import argparse
import asyncio
import getpass
import sys

from backend.integrations.gemini_client import GeminiClient
from backend.integrations.github_client import GitHubClient, GitHubError
from backend.integrations.llm import LLMError
from backend.secret_store import GEMINI_API_KEY, GITHUB_TOKEN, delete_secret, set_secret
from backend.settings import SettingsError, load_settings

GITHUB_PREFIXES = ("github_pat_", "ghp_")
SECRET_NAMES = {"github": GITHUB_TOKEN, "gemini": GEMINI_API_KEY}


def _ask(prompt: str) -> str | None:
    value = getpass.getpass(f"{prompt} (input is hidden): ").strip()
    if not value:
        print("Nothing entered; no changes made.")
        return None
    return value


async def _verify_github(token: str) -> tuple[str, str | None]:
    async with GitHubClient(token) as gh:
        login = await gh.current_login()
        expires = gh.token_expires_at
    return login, expires.date().isoformat() if expires else None


def _github() -> int:
    token = _ask("Paste your GitHub token")
    if token is None:
        return 1
    if not token.startswith(GITHUB_PREFIXES):
        print("That doesn't look like a GitHub personal access token (expected 'github_pat_…').")
        return 1
    print("Checking the token with GitHub…")
    try:
        login, expires = asyncio.run(_verify_github(token))
    except GitHubError as exc:
        print(f"GitHub didn't accept it: {exc}")
        return 1
    set_secret(GITHUB_TOKEN, token)
    print(f"Saved to the system credential store. Token belongs to: {login}")
    if expires:
        print(f"It expires on {expires}.")
    return 0


async def _verify_gemini(key: str, model: str) -> list[str]:
    async with GeminiClient(key, model) as gemini:
        return await gemini.list_models()


def _gemini() -> int:
    try:
        model = load_settings().ai.model
    except SettingsError as exc:
        print(f"Fix settings.json first: {exc}")
        return 1
    key = _ask("Paste your Gemini API key")
    if key is None:
        return 1
    print("Checking the key with Google…")
    try:
        models = asyncio.run(_verify_gemini(key, model))
    except LLMError as exc:
        print(f"Google didn't accept it: {exc}")
        return 1
    set_secret(GEMINI_API_KEY, key)
    print(f"Saved to the system credential store. The key can use {len(models)} models.")
    if model in models:
        print(f"Configured model '{model}' is available.")
    else:
        flash = [m for m in models if "flash" in m][:6]
        print(f"Configured model '{model}' was not in the list. Set ai.model in settings.json to one of: {', '.join(flash) or ', '.join(models[:6])}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="genth-secret", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", choices=sorted(SECRET_NAMES), help="which secret to manage")
    parser.add_argument("--delete", action="store_true", help="remove the stored secret")
    args = parser.parse_args()
    if args.delete:
        removed = delete_secret(SECRET_NAMES[args.name])
        print(f"{args.name} secret removed." if removed else f"No {args.name} secret was stored.")
        sys.exit(0)
    sys.exit(_github() if args.name == "github" else _gemini())
