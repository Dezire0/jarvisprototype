import importlib
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from friday.credentials import normalize_site_key
from friday.tools import file_ops, media


class DummyMCP:
    def __init__(self):
        self.tools = {}

    def tool(self):
        def decorator(fn):
            self.tools[fn.__name__] = fn
            return fn

        return decorator


class FridaySmokeTests(unittest.TestCase):
    def test_normalize_site_key_handles_urls(self):
        self.assertEqual(normalize_site_key("https://www.github.com/login"), "github.com")

    def test_voice_preflight_reports_missing_env(self):
        with (
            patch("dotenv.load_dotenv", return_value=False),
            patch("platform.system", return_value="Darwin"),
            patch("shutil.which", return_value="/usr/bin/say"),
            patch.dict(os.environ, {}, clear=True),
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertFalse(status["ready"])
        self.assertIn("LIVEKIT_URL", status["missing_env"])
        self.assertIn("GROQ_API_KEY", status["missing_env"])
        self.assertIn("OPENAI_API_KEY", status["missing_env"])
        self.assertIn("GEMINI_API_KEY", status["missing_env"])
        self.assertIsNone(status["active_stt_provider"])
        self.assertEqual(status["llm_provider"], "gemini")
        self.assertEqual(status["active_tts_provider"], "macos")

    def test_voice_preflight_uses_openai_fallback_when_groq_is_missing(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "FRIDAY_LLM_PROVIDER": "openai",
                "OPENAI_API_KEY": "sk-live-valid",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertTrue(status["ready"])
        self.assertEqual(status["stt_provider"], "groq")
        self.assertEqual(status["stt_fallback_provider"], "openai")
        self.assertEqual(status["active_stt_provider"], "openai")
        self.assertEqual(status["missing_env"], [])
        self.assertIn("GROQ_API_KEY", status["optional_missing_env"])

    def test_voice_preflight_is_ready_with_default_gemini_llm_when_required_keys_are_set(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "GROQ_API_KEY": "gsk_live_valid",
                "GEMINI_API_KEY": "gemini-live-valid",
                "OPENAI_API_KEY": "sk-live-valid",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertTrue(status["ready"])
        self.assertEqual(status["llm_provider"], "gemini")
        self.assertEqual(status["active_stt_provider"], "groq")
        self.assertEqual(status["missing_env"], [])

    def test_voice_preflight_requires_google_only_when_gemini_is_selected(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ, {"FRIDAY_LLM_PROVIDER": "gemini"}, clear=True
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertEqual(status["llm_provider"], "gemini")
        self.assertIn("GEMINI_API_KEY", status["missing_env"])

    def test_voice_preflight_accepts_google_api_key_alias_for_gemini(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "GROQ_API_KEY": "gsk_live_valid",
                "OPENAI_API_KEY": "sk-live-valid",
                "GOOGLE_API_KEY": "google-live-valid",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertTrue(status["ready"])
        self.assertEqual(status["llm_provider"], "gemini")

    def test_voice_preflight_accepts_openai_compatible_llm_with_local_base_url(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "FRIDAY_LLM_PROVIDER": "lmstudio",
                "FRIDAY_LLM_MODEL": "qwen2.5-coder-7b-instruct",
                "FRIDAY_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
                "OPENAI_API_KEY": "sk-live-valid",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()
            resolved_base_url = agent_friday._openai_compatible_llm_base_url()
            resolved_model = agent_friday._openai_compatible_llm_model()

        self.assertTrue(status["ready"])
        self.assertEqual(status["llm_provider"], "openai-compatible")
        self.assertEqual(resolved_base_url, "http://127.0.0.1:1234/v1")
        self.assertEqual(resolved_model, "qwen2.5-coder-7b-instruct")

    def test_voice_preflight_can_reuse_jarvis_complex_url_for_openai_compatible_llm(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "FRIDAY_LLM_PROVIDER": "openai-compatible",
                "JARVIS_COMPLEX_LLM_URL": "http://127.0.0.1:1234/v1/chat/completions",
                "JARVIS_COMPLEX_LLM_MODEL": "qwen3:14b",
                "OPENAI_API_KEY": "sk-live-valid",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()
            resolved_base_url = agent_friday._openai_compatible_llm_base_url()
            resolved_model = agent_friday._openai_compatible_llm_model()

        self.assertTrue(status["ready"])
        self.assertEqual(status["llm_provider"], "openai-compatible")
        self.assertEqual(resolved_base_url, "http://127.0.0.1:1234/v1")
        self.assertEqual(resolved_model, "qwen3:14b")

    def test_voice_preflight_treats_example_values_as_missing(self):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(
            os.environ,
            {
                "LIVEKIT_URL": "wss://your-project-xxxxx.livekit.cloud",
                "LIVEKIT_API_KEY": "APIxxxxxxxxxxxxx",
                "LIVEKIT_API_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                "GROQ_API_KEY": "your_api_key_here",
                "GEMINI_API_KEY": "gemini-live-valid",
                "OPENAI_API_KEY": "sk-live-example",
            },
            clear=True,
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertIn("LIVEKIT_URL", status["missing_env"])
        self.assertIn("LIVEKIT_API_KEY", status["missing_env"])
        self.assertIn("LIVEKIT_API_SECRET", status["missing_env"])
        self.assertIn("GROQ_API_KEY", status["optional_missing_env"])
        self.assertNotIn("OPENAI_API_KEY", status["missing_env"])

    def test_voice_preflight_can_run_with_macos_tts_without_paid_tts_keys(self):
        with (
            patch("dotenv.load_dotenv", return_value=False),
            patch("platform.system", return_value="Darwin"),
            patch("shutil.which", return_value="/usr/bin/say"),
            patch.dict(
                os.environ,
                {
                    "LIVEKIT_URL": "ws://127.0.0.1:7880",
                    "LIVEKIT_API_KEY": "devkey",
                    "LIVEKIT_API_SECRET": "secret",
                    "FRIDAY_STT_PROVIDER": "openai",
                    "OPENAI_API_KEY": "sk-live-valid",
                    "FRIDAY_LLM_PROVIDER": "openai-compatible",
                    "FRIDAY_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
                    "FRIDAY_TTS_PROVIDER": "macos",
                },
                clear=True,
            ),
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertTrue(status["ready"])
        self.assertEqual(status["active_tts_provider"], "macos")
        self.assertEqual(status["missing_env"], [])

    def test_voice_preflight_falls_back_to_macos_tts_when_openai_tts_key_is_missing(self):
        with (
            patch("dotenv.load_dotenv", return_value=False),
            patch("platform.system", return_value="Darwin"),
            patch("shutil.which", return_value="/usr/bin/say"),
            patch.dict(
                os.environ,
                {
                    "LIVEKIT_URL": "ws://127.0.0.1:7880",
                    "LIVEKIT_API_KEY": "devkey",
                    "LIVEKIT_API_SECRET": "secret",
                    "FRIDAY_STT_PROVIDER": "groq",
                    "GROQ_API_KEY": "gsk_live_valid",
                    "FRIDAY_LLM_PROVIDER": "openai-compatible",
                    "FRIDAY_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
                    "FRIDAY_TTS_PROVIDER": "openai",
                    "FRIDAY_TTS_FALLBACK_PROVIDER": "macos",
                },
                clear=True,
            ),
        ):
            sys.modules.pop("agent_friday", None)
            agent_friday = importlib.import_module("agent_friday")
            status = agent_friday.get_runtime_preflight()

        self.assertTrue(status["ready"])
        self.assertEqual(status["active_tts_provider"], "macos")
        self.assertIn("OPENAI_API_KEY", status["optional_missing_env"])

    def test_server_imports_without_optional_tool_crash(self):
        server = importlib.import_module("server")
        self.assertIsNotNone(server.mcp)

    def test_file_ops_get_credential_uses_storage_helper(self):
        mcp = DummyMCP()
        file_ops.register(mcp)

        with patch("friday.tools.file_ops.load_credential", return_value={"username": "tony", "password": "mk42"}):
            result = mcp.tools["get_credential"]("stark.com")

        self.assertEqual(result["username"], "tony")
        self.assertEqual(result["password"], "mk42")

    def test_build_say_command_omits_voice_when_not_provided(self):
        self.assertEqual(media._build_say_command("Hello there"), ["say", "Hello there"])
        self.assertEqual(media._build_say_command("Hello there", voice="Samantha"), ["say", "-v", "Samantha", "Hello there"])

    def test_capture_screen_uses_windows_imagegrab(self):
        screenshot_path = Path("screenshot.png")
        screenshot = Mock()
        image_grab = types.SimpleNamespace(grab=Mock(return_value=screenshot))
        pil = types.SimpleNamespace(ImageGrab=image_grab)

        with patch("friday.tools.media.platform.system", return_value="Windows"), patch.dict(
            sys.modules, {"PIL": pil}
        ):
            media._capture_screen_to_file(screenshot_path)

        image_grab.grab.assert_called_once_with()
        screenshot.save.assert_called_once_with(screenshot_path)

    def test_capture_screen_uses_linux_scrot(self):
        screenshot_path = Path("/tmp/screenshot.png")

        with (
            patch("friday.tools.media.platform.system", return_value="Linux"),
            patch("friday.tools.media.which", return_value="/usr/bin/scrot"),
            patch("friday.tools.media.subprocess.run") as run,
        ):
            media._capture_screen_to_file(screenshot_path)

        run.assert_called_once_with(["scrot", str(screenshot_path)], check=True)

    def test_text_to_speech_uses_windows_pyttsx3(self):
        engine = Mock()
        pyttsx3 = types.SimpleNamespace(init=Mock(return_value=engine))

        with patch("friday.tools.media.platform.system", return_value="Windows"), patch.dict(
            sys.modules, {"pyttsx3": pyttsx3}
        ):
            media._speak_text("Hello there", voice="voice-id")

        pyttsx3.init.assert_called_once_with()
        engine.setProperty.assert_called_once_with("voice", "voice-id")
        engine.say.assert_called_once_with("Hello there")
        engine.runAndWait.assert_called_once_with()

    def test_text_to_speech_uses_linux_espeak(self):
        with (
            patch("friday.tools.media.platform.system", return_value="Linux"),
            patch("friday.tools.media.which", return_value="/usr/bin/espeak"),
            patch("friday.tools.media.subprocess.run") as run,
        ):
            media._speak_text("Hello there", voice="en")

        run.assert_called_once_with(["espeak", "-v", "en", "Hello there"], check=True)


if __name__ == "__main__":
    unittest.main()
