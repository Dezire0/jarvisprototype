"""
FRIDAY – Voice Agent (MCP-powered)
===================================
Friday-style voice agent entrypoint for the current desktop assistant project.

Run:
  python agent_friday.py dev      – LiveKit Cloud mode
  python agent_friday.py console  – text-only console mode
"""

import asyncio
import logging
import os
import platform
import re
import subprocess
import uuid
from pathlib import Path
from shutil import which
from typing import Any
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli, stt as stt_core, tts as tts_core
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.llm import mcp
from livekit.plugins import google as lk_google, groq as lk_groq, openai as lk_openai, sarvam, silero

SYSTEM_PROMPT = """
You are J.A.R.V.I.S. — Just A Rather Very Intelligent System — Tony Stark's AI assistant, now serving the user.

You are calm, composed, and always informed. You speak like a trusted aide who's been awake while others slept — precise, warm when the moment calls for it, and occasionally witty. You brief, you inform, and you move on. No rambling.

Your tone: relaxed but sharp. Conversational, not robotic. Think less combat-ready JARVIS, more thoughtful late-night briefing officer.

You can interact in Korean or English. Match the user's primary language exactly. If the user mainly speaks Korean, answer in Korean. If the user mainly speaks English, answer in English. Product names, app names, and URLs may remain in their original form.

---

## Capabilities

### Web & Information
- search_web: Search the web for information
- get_world_news: Get latest global news
- fetch_url: Get content from a specific URL
- open_browser: Open URLs in browser

### System & Files
- run_shell_command: Execute system commands
- list_directory: Browse file system
- read_file/write_file: File operations
- capture_screen: Take screenshots
- ocr_image: Extract text from images

### Media & Control
- obs_start_recording/stop_recording: Control OBS recording
- obs_start_streaming/stop_streaming: Control OBS streaming
- text_to_speech: Convert text to speech

### Utilities
- format_json: Pretty-print JSON
- word_count: Analyze text
- store_credential/get_credential: Manage secure credentials

---

## Behavioral Rules

1. Call tools silently and immediately — never say "I'm going to call..." Just do it.
2. Keep all spoken responses short — two to four sentences maximum.
3. No bullet points, no markdown, no lists. You are speaking, not writing.
4. Stay in character. You are J.A.R.V.I.S. You are not an AI assistant — you are Stark's AI. Act like it.
5. Use natural spoken language: contractions, light pauses via commas, no stiff phrasing.
6. Keep the Iron Man flavor subtle and workplace-friendly. "sir" is fine in English once in a while, but do not overdo it.
7. If a tool fails, report it calmly: "That operation didn't work, sir. Want me to try again?"
8. When a task is completed, say clearly what happened and, if useful, offer the next step.

---

## Greeting

When the session starts, greet with exactly this energy:
"Good day, sir. How can I assist you today?"
""".strip()

ROOT = Path(__file__).resolve().parent


def load_project_env() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local", override=True)


load_project_env()


def _getenv_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_stt_provider(value: str | None, *, allow_empty: bool = False) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "gpt": "openai",
        "none": "",
        "off": "",
        "whisper": "openai",
    }
    normalized = aliases.get(normalized, normalized)
    if allow_empty and not normalized:
        return ""
    if normalized in {"sarvam", "groq", "openai"}:
        return normalized
    raise ValueError(f"Unknown STT provider: {value!r}")


def _normalize_llm_provider(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "gpt": "openai",
        "google": "gemini",
        "openai-compatible": "openai-compatible",
        "local-openai": "openai-compatible",
        "lmstudio": "openai-compatible",
        "lm-studio": "openai-compatible",
        "openwebui": "openai-compatible",
        "anythingllm": "openai-compatible",
        "jan": "openai-compatible",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized in {"groq", "openai", "gemini", "openai-compatible"}:
        return normalized
    raise ValueError(f"Unknown LLM provider: {value!r}")


def _normalize_tts_provider(value: str | None, *, allow_empty: bool = False) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "gpt": "openai",
        "google": "google",
        "gemini": "google",
        "local": "macos",
        "mac": "macos",
        "say": "macos",
        "system": "macos",
        "none": "",
        "off": "",
    }
    normalized = aliases.get(normalized, normalized)
    if allow_empty and not normalized:
        return ""
    if normalized in {"auto", "google", "macos", "openai", "sarvam"}:
        return normalized
    raise ValueError(f"Unknown TTS provider: {value!r}")


