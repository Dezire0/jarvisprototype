"""
MCP Prompts — reusable prompt templates exposed to the client.
"""

from friday.prompts import templates


def register_all_prompts(mcp):
    templates.register(mcp)
