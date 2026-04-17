"""
File operations tools — advanced file management.
"""

import shutil
from pathlib import Path
from friday.credentials import (
    delete_credential as remove_credential,
    get_credential as load_credential,
    list_credentials,
    save_credential,
)
from friday.safety import guard_sensitive_action, log_sensitive_action


def register(mcp):

    @mcp.tool()
    def store_credential(service: str, username: str, password: str, login_url: str = "") -> str:
        """Store credentials securely."""
        try:
            saved = save_credential(service, username, password, login_url=login_url)
            return f"Credentials stored for {saved['site']}."
        except Exception as e:
            return f"Failed to store credentials: {str(e)}"

    @mcp.tool()
    def get_credential(service: str) -> dict:
        """Retrieve stored credentials."""
        try:
            data = load_credential(service)
            return data or {"error": f"Credentials not found for {service}."}
        except Exception as e:
            return {"error": str(e)}

    @mcp.tool()
    def list_saved_credentials() -> list[dict]:
        """List saved credential metadata."""
        return list_credentials()

    @mcp.tool()
    def delete_saved_credential(service: str, confirmed: bool = False) -> dict:
        """Delete a saved credential."""
        blocked = guard_sensitive_action("delete_saved_credential", target=service, confirmed=confirmed)
        if blocked:
            return {"error": blocked}
        deleted = remove_credential(service)
        log_sensitive_action("delete_saved_credential", target=service, status="executed")
        return deleted

    @mcp.tool()
    def copy_file(source: str, destination: str, confirmed: bool = False) -> str:
        """Copy a file from source to destination."""
        blocked = guard_sensitive_action("copy_file", target=f"{source} -> {destination}", confirmed=confirmed)
        if blocked:
            return blocked
        try:
            shutil.copy2(source, destination)
            log_sensitive_action("copy_file", target=f"{source} -> {destination}", status="executed")
            return f"File copied from {source} to {destination}."
        except Exception as e:
            return f"Failed to copy file: {str(e)}"

    @mcp.tool()
    def move_file(source: str, destination: str, confirmed: bool = False) -> str:
        """Move a file from source to destination."""
        blocked = guard_sensitive_action("move_file", target=f"{source} -> {destination}", confirmed=confirmed)
        if blocked:
            return blocked
        try:
            shutil.move(source, destination)
            log_sensitive_action("move_file", target=f"{source} -> {destination}", status="executed")
            return f"File moved from {source} to {destination}."
        except Exception as e:
            return f"Failed to move file: {str(e)}"

    @mcp.tool()
    def delete_file(file_path: str, confirmed: bool = False) -> str:
        """Delete a file."""
        blocked = guard_sensitive_action("delete_file", target=file_path, confirmed=confirmed)
        if blocked:
            return blocked
        try:
            Path(file_path).unlink()
            log_sensitive_action("delete_file", target=file_path, status="executed")
            return f"File deleted: {file_path}."
        except Exception as e:
            return f"Failed to delete file: {str(e)}"

    @mcp.tool()
    def create_directory(dir_path: str, confirmed: bool = False) -> str:
        """Create a directory."""
        blocked = guard_sensitive_action("create_directory", target=dir_path, confirmed=confirmed)
        if blocked:
            return blocked
        try:
            Path(dir_path).mkdir(parents=True, exist_ok=True)
            log_sensitive_action("create_directory", target=dir_path, status="executed")
            return f"Directory created: {dir_path}."
        except Exception as e:
            return f"Failed to create directory: {str(e)}"