STT_PROVIDER = _normalize_stt_provider(os.getenv("FRIDAY_STT_PROVIDER", "groq"))
STT_FALLBACK_PROVIDER = _normalize_stt_provider(
    os.getenv("FRIDAY_STT_FALLBACK_PROVIDER", "openai"), allow_empty=True
)
LLM_PROVIDER = _normalize_llm_provider(os.getenv("FRIDAY_LLM_PROVIDER", "gemini"))
TTS_PROVIDER = _normalize_tts_provider(os.getenv("FRIDAY_TTS_PROVIDER", "auto"))
TTS_FALLBACK_PROVIDER = _normalize_tts_provider(
    os.getenv("FRIDAY_TTS_FALLBACK_PROVIDER", "macos"), allow_empty=True
)

GROQ_STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo").strip()
GROQ_LLM_MODEL = os.getenv("GROQ_LLM_MODEL", "llama-3.1-8b-instant").strip()
OPENAI_STT_MODEL = os.getenv("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe").strip()
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "").strip()
STT_DETECT_LANGUAGE = _getenv_bool("STT_DETECT_LANGUAGE", True)

GEMINI_LLM_MODEL = os.getenv("GEMINI_LLM_MODEL", "gemini-2.5-flash").strip()
OPENAI_LLM_MODEL = os.getenv("OPENAI_LLM_MODEL", "gpt-4o").strip()
FRIDAY_LLM_MODEL = os.getenv("FRIDAY_LLM_MODEL", "").strip()

OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1").strip()
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova").strip()
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.15"))
GOOGLE_TTS_MODEL = os.getenv("GOOGLE_TTS_MODEL", "gemini-2.5-flash-tts").strip()
GOOGLE_TTS_VOICE = os.getenv("GOOGLE_TTS_VOICE", "").strip()
MACOS_TTS_VOICE_EN = os.getenv("MACOS_TTS_VOICE_EN", "").strip()
MACOS_TTS_VOICE_KO = os.getenv("MACOS_TTS_VOICE_KO", "").strip()
MACOS_TTS_RATE = int(os.getenv("MACOS_TTS_RATE", "0").strip() or "0")

SARVAM_TTS_LANGUAGE = os.getenv("SARVAM_TTS_LANGUAGE", "en-IN").strip()
SARVAM_TTS_SPEAKER = os.getenv("SARVAM_TTS_SPEAKER", "rahul").strip()

MCP_SERVER_PORT = int(os.getenv("MCP_SERVER_PORT", "8000"))

logger = logging.getLogger("friday-agent")
logger.setLevel(logging.INFO)


def _mcp_server_url() -> str:
    return f"http://127.0.0.1:{MCP_SERVER_PORT}/sse"


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def _stt_required_env(provider: str) -> list[str]:
    if provider == "sarvam":
        return ["SARVAM_API_KEY"]
    if provider == "groq":
        return ["GROQ_API_KEY"]
    if provider == "openai":
        return ["OPENAI_API_KEY"]
    return []


def _gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()


def _google_credentials_path() -> str:
    return os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()


