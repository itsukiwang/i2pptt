"""Background job cleanup service."""

from __future__ import annotations

import logging
import threading
import time

from ..settings import get_job_retention_hours
from ..models.job import JobStore

logger = logging.getLogger(__name__)


class JobCleanupService:
    """Background service for cleaning up expired jobs."""

    _lock = threading.Lock()
    _thread: threading.Thread | None = None
    _running = False
    _cleanup_interval = 3600  # Run cleanup every hour

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
                    deleted_count = JobStore.cleanup_expired_jobs(retention_hours)
                    if deleted_count > 0:
                        logger.info(f"Cleaned up {deleted_count} expired job(s)")
                else:
                    logger.debug("Job cleanup disabled (retention_hours = 0)")
            except Exception as exc:
                logger.error(f"Error during job cleanup: {exc}", exc_info=True)
            
            # Sleep for cleanup interval, but check _running flag periodically
            for _ in range(cls._cleanup_interval):
                if not cls._running:
                    break
                time.sleep(1)

    @classmethod
    def run_cleanup_now(cls) -> int:
        """Run cleanup immediately and return number of jobs deleted."""
        retention_hours = get_job_retention_hours()
        if retention_hours <= 0:
            return 0
        return JobStore.cleanup_expired_jobs(retention_hours)


cleanup_service = JobCleanupService()

