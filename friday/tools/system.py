"""
System tools — time, environment info, shell commands, etc.
"""

import datetime
import platform
import subprocess
import os
import pathlib


def register(mcp):

    @mcp.tool()
    def get_current_time() -> str:
        """Return the current date and time in ISO 8601 format."""
        return datetime.datetime.now().isoformat()

    @mcp.tool()
    def get_system_info() -> dict:
        """Return basic information about the host system."""
        return {
            "os": platform.system(),
            "os_version": platform.version(),
            "machine": platform.machine(),
            "python_version": platform.python_version(),
        }

    @mcp.tool()
    def run_shell_command(command: str) -> str:
        """Execute a shell command and return the output."""
        try:
            result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
            return f"Exit code: {result.returncode}\nStdout: {result.stdout}\nStderr: {result.stderr}"
        except Exception as e:
            return f"Command failed: {str(e)}"

    @mcp.tool()
    def list_directory(path: str = ".") -> str:
        """List contents of a directory."""
        try:
            p = pathlib.Path(path).expanduser()
            if not p.exists():
                return f"Path does not exist: {path}"
            items = []
            for item in p.iterdir():
                item_type = "dir" if item.is_dir() else "file"
                items.append(f"{item_type}: {item.name}")
            return "\n".join(items)
        except Exception as e:
            return f"Failed to list directory: {str(e)}"

    @mcp.tool()
    def read_file(file_path: str) -> str:
        """Read the contents of a file."""
        try:
            p = pathlib.Path(file_path).expanduser()
            if not p.exists():
                return f"File does not exist: {file_path}"
            return p.read_text()
        except Exception as e:
            return f"Failed to read file: {str(e)}"

    @mcp.tool()
    def write_file(file_path: str, content: str) -> str:
        """Write content to a file."""
        try:
            p = pathlib.Path(file_path).expanduser()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            return f"Successfully wrote to {file_path}"
        except Exception as e:
            return f"Failed to write file: {str(e)}"