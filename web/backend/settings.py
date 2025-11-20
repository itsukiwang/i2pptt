from __future__ import annotations

from pathlib import Path
import tomllib
import os
from typing import Any, Dict

WEB_ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = WEB_ROOT / "settings.toml"


def _load_settings() -> Dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return {}
    try:
        with SETTINGS_PATH.open("rb") as fh:
            return tomllib.load(fh) or {}
    except Exception:
        return {}


def get_root_path() -> str:
    env = os.getenv("I2PPTT_ROOT_PATH", "")
    if env:
        return env
    data = _load_settings()
    server = data.get("server", {}) if isinstance(data, dict) else {}
    if isinstance(server, dict):
        return str(server.get("root_path", "")) or ""
    return ""


def get_cli_path() -> Path:
    data = _load_settings()
    cli = data.get("cli", {}) if isinstance(data, dict) else {}
    path = cli.get("root") if isinstance(cli, dict) else None
    if path:
        p = Path(str(path)).expanduser()
        if not p.is_absolute():
            p = (WEB_ROOT / p).resolve()
        return p
    # default to repo cli/
    return (WEB_ROOT.parent / "cli").resolve()


def get_max_concurrent_users() -> int:
    """Return the maximum number of concurrent users.
    
    Default: 4
    """
    settings = _load_settings()
    server_section = settings.get("server", {})
    if not isinstance(server_section, dict):
        return 4
    max_concurrent = server_section.get("max_concurrent_users", 4)
    try:
        max_concurrent = int(max_concurrent)
        if max_concurrent < 1:
            return 4
        return max_concurrent
    except (ValueError, TypeError):
        return 4


def get_job_retention_hours() -> float:
    """Return the job retention time in hours.
    
    Default: 24.0 hours
    Returns 0.0 if automatic cleanup is disabled.
    """
    settings = _load_settings()
    server_section = settings.get("server", {})
    if not isinstance(server_section, dict):
        return 24.0
    retention = server_section.get("job_retention_hours", 24.0)
    try:
        retention = float(retention)
        if retention < 0:
            return 24.0
        return retention
    except (ValueError, TypeError):
        return 24.0


def get_job_retention_by_status() -> dict[str, float]:
    """Return job retention time in hours by job status.
    
    Returns a dict mapping job status to retention hours.
    If a status is not configured, uses the default retention time.
    
    Default retention times (if cleanup section not configured):
    - completed: 48.0 hours
    - failed: 12.0 hours
    - uploaded: 24.0 hours (uses default)
    - generating: 24.0 hours (uses default)
    """
    settings = _load_settings()
    server_section = settings.get("server", {})
    if not isinstance(server_section, dict):
        # Return empty dict - will use default retention for all
        return {}
    
    cleanup_section = server_section.get("cleanup", {})
    if not isinstance(cleanup_section, dict):
        # Return empty dict - will use default retention for all
        return {}
    
    retention_map = {}
    default_retention = get_job_retention_hours()
    
    # Map status names to retention config keys
    status_config_map = {
        "completed": "retention_completed",
        "failed": "retention_failed",
        "uploaded": "retention_uploaded",
        "generating": "retention_generating",
    }
    
    # Only add entries for statuses that are explicitly configured
    # If cleanup section exists but no status-specific config, return empty dict
    # This allows using default retention for all statuses
    for status, config_key in status_config_map.items():
        retention = cleanup_section.get(config_key)
        if retention is not None:
            try:
                retention = float(retention)
                if retention >= 0:
                    retention_map[status] = retention
                # If negative, don't add to map (will use default)
            except (ValueError, TypeError):
                # Invalid value, don't add to map (will use default)
                pass
    
    return retention_map


def get_job_cleanup_interval() -> int:
    """Return the job cleanup interval in seconds.
    
    Default: 3600 seconds (1 hour)
    Minimum: 60 seconds (1 minute)
    """
    settings = _load_settings()
    server_section = settings.get("server", {})
    if not isinstance(server_section, dict):
        return 3600
    
    cleanup_section = server_section.get("cleanup", {})
    if not isinstance(cleanup_section, dict):
        interval = server_section.get("job_cleanup_interval", 3600)
    else:
        interval = cleanup_section.get("interval", server_section.get("job_cleanup_interval", 3600))
    
    try:
        interval = int(interval)
        if interval < 60:  # Minimum 1 minute
            return 3600
        return interval
    except (ValueError, TypeError):
        return 3600


def get_session_timeout_seconds() -> int:
    """Return the user session timeout in seconds.
    
    Default: 300 seconds (5 minutes)
    """
    settings = _load_settings()
    server_section = settings.get("server", {})
    if not isinstance(server_section, dict):
        return 300
    timeout = server_section.get("session_timeout_seconds", 300)
    try:
        timeout = int(timeout)
        if timeout < 60:  # Minimum 1 minute
            return 300
        return timeout
    except (ValueError, TypeError):
        return 300


def get_default_md_filename() -> str:
    """Return the default MD filename (without extension).
    
    Default: "images"
    """
    settings = _load_settings()
    files_section = settings.get("files", {})
    if not isinstance(files_section, dict):
        return "images"
    return str(files_section.get("default_md_filename", "images"))


def get_default_ppt_filename() -> str:
    """Return the default PPT filename template (without extension).
    
    Supports {date} placeholder which will be replaced with current date.
    Default: "images-{date}"
    """
    from datetime import datetime
    
    settings = _load_settings()
    files_section = settings.get("files", {})
    if not isinstance(files_section, dict):
        template = "images-{date}"
    else:
        template = str(files_section.get("default_ppt_filename", "images-{date}"))
    
    # Get date format
    date_format = "%Y-%m-%d"
    if isinstance(files_section, dict):
        date_format = str(files_section.get("date_format", "%Y-%m-%d"))
    
    # Replace {date} placeholder
    current_date = datetime.now().strftime(date_format)
    filename = template.replace("{date}", current_date)
    
    return filename


