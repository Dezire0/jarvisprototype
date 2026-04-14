"""
File operations tools — advanced file management.
"""

import shutil
import os
from pathlib import Path
import keyring


def register(mcp):

    @mcp.tool()
    def store_credential(service: str, username: str, password: str) -> str:
        """Store credentials securely."""
        try:
            keyring.set_password("jarvis", f"{service}_username", username)
            keyring.set_password("jarvis", f"{service}_password", password)
            return f"Credentials stored for {service}."
        except Exception as e:
            return f"Failed to store credentials: {str(e)}"

    @mcp.tool()
    def get_credential(service: str) -> dict:
        """Retrieve stored credentials."""
        try:
            username = keyring.get_password("jarvis", f"{service}_username")
            password = keyring.get_password("jarvis", f"{service}_password")
            return {"username": username, "password": password}
        except Exception as e:
            return {"error": str(e)}

    @mcp.tool()
    def copy_file(source: str, destination: str) -> str:
        """Copy a file from source to destination."""
        try:
            shutil.copy2(source, destination)
            return f"File copied from {source} to {destination}."
        except Exception as e:
            return f"Failed to copy file: {str(e)}"

    @mcp.tool()
    def move_file(source: str, destination: str) -> str:
        """Move a file from source to destination."""
        try:
            shutil.move(source, destination)
            return f"File moved from {source} to {destination}."
        except Exception as e:
            return f"Failed to move file: {str(e)}"

    @mcp.tool()
    def delete_file(file_path: str) -> str:
        """Delete a file."""
        try:
            Path(file_path).unlink()
            return f"File deleted: {file_path}."
        except Exception as e:
            return f"Failed to delete file: {str(e)}"

    @mcp.tool()
    def create_directory(dir_path: str) -> str:
        """Create a directory."""
        try:
            Path(dir_path).mkdir(parents=True, exist_ok=True)
            return f"Directory created: {dir_path}."
        except Exception as e:
            return f"Failed to create directory: {str(e)}"