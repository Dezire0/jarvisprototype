"""
Jarvis MCP Server compatibility wrapper.
Run with: python jarvis_server.py
"""


def main():
    from server import main as server_main

    server_main()


if __name__ == "__main__":
    main()
