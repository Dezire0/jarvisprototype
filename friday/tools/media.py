"""
Media tools — OBS control, TTS, screen capture, OCR, etc.
"""

import platform
import subprocess
from shutil import which
from pathlib import Path
from friday.config import config


def _load_ocr_dependencies():
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "OCR dependencies are unavailable. Install pillow and pytesseract to enable ocr_image."
        ) from exc

    return pytesseract, Image


def _load_obs_dependencies():
    try:
        from obswebsocket import obsws, requests as obs_requests
    except ImportError as exc:
        raise RuntimeError(
            "OBS control dependencies are unavailable. Install obs-websocket-py to enable OBS tools."
        ) from exc

    return obsws, obs_requests


def _call_obs(request_builder) -> None:
    obsws, obs_requests = _load_obs_dependencies()
    client = obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)

    try:
        client.connect()
        client.call(request_builder(obs_requests))
    finally:
        try:
            client.disconnect()
        except Exception:
            pass


def _build_say_command(text: str, voice: str = "") -> list[str]:
    command = ["say"]
    selected_voice = str(voice).strip()

    if selected_voice:
        command.extend(["-v", selected_voice])

    command.append(text)
    return command


def _capture_screen_to_file(screenshot_path: Path) -> None:
    current_os = platform.system()

    if current_os == "Darwin":
        if not which("screencapture"):
            raise RuntimeError("system 'screencapture' command is not available on this machine.")

        subprocess.run(["screencapture", "-x", str(screenshot_path)], check=True)
        return

    if current_os == "Windows":
        try:
            from PIL import ImageGrab
        except ImportError as exc:
            raise RuntimeError(
                "Pillow ImageGrab is unavailable. Install pillow to enable Windows screen capture."
            ) from exc

        screenshot = ImageGrab.grab()
        screenshot.save(screenshot_path)
        return

    if current_os == "Linux":
        if not which("scrot"):
            raise RuntimeError("system 'scrot' command is not available on this machine.")

        subprocess.run(["scrot", str(screenshot_path)], check=True)
        return

    raise RuntimeError(f"unsupported operating system: {current_os}")


def _speak_with_pyttsx3(text: str, voice: str = "") -> None:
    try:
        import pyttsx3
    except ImportError as exc:
        raise RuntimeError(
            "pyttsx3 is unavailable. Install pyttsx3 to enable Windows text_to_speech."
        ) from exc

    engine = pyttsx3.init()
    selected_voice = str(voice).strip()

    if selected_voice:
        engine.setProperty("voice", selected_voice)

    engine.say(text)
    engine.runAndWait()


def _speak_text(text: str, voice: str = "") -> None:
    current_os = platform.system()

    if current_os == "Darwin":
        if not which("say"):
            raise RuntimeError("system 'say' command is not available on this machine.")

        subprocess.run(_build_say_command(text, voice=voice), check=True)
        return

    if current_os == "Windows":
        _speak_with_pyttsx3(text, voice=voice)
        return

    if current_os == "Linux":
        if not which("espeak"):
            raise RuntimeError("system 'espeak' command is not available on this machine.")

        command = ["espeak"]
        selected_voice = str(voice).strip()

        if selected_voice:
            command.extend(["-v", selected_voice])

        command.append(text)
        subprocess.run(command, check=True)
        return

    raise RuntimeError(f"unsupported operating system: {current_os}")


def register(mcp):

    @mcp.tool()
    async def capture_screen() -> str:
        """Capture a screenshot and return the file path."""
        try:
            screenshot_path = Path.home() / "Desktop" / "jarvis_screenshot.png"
            _capture_screen_to_file(screenshot_path)
            return f"Screenshot saved to: {screenshot_path}"
        except Exception as e:
            return f"Failed to capture screen: {str(e)}"

    @mcp.tool()
    async def ocr_image(image_path: str = None) -> str:
        """Perform OCR on an image file or the last screenshot."""
        try:
            if not image_path:
                image_path = Path.home() / "Desktop" / "jarvis_screenshot.png"

            pytesseract, Image = _load_ocr_dependencies()
            img = Image.open(image_path)
            text = pytesseract.image_to_string(img)
            return text.strip()
        except Exception as e:
            return f"OCR failed: {str(e)}"

    @mcp.tool()
    async def obs_start_recording() -> str:
        """Start OBS recording."""
        try:
            _call_obs(lambda obs_requests: obs_requests.StartRecording())
            return "OBS recording started."
        except Exception as e:
            return f"Failed to start OBS recording: {str(e)}"

    @mcp.tool()
    async def obs_stop_recording() -> str:
        """Stop OBS recording."""
        try:
            _call_obs(lambda obs_requests: obs_requests.StopRecording())
            return "OBS recording stopped."
        except Exception as e:
            return f"Failed to stop OBS recording: {str(e)}"

    @mcp.tool()
    async def obs_start_streaming() -> str:
        """Start OBS streaming."""
        try:
            _call_obs(lambda obs_requests: obs_requests.StartStreaming())
            return "OBS streaming started."
        except Exception as e:
            return f"Failed to start OBS streaming: {str(e)}"

    @mcp.tool()
    async def obs_stop_streaming() -> str:
        """Stop OBS streaming."""
        try:
            _call_obs(lambda obs_requests: obs_requests.StopStreaming())
            return "OBS streaming stopped."
        except Exception as e:
            return f"Failed to stop OBS streaming: {str(e)}"

    @mcp.tool()
    async def text_to_speech(text: str, voice: str = "") -> str:
        """Convert text to speech using system TTS."""
        try:
            _speak_text(text, voice=voice)
            return "TTS completed."
        except Exception as e:
            return f"TTS failed: {str(e)}"
