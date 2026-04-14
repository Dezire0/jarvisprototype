"""
Reusable prompt templates registered with the MCP server.
"""


def register(mcp):

    @mcp.prompt()
    def summarize(text: str) -> str:
        """Prompt to summarize a block of text."""
        return f"Summarize the following text concisely:\n\n{text}"

    @mcp.prompt()
    def explain_code(code: str, language: str = "Python") -> str:
        """Prompt to explain a block of code."""
        return (
            f"Explain the following {language} code in plain English, "
            f"step by step:\n\n```{language.lower()}\n{code}\n```"
        )

    @mcp.prompt()
    def translate(text: str, target_language: str) -> str:
        """Prompt to translate text to another language."""
        return f"Translate the following text to {target_language}:\n\n{text}"

    @mcp.prompt()
    def analyze_sentiment(text: str) -> str:
        """Prompt to analyze the sentiment of text."""
        return f"Analyze the sentiment of the following text. Provide a score from -1 (very negative) to 1 (very positive) and explain your reasoning:\n\n{text}"