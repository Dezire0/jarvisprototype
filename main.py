"""
Convenience launcher for the Friday/Jarvis prototype.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path
import sys

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the Friday/Jarvis prototype entrypoints from a single command.",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("server", help="Start the Friday MCP server.")

    voice_parser = subparsers.add_parser("voice", help="Start the Friday voice agent.")
    voice_parser.add_argument(
        "mode",
        nargs="?",
        default="dev",
        help="LiveKit mode to pass through to agent_friday.py (default: dev).",
    )

    subparsers.add_parser("info", help="Show a quick summary of the available entrypoints.")
    subparsers.add_parser("doctor", help="Run end-to-end smoke checks and environment diagnostics.")

    token_parser = subparsers.add_parser("token", help="Generate a local LiveKit participant token.")
    token_parser.add_argument("--room", default="friday-dev", help="Room name to join (default: friday-dev).")
    token_parser.add_argument("--identity", default="jyh-local", help="Participant identity (default: jyh-local).")
    token_parser.add_argument("--name", default="JYH", help="Participant display name (default: JYH).")
    token_parser.add_argument(
        "--ttl-minutes",
        type=int,
        default=60,
        help="Token validity in minutes (default: 60).",
    )
    return parser


def resolve_python_executable() -> str:
    root = Path(__file__).resolve().parent
    venv_python = root / ".venv" / "bin" / "python"
    return str(venv_python if venv_python.exists() else Path(sys.executable))


def load_project_env() -> None:
    from dotenv import load_dotenv

    root = Path(__file__).resolve().parent
    load_dotenv(root / ".env")
    load_dotenv(root / ".env.local", override=True)


def generate_livekit_token(room: str, identity: str, name: str, ttl_minutes: int) -> str:
    from livekit import api

    load_project_env()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()

    if not api_key or not api_secret:
        raise SystemExit("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set before generating a token.")

    token = (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_ttl(dt.timedelta(minutes=ttl_minutes))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )
    return token


def main(argv: list[str] | None = None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "server":
        from server import main as server_main

        return server_main()

    if args.command == "voice":
        from agent_friday import cli, entrypoint, WorkerOptions

        sys.argv = [sys.argv[0], args.mode]
        return cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))

    if args.command == "doctor":
        import subprocess

        root = Path(__file__).resolve().parent
        return subprocess.call([resolve_python_executable(), str(root / "scripts" / "e2e_smoke.py")], cwd=root)

    if args.command == "token":
        token = generate_livekit_token(
            room=args.room,
            identity=args.identity,
            name=args.name,
            ttl_minutes=args.ttl_minutes,
        )
        livekit_url = os.getenv("LIVEKIT_URL", "ws://127.0.0.1:7880").strip() or "ws://127.0.0.1:7880"
        print(f"server_url={livekit_url}")
        print(f"room={args.room}")
        print(f"identity={args.identity}")
        print(f"token={token}")
        return 0

    parser.print_help()
    print(
        "\nAvailable shortcuts:\n"
        "  python main.py server  -> start the MCP server\n"
        "  python main.py voice   -> start the LiveKit voice agent\n"
        "  python main.py token   -> generate a LiveKit participant token\n"
        "  python main.py doctor  -> run the smoke checks\n"
        "  npm run dev            -> start the Electron desktop shell"
    )


if __name__ == "__main__":
    main()
