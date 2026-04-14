"""
Utility tools — text processing, formatting, calculations, etc.
"""

import json


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