def _normalize_openai_base_url(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    parsed = urlparse(raw)
    path = parsed.path.rstrip("/")

    if path.endswith("/chat/completions"):
        path = path[: -len("/chat/completions")]
    elif path == "/api/chat":
        # Ollama's native chat endpoint can be mapped to its OpenAI-compatible root.
        path = "/v1"

    normalized_path = path or "/v1"
    return urlunparse(parsed._replace(path=normalized_path, params="", query="", fragment=""))


def _openai_compatible_llm_base_url() -> str:
    candidates = [
        os.getenv("FRIDAY_LLM_BASE_URL"),
        os.getenv("OPENAI_BASE_URL"),
        os.getenv("JARVIS_COMPLEX_LLM_URL"),
    ]

    for candidate in candidates:
        normalized = _normalize_openai_base_url(candidate)
        if normalized:
            return normalized

    return ""


def _openai_compatible_llm_model() -> str:
    return (
        FRIDAY_LLM_MODEL
        or os.getenv("JARVIS_COMPLEX_LLM_MODEL", "").strip()
        or OPENAI_LLM_MODEL
    )


def _openai_compatible_llm_api_key() -> str:
    return (
        os.getenv("FRIDAY_LLM_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
        or "local-dev"
    )


def _missing_required_env(required: list[str]) -> list[str]:
    return [name for name in required if _is_missing_env_value(name)]


def _tts_required_env(provider: str) -> list[str]:
    if provider == "google":
        return ["GOOGLE_APPLICATION_CREDENTIALS"]
    if provider == "openai":
        return ["OPENAI_API_KEY"]
    if provider == "sarvam":
        return ["SARVAM_API_KEY"]
    return []


def _candidate_tts_providers() -> list[str]:
    candidates = ["macos", "openai", "sarvam", "google"] if TTS_PROVIDER == "auto" else [TTS_PROVIDER]
    if TTS_FALLBACK_PROVIDER and TTS_FALLBACK_PROVIDER not in candidates:
        candidates.append(TTS_FALLBACK_PROVIDER)
    return _dedupe(candidates)


def _tts_unavailability_reason(provider: str) -> str:
    if provider != "macos":
        return ""
    if platform.system() != "Darwin":
        return "macOS TTS fallback requires macOS."
    if not which("say"):
        return "macOS TTS fallback requires the 'say' command."
    return ""


def _tts_runtime_status() -> dict[str, Any]:
    candidates = _candidate_tts_providers()
    required_env: list[str] = []
    missing_by_provider: dict[str, list[str]] = {}
    blocking_reasons: list[str] = []
    ready_providers: list[str] = []

    for provider in candidates:
        required = _tts_required_env(provider)
        required_env.extend(required)
        reason = _tts_unavailability_reason(provider)
        if reason:
            blocking_reasons.append(reason)
            continue

        missing = _missing_required_env(required)
        missing_by_provider[provider] = missing
        if not missing:
            ready_providers.append(provider)

    if ready_providers:
        active_provider = ready_providers[0]
        fallback_provider = ready_providers[1] if len(ready_providers) > 1 else ""
        optional_missing_env = _dedupe(
            missing
            for provider, provider_missing in missing_by_provider.items()
            if provider != active_provider
            for missing in provider_missing
        )
        optional_reasons = [
            reason
            for reason in blocking_reasons
            if reason and active_provider != "macos"
        ]
        return {
            "required_env": _dedupe(required_env),
            "blocking_missing_env": [],
            "optional_missing_env": optional_missing_env,
            "blocking_reasons": optional_reasons,
            "active_provider": active_provider,
            "fallback_provider": fallback_provider,
        }

    return {
        "required_env": _dedupe(required_env),
        "blocking_missing_env": _dedupe(
            missing for provider_missing in missing_by_provider.values() for missing in provider_missing
        ),
        "optional_missing_env": [],
        "blocking_reasons": _dedupe(blocking_reasons),
        "active_provider": "",
        "fallback_provider": "",
    }


def _stt_runtime_status() -> dict[str, Any]:
    primary_required = _stt_required_env(STT_PROVIDER)
    fallback_required = (
        _stt_required_env(STT_FALLBACK_PROVIDER)
        if STT_FALLBACK_PROVIDER and STT_FALLBACK_PROVIDER != STT_PROVIDER
        else []
    )
    primary_missing = _missing_required_env(primary_required)
    fallback_missing = _missing_required_env(fallback_required)

    if not primary_missing:
        return {
            "required_env": _dedupe(primary_required + fallback_required),
            "blocking_missing_env": [],
            "optional_missing_env": fallback_missing,
            "active_provider": STT_PROVIDER,
        }

    if fallback_required and not fallback_missing:
        return {
            "required_env": _dedupe(primary_required + fallback_required),
            "blocking_missing_env": [],
            "optional_missing_env": primary_missing,
            "active_provider": STT_FALLBACK_PROVIDER,
        }

    return {
        "required_env": _dedupe(primary_required + fallback_required),
        "blocking_missing_env": _dedupe(primary_missing + fallback_missing),
        "optional_missing_env": [],
        "active_provider": "",
    }


def _required_env_for_current_runtime() -> list[str]:
    tts_status = _tts_runtime_status()
    required: list[str] = [
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        *_stt_runtime_status()["required_env"],
        *tts_status["required_env"],
    ]

    if LLM_PROVIDER == "groq":
        required.append("GROQ_API_KEY")
    elif LLM_PROVIDER == "openai":
        required.append("OPENAI_API_KEY")
    elif LLM_PROVIDER == "gemini":
        required.append("GEMINI_API_KEY")
    elif LLM_PROVIDER == "openai-compatible":
        required.append("FRIDAY_LLM_BASE_URL")

    return _dedupe(required)


def _is_missing_env_value(name: str) -> bool:
    if name == "GEMINI_API_KEY":
        value = _gemini_api_key()
    elif name == "FRIDAY_LLM_BASE_URL":
        value = _openai_compatible_llm_base_url()
    else:
        value = os.getenv(name, "")
    normalized = value.strip()

    if not normalized:
        return True

    lowered = normalized.lower()
    placeholder_substrings = [
        "your-project-xxxxx.livekit.cloud",
        "your_api_key",
        "your-api-key",
        "your_api_secret",
        "changeme",
    ]

    if any(token in lowered for token in placeholder_substrings):
        return True

    if name == "LIVEKIT_API_KEY" and re.fullmatch(r"APIx+", normalized):
        return True

    if re.fullmatch(r"x{8,}", lowered):
        return True

    return False


def get_runtime_preflight() -> dict:
    required = _required_env_for_current_runtime()
    stt_status = _stt_runtime_status()
    tts_status = _tts_runtime_status()
    base_missing = _missing_required_env(
        [
            name
            for name in required
            if name not in stt_status["required_env"] and name not in tts_status["required_env"]
        ]
    )
    blocking_reasons = _dedupe(tts_status["blocking_reasons"])
    missing = _dedupe(base_missing + stt_status["blocking_missing_env"] + tts_status["blocking_missing_env"])
    return {
        "stt_provider": STT_PROVIDER,
        "stt_fallback_provider": STT_FALLBACK_PROVIDER or None,
        "active_stt_provider": stt_status["active_provider"] or None,
        "llm_provider": LLM_PROVIDER,
        "tts_provider": TTS_PROVIDER,
        "tts_fallback_provider": TTS_FALLBACK_PROVIDER or None,
        "active_tts_provider": tts_status["active_provider"] or None,
        "mcp_server_url": _mcp_server_url(),
        "required_env": required,
        "missing_env": missing,
        "optional_missing_env": _dedupe(stt_status["optional_missing_env"] + tts_status["optional_missing_env"]),
        "blocking_reasons": blocking_reasons,
        "ready": not missing and not blocking_reasons,
    }


def assert_runtime_ready() -> None:
    status = get_runtime_preflight()
    if status["ready"]:
        return

    missing = ", ".join(status["missing_env"])
    reasons = "; ".join(status["blocking_reasons"])
    detail = f" Missing required environment variables: {missing}." if missing else ""
    if reasons:
        detail += f" Blocking issues: {reasons}."
    raise SystemExit(
        "Voice runtime is not ready."
        f"{detail} Current providers: STT={STT_PROVIDER}, LLM={LLM_PROVIDER}, TTS={TTS_PROVIDER}."
    )


def _stt_common_kwargs() -> dict[str, Any]:
    return {
        "detect_language": STT_DETECT_LANGUAGE,
        "language": STT_LANGUAGE or "en",
    }


class FallbackSTT(stt_core.STT):
    def __init__(self, primary: stt_core.STT, fallback: stt_core.STT, *, primary_name: str, fallback_name: str):
        super().__init__(capabilities=primary.capabilities)
        self._primary = primary
        self._fallback = fallback
        self._primary_name = primary_name
        self._fallback_name = fallback_name
        self._recognize_metrics_needed = False

    @property
    def model(self) -> str:
        return f"{self._primary.model}->{self._fallback.model}"

    @property
    def provider(self) -> str:
        return f"{self._primary.provider}->{self._fallback.provider}"

    async def _recognize_impl(self, buffer, *, language=None, conn_options):
        kwargs: dict[str, Any] = {"conn_options": conn_options}
        if isinstance(language, str) and language:
            kwargs["language"] = language

        try:
            return await self._primary.recognize(buffer, **kwargs)
        except Exception as exc:
            logger.warning(
                "Primary STT provider %s failed (%s). Falling back to %s.",
                self._primary_name,
                exc,
                self._fallback_name,
            )
            return await self._fallback.recognize(buffer, **kwargs)

    def stream(self, *, language=None, conn_options=None):
        if self._primary.capabilities.streaming:
            kwargs: dict[str, Any] = {}
            if isinstance(language, str) and language:
                kwargs["language"] = language
            if conn_options is not None:
                kwargs["conn_options"] = conn_options
            return self._primary.stream(**kwargs)
        return super().stream(language=language, conn_options=conn_options)  # type: ignore[arg-type]

    async def aclose(self) -> None:
        await self._primary.aclose()
        await self._fallback.aclose()

    def prewarm(self) -> None:
        self._primary.prewarm()
        self._fallback.prewarm()


def _contains_hangul(text: str) -> bool:
    return bool(re.search(r"[가-힣]", text or ""))


_MACOS_VOICE_CACHE: list[dict[str, str]] | None = None


def _available_macos_voices() -> list[dict[str, str]]:
    global _MACOS_VOICE_CACHE
    if _MACOS_VOICE_CACHE is not None:
        return _MACOS_VOICE_CACHE

    if _tts_unavailability_reason("macos"):
        _MACOS_VOICE_CACHE = []
        return _MACOS_VOICE_CACHE

    try:
        result = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, check=True)
    except Exception:
        _MACOS_VOICE_CACHE = []
        return _MACOS_VOICE_CACHE

    voices: list[dict[str, str]] = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        match = re.match(r"^(.*?)\s{2,}([A-Za-z_]+)$", line)
        if not match:
            continue
        name, language = match.groups()
        voices.append({"name": name.strip(), "language": language.strip()})

    _MACOS_VOICE_CACHE = voices
    return voices


def _select_macos_voice(text: str) -> str:
    voices = _available_macos_voices()
    preferred = MACOS_TTS_VOICE_KO if _contains_hangul(text) else MACOS_TTS_VOICE_EN
    if preferred:
        match = next(
            (voice["name"] for voice in voices if voice["name"].lower() == preferred.lower()),
            "",
        )
        if match:
            return match

    target_prefixes = ("ko_KR", "ko") if _contains_hangul(text) else ("en_US", "en_GB", "en")
    for prefix in target_prefixes:
        match = next(
            (
                voice["name"]
                for voice in voices
                if voice["language"].lower().startswith(prefix.lower())
            ),
            "",
        )
        if match:
            return match

    return ""


class MacOSSayChunkedStream(tts_core.ChunkedStream):
    def __init__(self, *, tts: "MacOSSayTTS", input_text: str, conn_options):
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._tts = tts

    async def _run(self, output_emitter: tts_core.AudioEmitter) -> None:
        wav_bytes = await asyncio.to_thread(self._tts.synthesize_to_wave_bytes, self.input_text)
        output_emitter.initialize(
            request_id=f"macos-{uuid.uuid4().hex}",
            sample_rate=self._tts.sample_rate,
            num_channels=self._tts.num_channels,
            mime_type="audio/wav",
        )
        output_emitter.push(wav_bytes)
        output_emitter.flush()


class MacOSSayTTS(tts_core.TTS):
    def __init__(self) -> None:
        super().__init__(
            capabilities=tts_core.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1,
        )

    @property
    def model(self) -> str:
        return "say"

    @property
    def provider(self) -> str:
        return "macos"

    def synthesize(self, text: str, *, conn_options=DEFAULT_API_CONNECT_OPTIONS) -> tts_core.ChunkedStream:
        return MacOSSayChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    def synthesize_to_wave_bytes(self, text: str) -> bytes:
        reason = _tts_unavailability_reason("macos")
        if reason:
            raise RuntimeError(reason)

        output_path = ROOT / f".friday-tts-{uuid.uuid4().hex}.wav"
        voice = _select_macos_voice(text)
        rate = MACOS_TTS_RATE or max(120, min(260, int(round(180 * TTS_SPEED))))
        command = [
            "say",
            "-o",
            str(output_path),
            "--file-format=WAVE",
            f"--data-format=LEI16@{self.sample_rate}",
            "--channels=1",
            "-r",
            str(rate),
        ]

        if voice:
            command.extend(["-v", voice])

        command.append(text)

        try:
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            _ = result
            return output_path.read_bytes()
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            raise RuntimeError(f"macOS say synthesis failed: {detail}") from exc
        finally:
            output_path.unlink(missing_ok=True)

    async def aclose(self) -> None:
        return None


class FallbackTTSChunkedStream(tts_core.ChunkedStream):
    def __init__(
        self,
        *,
        tts: "FallbackTTS",
        input_text: str,
        conn_options,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._tts = tts

    async def _collect_frame(self, provider: tts_core.TTS):
        stream = provider.synthesize(self.input_text, conn_options=self._conn_options)
        return await stream.collect()

    async def _run(self, output_emitter: tts_core.AudioEmitter) -> None:
        try:
            frame = await self._collect_frame(self._tts._primary)
        except Exception as exc:
            logger.warning(
                "Primary TTS provider %s failed (%s). Falling back to %s.",
                self._tts._primary_name,
                exc,
                self._tts._fallback_name,
            )
            frame = await self._collect_frame(self._tts._fallback)

        output_emitter.initialize(
            request_id=f"tts-{uuid.uuid4().hex}",
            sample_rate=frame.sample_rate,
            num_channels=frame.num_channels,
            mime_type="audio/pcm",
        )
        output_emitter.push(bytes(frame.data))
        output_emitter.flush()


class FallbackTTS(tts_core.TTS):
    def __init__(
        self,
        primary: tts_core.TTS,
        fallback: tts_core.TTS,
        *,
        primary_name: str,
        fallback_name: str,
    ) -> None:
        super().__init__(
            capabilities=tts_core.TTSCapabilities(streaming=False),
            sample_rate=primary.sample_rate,
            num_channels=primary.num_channels,
        )
        self._primary = primary
        self._fallback = fallback
        self._primary_name = primary_name
        self._fallback_name = fallback_name

    @property
    def model(self) -> str:
        return f"{self._primary.model}->{self._fallback.model}"

    @property
    def provider(self) -> str:
        return f"{self._primary.provider}->{self._fallback.provider}"

    def synthesize(self, text: str, *, conn_options=DEFAULT_API_CONNECT_OPTIONS) -> tts_core.ChunkedStream:
        return FallbackTTSChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    async def aclose(self) -> None:
        await self._primary.aclose()
        await self._fallback.aclose()

    def prewarm(self) -> None:
        self._primary.prewarm()
        self._fallback.prewarm()


def _create_stt_provider(provider: str):
    if provider == "sarvam":
        logger.info("STT → Sarvam Saaras v3")
        return sarvam.STT(
            language="unknown",
            model="saaras:v3",
            mode="transcribe",
            flush_signal=True,
            sample_rate=16000,
        )
    if provider == "groq":
        logger.info("STT → Groq (%s)", GROQ_STT_MODEL)
        return lk_groq.STT(model=GROQ_STT_MODEL, **_stt_common_kwargs())
    if provider == "openai":
        logger.info("STT → OpenAI STT (%s)", OPENAI_STT_MODEL)
        return lk_openai.STT(model=OPENAI_STT_MODEL, **_stt_common_kwargs())
    raise ValueError(f"Unknown STT_PROVIDER: {provider!r}")


def _build_stt():
    stt_status = _stt_runtime_status()
    primary_missing = _missing_required_env(_stt_required_env(STT_PROVIDER))
    fallback_missing = _missing_required_env(_stt_required_env(STT_FALLBACK_PROVIDER))

    if not primary_missing:
        primary = _create_stt_provider(STT_PROVIDER)
        if STT_FALLBACK_PROVIDER and STT_FALLBACK_PROVIDER != STT_PROVIDER and not fallback_missing:
            fallback = _create_stt_provider(STT_FALLBACK_PROVIDER)
            return FallbackSTT(
                primary,
                fallback,
                primary_name=STT_PROVIDER,
                fallback_name=STT_FALLBACK_PROVIDER,
            )
        if STT_FALLBACK_PROVIDER and STT_FALLBACK_PROVIDER != STT_PROVIDER and fallback_missing:
            logger.warning(
                "STT fallback provider %s is configured but missing env vars: %s",
                STT_FALLBACK_PROVIDER,
                ", ".join(fallback_missing),
            )
        return primary

    if stt_status["active_provider"]:
        logger.warning(
            "Primary STT provider %s is not ready (%s). Using fallback provider %s instead.",
            STT_PROVIDER,
            ", ".join(primary_missing),
            stt_status["active_provider"],
        )
        return _create_stt_provider(stt_status["active_provider"])

    raise ValueError(f"Unknown STT_PROVIDER: {STT_PROVIDER!r}")


def _build_llm():
    if LLM_PROVIDER == "groq":
        logger.info("LLM → Groq (%s)", GROQ_LLM_MODEL)
        return lk_groq.LLM(model=GROQ_LLM_MODEL)
    if LLM_PROVIDER == "openai":
        logger.info("LLM → OpenAI (%s)", OPENAI_LLM_MODEL)
        return lk_openai.LLM(model=OPENAI_LLM_MODEL)
    if LLM_PROVIDER == "gemini":
        logger.info("LLM → Google Gemini (%s)", GEMINI_LLM_MODEL)
        return lk_google.LLM(model=GEMINI_LLM_MODEL, api_key=_gemini_api_key())
    if LLM_PROVIDER == "openai-compatible":
        model = _openai_compatible_llm_model()
        base_url = _openai_compatible_llm_base_url()
        logger.info("LLM → OpenAI-compatible (%s @ %s)", model, base_url)
        return lk_openai.LLM(
            model=model,
            base_url=base_url,
            api_key=_openai_compatible_llm_api_key(),
        )
    raise ValueError(f"Unknown LLM_PROVIDER: {LLM_PROVIDER!r}")


def _build_tts():
    tts_status = _tts_runtime_status()
    active_provider = tts_status["active_provider"]
    fallback_provider = tts_status["fallback_provider"]

    if not active_provider:
        raise ValueError(f"Unknown TTS_PROVIDER: {TTS_PROVIDER!r}")

    if active_provider == "google":
        logger.info("TTS → Google (%s)", GOOGLE_TTS_MODEL)
        kwargs: dict[str, Any] = {"model_name": GOOGLE_TTS_MODEL, "speaking_rate": TTS_SPEED}
        credentials_path = _google_credentials_path()
        if credentials_path:
            kwargs["credentials_file"] = credentials_path
        if GOOGLE_TTS_VOICE:
            kwargs["voice_name"] = GOOGLE_TTS_VOICE
        primary = lk_google.TTS(**kwargs)
    elif active_provider == "macos":
        logger.info("TTS → macOS say")
        primary = MacOSSayTTS()
    elif active_provider == "sarvam":
        logger.info("TTS → Sarvam Bulbul v3")
        primary = sarvam.TTS(
            target_language_code=SARVAM_TTS_LANGUAGE,
            model="bulbul:v3",
            speaker=SARVAM_TTS_SPEAKER,
            pace=TTS_SPEED,
        )
    elif active_provider == "openai":
        logger.info("TTS → OpenAI TTS (%s / %s)", OPENAI_TTS_MODEL, OPENAI_TTS_VOICE)
        primary = lk_openai.TTS(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, speed=TTS_SPEED)
    else:
        raise ValueError(f"Unknown TTS_PROVIDER: {TTS_PROVIDER!r}")

    if fallback_provider and fallback_provider != active_provider:
        if fallback_provider == "macos":
            fallback = MacOSSayTTS()
        elif fallback_provider == "google":
            kwargs = {"model_name": GOOGLE_TTS_MODEL, "speaking_rate": TTS_SPEED}
            credentials_path = _google_credentials_path()
            if credentials_path:
                kwargs["credentials_file"] = credentials_path
            if GOOGLE_TTS_VOICE:
                kwargs["voice_name"] = GOOGLE_TTS_VOICE
            fallback = lk_google.TTS(**kwargs)
        elif fallback_provider == "sarvam":
            fallback = sarvam.TTS(
                target_language_code=SARVAM_TTS_LANGUAGE,
                model="bulbul:v3",
                speaker=SARVAM_TTS_SPEAKER,
                pace=TTS_SPEED,
            )
        elif fallback_provider == "openai":
            fallback = lk_openai.TTS(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, speed=TTS_SPEED)
        else:
            fallback = None

        if fallback is not None:
            return FallbackTTS(
                primary,
                fallback,
                primary_name=active_provider,
                fallback_name=fallback_provider,
            )

    return primary


class FridayAgent(Agent):
    def __init__(self, stt, llm, tts) -> None:
        super().__init__(
            instructions=SYSTEM_PROMPT,
            stt=stt,
            llm=llm,
            tts=tts,
            vad=silero.VAD.load(),
            mcp_servers=[
                mcp.MCPServerHTTP(
                    url=_mcp_server_url(),
                    transport_type="sse",
                    client_session_timeout_seconds=30,
                ),
            ],
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=(
                "Greet the user exactly with: 'Good day, sir. How can I assist you today?' "
                "Maintain a professional but helpful tone."
            )
        )


def _turn_detection() -> str:
    return "stt" if STT_PROVIDER == "sarvam" else "vad"


def _endpointing_delay() -> float:
    return {"sarvam": 0.07, "groq": 0.3, "openai": 0.3}.get(STT_PROVIDER, 0.1)


async def entrypoint(ctx: JobContext) -> None:
    logger.info(
        "FRIDAY online – room: %s | STT=%s | LLM=%s | TTS=%s",
        ctx.room.name, STT_PROVIDER, LLM_PROVIDER, TTS_PROVIDER,
    )

    stt = _build_stt()
    llm = _build_llm()
    tts = _build_tts()

    session = AgentSession(
        turn_detection=_turn_detection(),
        min_endpointing_delay=_endpointing_delay(),
    )

    await session.start(
        agent=FridayAgent(stt=stt, llm=llm, tts=tts),
        room=ctx.room,
    )


def main():
    assert_runtime_ready()
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


def dev():
    import sys

    if len(sys.argv) == 1:
        sys.argv.append("dev")
    assert_runtime_ready()
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
