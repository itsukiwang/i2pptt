"""User session tracking for concurrent user limit management."""

from __future__ import annotations

import hashlib
import threading
import time
import uuid
from typing import Any, Dict, Optional, Tuple

from ..settings import get_max_concurrent_users, get_session_timeout_seconds


class UserTracker:
    """Tracks active user sessions for concurrent user limit management."""

    _lock = threading.Lock()
    _active_sessions: Dict[str, float] = {}  # session_id -> last_activity_timestamp
    # Temporary mapping: (ip_hash, user_agent_hash) -> session_id (for concurrent request deduplication)
    _temp_user_mapping: Dict[Tuple[str, str], Tuple[str, float]] = {}  # (ip_hash, ua_hash) -> (session_id, created_at)
    _temp_mapping_ttl = 30.0  # Temporary mapping expires after 30 seconds
    # Store IP and User-Agent for each session for debugging
    _session_info: Dict[str, Dict[str, str]] = {}  # session_id -> {"ip": str, "user_agent": str}

    @classmethod
    def _get_session_timeout(cls) -> int:
        """Get session timeout from configuration."""
        return get_session_timeout_seconds()

    @classmethod
    def _hash_user_identifier(cls, ip: str, user_agent: str) -> Tuple[str, str]:
        """Create hash identifiers for IP and User-Agent."""
        ip_hash = hashlib.md5(ip.encode()).hexdigest()[:16]
        ua_hash = hashlib.md5(user_agent.encode()).hexdigest()[:16]
        return (ip_hash, ua_hash)

    @classmethod
    def _cleanup_inactive_sessions(cls) -> None:
        """Remove sessions that haven't been active recently."""
        current_time = time.time()
        timeout = cls._get_session_timeout()
        inactive_sessions = [
            session_id
            for session_id, last_activity in cls._active_sessions.items()
            if current_time - last_activity > timeout
        ]
        for session_id in inactive_sessions:
            cls._active_sessions.pop(session_id, None)
            cls._session_info.pop(session_id, None)

    @classmethod
    def _cleanup_temp_mapping(cls) -> None:
        """Remove expired temporary user mappings."""
        current_time = time.time()
        expired_keys = [
            key
            for key, (_, created_at) in cls._temp_user_mapping.items()
            if current_time - created_at > cls._temp_mapping_ttl
        ]
        for key in expired_keys:
            cls._temp_user_mapping.pop(key, None)

    @classmethod
    def _get_or_create_session_for_user(
        cls, session_id: Optional[str], ip: str, user_agent: str
    ) -> str:
        """Get or create a session ID for a user, using IP+UA for deduplication."""
        current_time = time.time()
        cls._cleanup_temp_mapping()
        
        # If we have a session ID from cookie, use it
        if session_id and session_id in cls._active_sessions:
            return session_id
        
        # Create user identifier hash
        user_key = cls._hash_user_identifier(ip, user_agent)
        
        # Check if we have a recent temporary mapping for this user
        if user_key in cls._temp_user_mapping:
            temp_session_id, created_at = cls._temp_user_mapping[user_key]
            if current_time - created_at < cls._temp_mapping_ttl:
                if temp_session_id in cls._active_sessions:
                    return temp_session_id
        
        # Check for existing active session with same IP+User-Agent
        timeout = cls._get_session_timeout()
        for existing_session_id, last_activity in cls._active_sessions.items():
            if current_time - last_activity > timeout:
                continue
            existing_info = cls._session_info.get(existing_session_id, {})
            existing_ip = existing_info.get("ip", "unknown")
            existing_ua = existing_info.get("user_agent", "unknown")
            if (existing_ip == "unknown" or not existing_ip):
                existing_ip = ""
            if (existing_ua == "unknown" or not existing_ua):
                existing_ua = ""
            current_ip = ip if ip and ip != "unknown" else ""
            current_ua = user_agent if user_agent and user_agent != "unknown" else ""
            if current_ip or current_ua:
                if existing_ip == current_ip and existing_ua == current_ua:
                    cls._temp_user_mapping[user_key] = (existing_session_id, current_time)
                    return existing_session_id
        
        # Create new session
        new_session_id = uuid.uuid4().hex
        cls._active_sessions[new_session_id] = current_time
        cls._temp_user_mapping[user_key] = (new_session_id, current_time)
        cls._session_info[new_session_id] = {
            "ip": ip if ip else "unknown",
            "user_agent": user_agent if user_agent else "unknown"
        }
        return new_session_id

    @classmethod
    def register_session(
        cls,
        session_id: str | None = None,
        update_activity: bool = True,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> str:
        """Register or update an active user session."""
        with cls._lock:
            cls._cleanup_inactive_sessions()
            
            if session_id and session_id in cls._active_sessions:
                if update_activity:
                    cls._active_sessions[session_id] = time.time()
                if ip or user_agent:
                    ip_valid = ip and ip != "unknown"
                    ua_valid = user_agent and user_agent != "unknown"
                    if ip_valid or ua_valid:
                        current_info = cls._session_info.get(session_id, {})
                        updated = False
                        if current_info.get("ip") == "unknown" and ip_valid:
                            current_info["ip"] = ip
                            updated = True
                        if current_info.get("user_agent") == "unknown" and ua_valid:
                            current_info["user_agent"] = user_agent
                            updated = True
                        if updated:
                            cls._session_info[session_id] = current_info
                return session_id
            
            ip_valid = ip and ip != "unknown"
            ua_valid = user_agent and user_agent != "unknown"
            
            if ip_valid or ua_valid:
                normalized_ip = ip if ip_valid else ""
                normalized_ua = user_agent if ua_valid else ""
                session_id = cls._get_or_create_session_for_user(None, normalized_ip, normalized_ua)
                
                if session_id not in cls._session_info:
                    cls._session_info[session_id] = {"ip": ip or "unknown", "user_agent": user_agent or "unknown"}
                else:
                    current_info = cls._session_info[session_id]
                    updated = False
                    if current_info.get("ip") == "unknown" and ip_valid:
                        current_info["ip"] = ip
                        updated = True
                    if current_info.get("user_agent") == "unknown" and ua_valid:
                        current_info["user_agent"] = user_agent
                        updated = True
                    if updated:
                        cls._session_info[session_id] = current_info
            else:
                session_id = uuid.uuid4().hex
                cls._active_sessions[session_id] = time.time()
                cls._session_info[session_id] = {"ip": ip or "unknown", "user_agent": user_agent or "unknown"}
            
            return session_id

    @classmethod
    def unregister_session(cls, session_id: str) -> None:
        """Unregister a user session."""
        with cls._lock:
            cls._active_sessions.pop(session_id, None)
            cls._session_info.pop(session_id, None)

    @classmethod
    def get_active_count(cls) -> int:
        """Return the current number of active user sessions."""
        with cls._lock:
            cls._cleanup_inactive_sessions()
            return len(cls._active_sessions)

    @classmethod
    def get_max_concurrent(cls) -> int:
        """Return the maximum number of concurrent users."""
        return get_max_concurrent_users()

    @classmethod
    def is_at_capacity(cls) -> bool:
        """Check if the system is at user capacity."""
        return cls.get_active_count() >= cls.get_max_concurrent()


user_tracker = UserTracker()

