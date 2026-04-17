"""
Shared credential storage for both the Python Friday stack and the Electron desktop shell.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import keyring

VAULT_DIR = Path.home() / ".friday-jarvis"
VAULT_INDEX_PATH = VAULT_DIR / "credentials.json"
KEYRING_SERVICE = "friday-jarvis-prototype"
LEGACY_KEYRING_SERVICE = "jarvis"


def normalize_site_key(site_or_url: str = "") -> str:
    value = str(site_or_url).strip()
    if not value:
        raise ValueError("A site key or URL is required.")

    try:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        return (parsed.hostname or "").replace("www.", "") or value
    except Exception:
        return value.replace("http://", "").replace("https://", "").replace("www.", "").split("/")[0]


def _ensure_vault_dir() -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)


def _read_index() -> dict:
    try:
        return json.loads(VAULT_INDEX_PATH.read_text())
    except FileNotFoundError:
        return {"version": 1, "entries": {}}


def _write_index(index: dict) -> None:
    _ensure_vault_dir()
    VAULT_INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")


def _password_account(site_key: str) -> str:
    return f"{site_key}:password"


def _legacy_username_account(site_key: str) -> str:
    return f"{site_key}_username"


def _legacy_password_account(site_key: str) -> str:
    return f"{site_key}_password"


def _run_security(args: list[str]) -> str:
    completed = subprocess.run(
        ["security", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


def _get_password_from_security(service: str, account: str) -> str | None:
    if sys.platform != "darwin":
        return None

    try:
        return _run_security(["find-generic-password", "-s", service, "-a", account, "-w"]) or None
    except Exception:
        return None


def _set_password_in_security(service: str, account: str, password: str) -> bool:
    if sys.platform != "darwin":
        return False

    try:
        _run_security(["add-generic-password", "-U", "-s", service, "-a", account, "-w", password])
        return True
    except Exception:
        return False


def _delete_password_from_security(service: str, account: str) -> bool:
    if sys.platform != "darwin":
        return False

    try:
        _run_security(["delete-generic-password", "-s", service, "-a", account])
        return True
    except Exception:
        return False


def _get_password_from_secure_store(service: str, account: str) -> str | None:
    password = _get_password_from_security(service, account)
    if password:
        return password

    try:
        return keyring.get_password(service, account)
    except Exception:
        return None


def _set_password_in_secure_store(service: str, account: str, password: str) -> None:
    if _set_password_in_security(service, account, password):
        return

    keyring.set_password(service, account, password)


def _delete_password_from_secure_store(service: str, account: str) -> None:
    _delete_password_from_security(service, account)

    try:
        keyring.delete_password(service, account)
    except Exception:
        pass


def _get_password_from_keyring(site_key: str) -> str | None:
    password = _get_password_from_secure_store(KEYRING_SERVICE, _password_account(site_key))
    if password:
        return password
    return _get_password_from_secure_store(LEGACY_KEYRING_SERVICE, _legacy_password_account(site_key))


def _get_legacy_username(site_key: str) -> str:
    try:
        return keyring.get_password(LEGACY_KEYRING_SERVICE, _legacy_username_account(site_key)) or ""
    except Exception:
        return ""


def save_credential(site: str, username: str, password: str, login_url: str = "") -> dict:
    site_key = normalize_site_key(site or login_url)
    _set_password_in_secure_store(KEYRING_SERVICE, _password_account(site_key), password)

    index = _read_index()
    index["entries"][site_key] = {
        "site": site_key,
        "login_url": login_url or "",
        "username": username,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    _write_index(index)

    return {
        "site": site_key,
        "login_url": login_url or "",
        "username": username,
    }


def get_credential(site_or_url: str) -> dict | None:
    site_key = normalize_site_key(site_or_url)
    index = _read_index()
    entry = index.get("entries", {}).get(site_key, {})
    password = _get_password_from_keyring(site_key)

    if not entry and not password:
        return None

    username = entry.get("username") or _get_legacy_username(site_key)

    if not username or not password:
        return None

    return {
        "site": site_key,
        "login_url": entry.get("login_url", ""),
        "username": username,
        "password": password,
    }


def list_credentials() -> list[dict]:
    index = _read_index()
    entries = list(index.get("entries", {}).values())
    entries.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    return entries


def delete_credential(site_or_url: str) -> dict:
    site_key = normalize_site_key(site_or_url)
    index = _read_index()
    existed = bool(index.get("entries", {}).get(site_key))

    if existed:
        del index["entries"][site_key]
        _write_index(index)

    for service, account in [
        (KEYRING_SERVICE, _password_account(site_key)),
        (LEGACY_KEYRING_SERVICE, _legacy_username_account(site_key)),
        (LEGACY_KEYRING_SERVICE, _legacy_password_account(site_key)),
    ]:
        _delete_password_from_secure_store(service, account)

    return {
        "deleted": existed,
        "site": site_key,
    }
