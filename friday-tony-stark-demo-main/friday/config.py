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
    SEARCH_API_KEY: str = os.getenv("SEARCH_API_KEY", "")


config = Config()
