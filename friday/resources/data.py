"""
Data resources — expose static content or dynamic data via MCP resources.
"""


def register(mcp):

    @mcp.resource("friday://info")
    def server_info() -> str:
        """Returns basic info about this MCP server."""
        return (
            "Friday MCP Server\n"
            "A Friday-style AI assistant with Jarvis-oriented desktop extensions.\n"
            "Built with FastMCP."
        )

    @mcp.resource("friday://capabilities")
    def capabilities() -> str:
        """Returns the capabilities of Friday."""
        return (
            "Friday Capabilities:\n"
            "- Web browsing and automation\n"
            "- File system operations\n"
            "- System information and control\n"
            "- Media processing (OCR, TTS)\n"
            "- OBS streaming control\n"
            "- Secure credential storage\n"
            "- Text processing and analysis"
        )
