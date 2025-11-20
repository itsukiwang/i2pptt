"""Background job cleanup service."""

from __future__ import annotations

import logging
import threading
import time
from typing import Dict, Any

from ..settings import (
    get_job_retention_hours,
    get_job_retention_by_status,
    get_job_cleanup_interval,
)
from ..models.job import JobStore

logger = logging.getLogger(__name__)


class JobCleanupService:
    """Background service for cleaning up expired jobs."""

    _lock = threading.Lock()
    _thread: threading.Thread | None = None
    _running = False

    @classmethod
    def _get_cleanup_interval(cls) -> int:
        """Get cleanup interval from settings."""
        return get_job_cleanup_interval()

    @classmethod
    def _get_storage_size(cls) -> int:
        """Calculate total size of storage/jobs directory in bytes."""
        jobs_root = JobStore.jobs_root()
        if not jobs_root.exists():
            return 0
        
        try:
            total = 0
            for item in jobs_root.rglob('*'):
                if item.is_file():
                    total += item.stat().st_size
            return total
        except Exception:
            return 0

    @classmethod
    def _format_size(cls, size_bytes: int) -> str:
        """Format size in bytes to human-readable string."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.2f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.2f} PB"

    @classmethod
    def start(cls) -> None:
        """Start the cleanup service."""
        with cls._lock:
            if cls._running:
                return
            
            cls._running = True
            cls._thread = threading.Thread(target=cls._run_cleanup_loop, daemon=True)
            cls._thread.start()
            logger.info("Job cleanup service started")

    @classmethod
    def stop(cls) -> None:
        """Stop the cleanup service."""
        with cls._lock:
            if not cls._running:
                return
            
            cls._running = False
            if cls._thread:
                cls._thread.join(timeout=5)
            logger.info("Job cleanup service stopped")

    @classmethod
    def _run_cleanup_loop(cls) -> None:
        """Main cleanup loop."""
        while cls._running:
            try:
                retention_hours = get_job_retention_hours()
                if retention_hours > 0:
                    # Get storage size before cleanup
                    size_before = cls._get_storage_size()
                    
                    # Run cleanup with status-based retention
                    retention_by_status = get_job_retention_by_status()
                    stats = JobStore.cleanup_expired_jobs(
                        retention_hours=retention_hours,
                        retention_by_status=retention_by_status
                    )
                    
                    # Log cleanup statistics
                    deleted_count = stats.get("deleted_count", 0)
                    if deleted_count > 0:
                        deleted_by_status = stats.get("deleted_by_status", {})
                        total_size_bytes = stats.get("total_size_bytes", 0)
                        errors = stats.get("errors", [])
                        
                        # Format status breakdown
                        status_parts = []
                        for status, count in sorted(deleted_by_status.items()):
                            status_parts.append(f"{status}: {count}")
                        status_str = ", ".join(status_parts) if status_parts else "N/A"
                        
                        # Get storage size after cleanup
                        size_after = cls._get_storage_size()
                        size_freed = size_before - size_after
                        
                        logger.info(
                            f"Job cleanup completed: "
                            f"deleted {deleted_count} job(s) "
                            f"({status_str}), "
                            f"freed {cls._format_size(size_freed)} "
                            f"(storage: {cls._format_size(size_before)} -> {cls._format_size(size_after)})"
                        )
                        
                        if errors:
                            logger.warning(f"Cleanup encountered {len(errors)} error(s): {errors[:3]}")
                    else:
                        # Log that cleanup ran but nothing was deleted
                        size_after = cls._get_storage_size()
                        logger.debug(
                            f"Job cleanup ran: no expired jobs found "
                            f"(storage: {cls._format_size(size_after)})"
                        )
                else:
                    logger.debug("Job cleanup disabled (retention_hours = 0)")
            except Exception as exc:
                logger.error(f"Error during job cleanup: {exc}", exc_info=True)
            
            # Sleep for cleanup interval, but check _running flag periodically
            cleanup_interval = cls._get_cleanup_interval()
            for _ in range(cleanup_interval):
                if not cls._running:
                    break
                time.sleep(1)

    @classmethod
    def run_cleanup_now(cls) -> Dict[str, Any]:
        """Run cleanup immediately and return cleanup statistics.
        
        Returns:
            Dict with cleanup statistics (same format as JobStore.cleanup_expired_jobs)
        """
        retention_hours = get_job_retention_hours()
        if retention_hours <= 0:
            return {
                "deleted_count": 0,
                "deleted_by_status": {},
                "total_size_bytes": 0,
                "errors": []
            }
        
        # Get storage size before cleanup
        size_before = cls._get_storage_size()
        
        # Run cleanup with status-based retention
        retention_by_status = get_job_retention_by_status()
        stats = JobStore.cleanup_expired_jobs(
            retention_hours=retention_hours,
            retention_by_status=retention_by_status
        )
        
        # Add storage size info to stats
        size_after = cls._get_storage_size()
        stats["storage_size_before_bytes"] = size_before
        stats["storage_size_after_bytes"] = size_after
        stats["storage_size_freed_bytes"] = size_before - size_after
        
        # Log the cleanup
        deleted_count = stats.get("deleted_count", 0)
        if deleted_count > 0:
            deleted_by_status = stats.get("deleted_by_status", {})
            status_parts = [f"{status}: {count}" for status, count in sorted(deleted_by_status.items())]
            status_str = ", ".join(status_parts) if status_parts else "N/A"
            
            logger.info(
                f"Manual cleanup completed: "
                f"deleted {deleted_count} job(s) ({status_str}), "
                f"freed {cls._format_size(stats['storage_size_freed_bytes'])}"
            )
        
        return stats


cleanup_service = JobCleanupService()

