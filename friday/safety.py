"""
Guardrails for sensitive automation actions.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

VAULT_DIR = Path.home() / ".friday-jarvis"
AUDIT_LOG_PATH = VAULT_DIR / "audit.log"

SENSITIVE_TOOLS_ENV = "FRIDAY_ENABLE_SENSITIVE_TOOLS"

BLOCKED_COMMAND_PATTERNS = [
    "rm -rf /",
    "sudo rm -rf /",
    "shutdown",
    "reboot",
    "mkfs",
    "diskutil eraseDisk",
]


def _ensure_audit_dir() -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)


def log_sensitive_action(tool: str, target: str = "", status: str = "requested", extra: dict | None = None) -> None:
    _ensure_audit_dir()
    record = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "tool": tool,
        "target": target,
        "status": status,
        "extra": extra or {},
    }
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")


def sensitive_tools_enabled() -> bool:
    return str(os.getenv(SENSITIVE_TOOLS_ENV, "")).strip().lower() in {"1", "true", "yes", "on"}


def guard_sensitive_action(tool: str, target: str = "", confirmed: bool = False) -> str | None:
    if not confirmed:
        log_sensitive_action(tool, target=target, status="blocked-confirmation")
        return (
            f"{tool} requires explicit confirmation. "
            "Call it again with confirmed=True only after the user clearly confirms."
        )

    if not sensitive_tools_enabled():
        log_sensitive_action(tool, target=target, status="blocked-disabled")
        return (
            f"{tool} is disabled by default. "
            f"Set {SENSITIVE_TOOLS_ENV}=1 to enable sensitive automation, then call again with confirmed=True."
        )

    log_sensitive_action(tool, target=target, status="confirmed")
    return None


def block_dangerous_command(command: str) -> str | None:
    lowered = str(command).strip().lower()
    for pattern in BLOCKED_COMMAND_PATTERNS:
        if pattern in lowered:
            return f"The command was blocked because it matched a dangerous pattern: {pattern}"
    return None
