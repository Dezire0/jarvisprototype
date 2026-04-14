"""
Friday MCP Server — Entry Point
Run with: python server.py
"""

from mcp.server.fastmcp import FastMCP
from friday.tools import register_all_tools
from friday.prompts import register_all_prompts
from friday.resources import register_all_resources
from friday.config import config

mcp = FastMCP(
    name=config.SERVER_NAME,
    instructions=(
        "You are Jarvis, a calm bilingual AI assistant inspired by Iron Man's AI. "
        "You have access to a set of tools to help the user. "
        "Be concise, accurate, capable, and natural in either Korean or English."
    ),
)

register_all_tools(mcp)
register_all_prompts(mcp)
register_all_resources(mcp)


def main():
    mcp.run(transport="sse")


if __name__ == "__main__":
    main()
