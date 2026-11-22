"""Secrets in the OS credential store (Windows Credential Manager on Windows), via keyring.

Values never touch the repo, settings.json, the database, logs or events.
"""

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "Genth"
GITHUB_TOKEN = "github_token"
GEMINI_API_KEY = "gemini_api_key"


def get_secret(name: str) -> str | None:
    try:
        return keyring.get_password(SERVICE, name) or None
    except KeyringError:
        return None


def set_secret(name: str, value: str) -> None:
    keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> bool:
    try:
        keyring.delete_password(SERVICE, name)
        return True
    except PasswordDeleteError:
        return False


def get_github_token() -> str | None:
    return get_secret(GITHUB_TOKEN)


def get_gemini_key() -> str | None:
    return get_secret(GEMINI_API_KEY)
