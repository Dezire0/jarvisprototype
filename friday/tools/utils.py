"""
Utility tools — text processing, formatting, calculations, etc.
"""

import json
import base64


def register(mcp):

    @mcp.tool()
    def format_json(data: str) -> str:
        """Pretty-print a JSON string."""
        try:
            parsed = json.loads(data)
            return json.dumps(parsed, indent=2)
        except json.JSONDecodeError as e:
            return f"Invalid JSON: {e}"

    @mcp.tool()
    def word_count(text: str) -> dict:
        """Count words, characters, and lines in a block of text."""
        lines = text.splitlines()
        words = text.split()
        return {
            "characters": len(text),
            "words": len(words),
            "lines": len(lines),
        }

    @mcp.tool()
    def base64_encode(text: str) -> str:
        """Encode text to base64."""
        return base64.b64encode(text.encode()).decode()

    @mcp.tool()
    def base64_decode(encoded: str) -> str:
        """Decode base64 to text."""
        try:
            return base64.b64decode(encoded).decode()
        except Exception as e:
            return f"Invalid base64: {e}"
