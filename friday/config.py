"""
Configuration — load environment variables and app-wide settings.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Server identity
    SERVER_NAME: str = os.getenv("SERVER_NAME", "Friday")
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # External API keys (add as needed)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    SEARCH_API_KEY: str = os.getenv("SEARCH_API_KEY", "")

    # OBS WebSocket settings
    OBS_HOST: str = os.getenv("OBS_HOST", "localhost")
    OBS_PORT: int = int(os.getenv("OBS_PORT", "4455"))
    OBS_PASSWORD: str = os.getenv("OBS_PASSWORD", "")


config = Config()
