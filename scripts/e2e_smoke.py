from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import anyio
import httpx
from mcp import ClientSession
from mcp.client.sse import sse_client

ROOT = Path(__file__).resolve().parents[1]
PYTHON_BIN = ROOT / ".venv" / "bin" / "python"


def _python_executable() -> str:
    return str(PYTHON_BIN if PYTHON_BIN.exists() else Path(sys.executable))


def _normalize_provider(value: str | None, fallback: str = "auto") -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "auto": "auto",
        "google": "gemini",
        "gemini": "gemini",
        "ollama": "ollama",
        "openai": "openai-compatible",
        "openai-compatible": "openai-compatible",
        "local-openai": "openai-compatible",
        "lmstudio": "openai-compatible",
        "lm-studio": "openai-compatible",
        "jan": "openai-compatible",
        "anythingllm": "openai-compatible",
        "openwebui": "openai-compatible",
    }
    return aliases.get(normalized, fallback)


def _normalize_openai_compatible_url(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    clean = raw.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/chat/completions"
    if "://" in clean:
        return f"{clean}/chat/completions"
    return clean


def _looks_like_ollama_url(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return normalized.endswith("/api/chat") or "127.0.0.1:11434" in normalized


def _resolve_desktop_llm_provider() -> str:
    requested = _normalize_provider(os.getenv("JARVIS_COMPLEX_LLM_PROVIDER"), "auto")
    if requested != "auto":
        return requested
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return "gemini"
    explicit_url = (os.getenv("JARVIS_COMPLEX_LLM_URL") or os.getenv("OPENAI_BASE_URL") or "").strip()
    if (
        os.getenv("OPENAI_API_KEY")
        or os.getenv("JARVIS_COMPLEX_LLM_API_KEY")
        or (explicit_url and not _looks_like_ollama_url(explicit_url))
    ):
        return "openai-compatible"
    return "ollama"


def check_ollama() -> dict:
    response = httpx.get("http://127.0.0.1:11434/api/tags", timeout=5.0)
    response.raise_for_status()
    payload = response.json()
    models = [item.get("name", "") for item in payload.get("models", [])]

    chat_reply = ""
    if models:
        chat_response = httpx.post(
            "http://127.0.0.1:11434/api/chat",
            timeout=30.0,
            json={
                "model": models[0],
                "stream": False,
                "messages": [{"role": "user", "content": "Reply with exactly READY."}],
            },
        )
        chat_response.raise_for_status()
        chat_payload = chat_response.json()
        chat_reply = (
            chat_payload.get("message", {}).get("content", "")
            if isinstance(chat_payload, dict)
            else ""
        ).strip()

    return {
        "status": "pass",
        "provider": "ollama",
        "model_count": len(models),
        "models": models[:5],
        "chat_reply": chat_reply,
    }


def check_desktop_llm() -> dict:
    provider = _resolve_desktop_llm_provider()

    if provider == "gemini":
        return {
            "status": "pass" if (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")) else "warn",
            "provider": "gemini",
            "model": os.getenv("JARVIS_COMPLEX_LLM_MODEL") or os.getenv("GEMINI_LLM_MODEL") or "gemini-2.5-flash",
            "message": "Gemini is configured as the desktop complex LLM."
        }

    if provider == "openai-compatible":
        return {
            "status": "pass" if (os.getenv("OPENAI_API_KEY") or os.getenv("JARVIS_COMPLEX_LLM_API_KEY")) else "warn",
            "provider": "openai-compatible",
            "model": os.getenv("JARVIS_COMPLEX_LLM_MODEL") or os.getenv("OPENAI_LLM_MODEL") or "gpt-4o-mini",
            "url": _normalize_openai_compatible_url(
                (os.getenv("OPENAI_BASE_URL") if _looks_like_ollama_url(os.getenv("JARVIS_COMPLEX_LLM_URL")) else os.getenv("JARVIS_COMPLEX_LLM_URL"))
                or os.getenv("OPENAI_BASE_URL")
            )
            or "https://api.openai.com/v1/chat/completions",
            "message": "An OpenAI-compatible backend is configured as the desktop complex LLM."
        }

    return check_ollama()


def wait_for_http(url: str, timeout_seconds: float = 15.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None

    while time.time() < deadline:
        try:
            response = httpx.head(url, timeout=2.0)
            if response.status_code < 500:
                return
        except Exception as exc:  # pragma: no cover - exercised in real runs
            last_error = exc
        time.sleep(0.25)

    raise RuntimeError(f"Timed out waiting for {url}. Last error: {last_error}")


async def verify_mcp() -> dict:
    async with sse_client("http://127.0.0.1:8000/sse") as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("get_current_time", {})
            return {
                "status": "pass",
                "tool_count": len(tools.tools),
                "sample_tools": sorted(tool.name for tool in tools.tools)[:8],
                "get_current_time": result.content[0].text if result.content else "",
            }


def run_mcp_server_check() -> dict:
    process = subprocess.Popen(
        [_python_executable(), "server.py"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        wait_for_http("http://127.0.0.1:8000/sse")
        result = anyio.run(verify_mcp)
        return result
    finally:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def run_browser_login_check() -> dict:
    completed = subprocess.run(
        ["node", str(ROOT / "scripts" / "browser-login-e2e.cjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "JARVIS_HEADLESS": "1"},
    )
    payload = json.loads(completed.stdout)
    payload["status"] = "pass" if payload.get("loginSucceeded") else "fail"
    return payload


def check_obs_socket() -> dict:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.0)
        try:
            sock.connect(("127.0.0.1", 4455))
        except OSError:
            return {
                "status": "warn",
                "message": "OBS WebSocket is not reachable on ws://127.0.0.1:4455.",
            }

    return {
        "status": "pass",
        "message": "OBS WebSocket is accepting TCP connections on ws://127.0.0.1:4455.",
    }


def check_voice_runtime() -> dict:
    from agent_friday import get_runtime_preflight

    status = get_runtime_preflight()
    status["status"] = "pass" if status["ready"] else "warn"
    return status


def main() -> int:
    results: dict[str, dict] = {}

    checks = [
        ("desktop_llm", check_desktop_llm),
        ("mcp_server", run_mcp_server_check),
        ("browser_login", run_browser_login_check),
        ("obs", check_obs_socket),
        ("voice_runtime", check_voice_runtime),
    ]

    overall = 0

    for name, fn in checks:
        try:
            results[name] = fn()
        except Exception as exc:  # pragma: no cover - exercised in real runs
            results[name] = {
                "status": "fail",
                "message": str(exc),
            }
            overall = 1

    print(json.dumps(results, indent=2, ensure_ascii=False))
    return overall


if __name__ == "__main__":
    raise SystemExit(main())
