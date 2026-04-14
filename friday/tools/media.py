"""
Media tools — OBS control, TTS, screen capture, OCR, etc.
"""

import asyncio
import os
import subprocess
from pathlib import Path
import pytesseract
from PIL import Image
import obswebsocket
import obswebsocket.requests as obs_requests
from friday.config import config


def register(mcp):

    @mcp.tool()
    async def capture_screen() -> str:
        """Capture a screenshot and return the file path."""
        try:
            screenshot_path = Path.home() / "Desktop" / "jarvis_screenshot.png"
            # Use macOS screencapture command
            subprocess.run(["screencapture", "-x", str(screenshot_path)], check=True)
            return f"Screenshot saved to: {screenshot_path}"
        except Exception as e:
            return f"Failed to capture screen: {str(e)}"

    @mcp.tool()
    async def ocr_image(image_path: str = None) -> str:
        """Perform OCR on an image file or the last screenshot."""
        try:
            if not image_path:
                image_path = Path.home() / "Desktop" / "jarvis_screenshot.png"
            
            img = Image.open(image_path)
            text = pytesseract.image_to_string(img)
            return text.strip()
        except Exception as e:
            return f"OCR failed: {str(e)}"

    @mcp.tool()
    async def obs_start_recording() -> str:
        """Start OBS recording."""
        try:
            client = obswebsocket.obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)
            client.connect()
            client.call(obs_requests.StartRecording())
            client.disconnect()
            return "OBS recording started."
        except Exception as e:
            return f"Failed to start OBS recording: {str(e)}"

    @mcp.tool()
    async def obs_stop_recording() -> str:
        """Stop OBS recording."""
        try:
            client = obswebsocket.obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)
            client.connect()
            client.call(obs_requests.StopRecording())
            client.disconnect()
            return "OBS recording stopped."
        except Exception as e:
            return f"Failed to stop OBS recording: {str(e)}"

    @mcp.tool()
    async def obs_start_streaming() -> str:
        """Start OBS streaming."""
        try:
            client = obswebsocket.obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)
            client.connect()
            client.call(obs_requests.StartStreaming())
            client.disconnect()
            return "OBS streaming started."
        except Exception as e:
            return f"Failed to start OBS streaming: {str(e)}"

    @mcp.tool()
    async def obs_stop_streaming() -> str:
        """Stop OBS streaming."""
        try:
            client = obswebsocket.obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)
            client.connect()
            client.call(obs_requests.StopStreaming())
            client.disconnect()
            return "OBS streaming stopped."
        except Exception as e:
            return f"Failed to stop OBS streaming: {str(e)}"

    @mcp.tool()
    async def text_to_speech(text: str, voice: str = "nova") -> str:
        """Convert text to speech using system TTS."""
        try:
            # Use macOS say command
            subprocess.run(["say", "-v", voice, text], check=True)
            return "TTS completed."
        except Exception as e:
            return f"TTS failed: {str(e)}"
