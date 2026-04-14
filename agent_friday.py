"""
FRIDAY – Voice Agent (MCP-powered)
===================================
Friday-style voice agent entrypoint for the current desktop assistant project.

Run:
  python agent_friday.py dev      – LiveKit Cloud mode
  python agent_friday.py console  – text-only console mode
"""

import os
import logging

from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.llm import mcp
from livekit.plugins import google as lk_google, openai as lk_openai, sarvam, silero

STT_PROVIDER = "sarvam"
LLM_PROVIDER = "gemini"
TTS_PROVIDER = "openai"

GEMINI_LLM_MODEL = "gemini-2.5-flash"
OPENAI_LLM_MODEL = "gpt-4o"

OPENAI_TTS_MODEL = "tts-1"
OPENAI_TTS_VOICE = "nova"
TTS_SPEED = 1.15

SARVAM_TTS_LANGUAGE = "en-IN"
SARVAM_TTS_SPEAKER = "rahul"

MCP_SERVER_PORT = 8000

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

load_dotenv()

logger = logging.getLogger("friday-agent")
logger.setLevel(logging.INFO)


def _mcp_server_url() -> str:
    return f"http://127.0.0.1:{MCP_SERVER_PORT}/sse"


def _build_stt():
    if STT_PROVIDER == "sarvam":
        logger.info("STT → Sarvam Saaras v3")
        return sarvam.STT(
            language="unknown",
            model="saaras:v3",
            mode="transcribe",
            flush_signal=True,
            sample_rate=16000,
        )
    if STT_PROVIDER == "whisper":
        logger.info("STT → OpenAI Whisper")
        return lk_openai.STT(model="whisper-1")
    raise ValueError(f"Unknown STT_PROVIDER: {STT_PROVIDER!r}")


def _build_llm():
    if LLM_PROVIDER == "openai":
        logger.info("LLM → OpenAI (%s)", OPENAI_LLM_MODEL)
        return lk_openai.LLM(model=OPENAI_LLM_MODEL)
    if LLM_PROVIDER == "gemini":
        logger.info("LLM → Google Gemini (%s)", GEMINI_LLM_MODEL)
        return lk_google.LLM(model=GEMINI_LLM_MODEL, api_key=os.getenv("GOOGLE_API_KEY"))
    raise ValueError(f"Unknown LLM_PROVIDER: {LLM_PROVIDER!r}")


def _build_tts():
    if TTS_PROVIDER == "sarvam":
        logger.info("TTS → Sarvam Bulbul v3")
        return sarvam.TTS(
            target_language_code=SARVAM_TTS_LANGUAGE,
            model="bulbul:v3",
            speaker=SARVAM_TTS_SPEAKER,
            pace=TTS_SPEED,
        )
    if TTS_PROVIDER == "openai":
        logger.info("TTS → OpenAI TTS (%s / %s)", OPENAI_TTS_MODEL, OPENAI_TTS_VOICE)
        return lk_openai.TTS(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, speed=TTS_SPEED)
    raise ValueError(f"Unknown TTS_PROVIDER: {TTS_PROVIDER!r}")


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
    return {"sarvam": 0.07, "whisper": 0.3}.get(STT_PROVIDER, 0.1)


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
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


def dev():
    import sys

    if len(sys.argv) == 1:
        sys.argv.append("dev")
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
