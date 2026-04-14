"""
Jarvis voice agent compatibility wrapper.
Run with: python jarvis_agent.py dev
"""


def main():
    from agent_friday import main as friday_main

    friday_main()


def dev():
    from agent_friday import dev as friday_dev

    friday_dev()


if __name__ == "__main__":
    main()
