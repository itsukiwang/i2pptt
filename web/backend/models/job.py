"""Job model and persistence helpers for the web backend."""

from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..settings import WEB_ROOT


class JobStatus(str, Enum):
    """Lifecycle states for image-to-PPT processing jobs."""

    UPLOADED = "uploaded"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class Job(BaseModel):
    """Represents a unit of image-to-PPT processing work."""

    id: str
    filename: str
    file_path: Optional[str] = None
    directory: Optional[str] = None  # Directory containing uploaded images
    md_path: Optional[str] = None  # Path to structure MD file
    status: JobStatus = JobStatus.UPLOADED
    message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    artifacts: Dict[str, str] = Field(default_factory=dict)
    details: Dict[str, Any] = Field(default_factory=dict)

    def update_timestamp(self) -> None:
        self.updated_at = datetime.utcnow()

    def artifact_filename(self, key: str) -> Optional[str]:
        value = self.artifacts.get(key)
        return Path(value).name if value else None

    def public_artifacts(self) -> Dict[str, Optional[str]]:
        return {key: self.artifact_filename(key) for key in self.artifacts}


class JobResponse(BaseModel):
    """Serializable job representation for API responses."""

    id: str
    filename: str
    directory: Optional[str]
    md_path: Optional[str]
    status: JobStatus
    message: Optional[str]
    created_at: datetime
    updated_at: datetime
    artifacts: Dict[str, Optional[str]]
    details: Dict[str, Any]

    @classmethod
    def from_job(cls, job: Job) -> "JobResponse":
        return cls(
            id=job.id,
            filename=job.filename,
            directory=job.directory,
            md_path=job.md_path,
            status=job.status,
            message=job.message,
            created_at=job.created_at,
            updated_at=job.updated_at,
            artifacts=job.public_artifacts(),
            details=job.details,
        )


class JobStore:
    """Filesystem-backed persistence for jobs."""

    _lock = threading.RLock()
    _jobs_root = (WEB_ROOT / "storage" / "jobs").resolve()

    @classmethod
    def jobs_root(cls) -> Path:
        cls._jobs_root.mkdir(parents=True, exist_ok=True)
        return cls._jobs_root

    @classmethod
    def job_dir(cls, job_id: str) -> Path:
        path = cls.jobs_root() / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    @classmethod
    def job_file(cls, job_id: str) -> Path:
        return cls.job_dir(job_id) / "job.json"

    @classmethod
    def create_job(
        cls,
        filename: str,
        directory: Optional[str] = None,
    ) -> Job:
        with cls._lock:
            job_id = uuid.uuid4().hex
            job_dir = cls.job_dir(job_id)
            job = Job(
                id=job_id,
                filename=filename,
                directory=directory or str(job_dir / "uploads"),
                file_path=str(job_dir / filename),
            )
            cls._write(job)
            return job

    @classmethod
    def _write(cls, job: Job) -> None:
        job.update_timestamp()
        job_file = cls.job_file(job.id)
        with job_file.open("w", encoding="utf-8") as fh:
            json.dump(job.model_dump(), fh, default=str, ensure_ascii=False, indent=2)

    @classmethod
    def save(cls, job: Job) -> Job:
        with cls._lock:
            cls._write(job)
            return job

    @classmethod
    def load(cls, job_id: str) -> Job:
        job_file = cls.job_file(job_id)
        if not job_file.exists():
            raise FileNotFoundError(f"Job '{job_id}' not found.")
        with job_file.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        data["status"] = JobStatus(data["status"])
        return Job(**data)

    @classmethod
    def update(cls, job_id: str, **updates) -> Job:
        with cls._lock:
            job = cls.load(job_id)
            for key, value in updates.items():
                if hasattr(job, key):
                    setattr(job, key, value)
            job.update_timestamp()
            cls._write(job)
            return job

    @classmethod
    def list_jobs(cls) -> List[Job]:
        jobs: List[Job] = []
        for entry in cls.jobs_root().iterdir():
            if not entry.is_dir():
                continue
            job_file = entry / "job.json"
            if job_file.exists():
                try:
                    jobs.append(cls.load(entry.name))
                except FileNotFoundError:
                    continue
        return sorted(jobs, key=lambda job: job.created_at, reverse=True)

    @classmethod
    def delete(cls, job_id: str) -> None:
        with cls._lock:
            job_dir = cls.job_dir(job_id)
            if not job_dir.exists():
                raise FileNotFoundError(f"Job '{job_id}' not found.")
            shutil.rmtree(job_dir)

    @classmethod
    def cleanup_expired_jobs(
        cls, 
        retention_hours: Optional[float] = None,
        retention_by_status: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """Delete jobs older than retention time.
        
        Args:
            retention_hours: Default retention time in hours. If None, uses default from settings.
            retention_by_status: Dict mapping job status to retention hours. If None, uses default from settings.
        
        Returns:
            Dict with cleanup statistics:
            - deleted_count: Number of jobs deleted
            - deleted_by_status: Dict mapping status to count of deleted jobs
            - total_size_bytes: Total size of deleted job directories in bytes
            - errors: List of error messages
        """
        from datetime import timedelta
        import logging
        
        logger = logging.getLogger(__name__)
        
        # Use provided retention or get from settings
        if retention_hours is None:
            from ..settings import get_job_retention_hours
            retention_hours = get_job_retention_hours()
        
        if retention_hours <= 0:
            return {
                "deleted_count": 0,
                "deleted_by_status": {},
                "total_size_bytes": 0,
                "errors": []
            }
        
        # Use provided retention_by_status or get from settings
        if retention_by_status is None:
            from ..settings import get_job_retention_by_status
            retention_by_status = get_job_retention_by_status()
        
        # If no status-specific retention, use default for all
        if not retention_by_status:
            retention_by_status = {}
        
        deleted_count = 0
        deleted_by_status: Dict[str, int] = {}
        total_size_bytes = 0
        errors: List[str] = []
        current_time = datetime.utcnow()
        
        def get_retention_for_status(status: str) -> float:
            """Get retention time for a specific job status."""
            return retention_by_status.get(status, retention_hours)
        
        def get_dir_size(path: Path) -> int:
            """Calculate total size of directory in bytes."""
            try:
                total = 0
                for item in path.rglob('*'):
                    if item.is_file():
                        total += item.stat().st_size
                return total
            except Exception:
                return 0
        
        with cls._lock:
            for entry in cls.jobs_root().iterdir():
                if not entry.is_dir():
                    continue
                
                job_file = entry / "job.json"
                if not job_file.exists():
                    continue
                
                try:
                    job = cls.load(entry.name)
                    status = job.status.value if hasattr(job.status, 'value') else str(job.status)
                    
                    # Get retention time for this job's status
                    job_retention = get_retention_for_status(status)
                    if job_retention <= 0:
                        continue
                    
                    cutoff_time = current_time - timedelta(hours=job_retention)
                    
                    # Check if job is older than retention time
                    if job.created_at < cutoff_time:
                        try:
                            # Calculate directory size before deletion
                            dir_size = get_dir_size(entry)
                            
                            # Delete the job
                            cls.delete(entry.name)
                            
                            deleted_count += 1
                            deleted_by_status[status] = deleted_by_status.get(status, 0) + 1
                            total_size_bytes += dir_size
                        except Exception as exc:
                            error_msg = f"Failed to delete job '{entry.name}': {exc}"
                            errors.append(error_msg)
                            logger.warning(error_msg, exc_info=True)
                            continue
                except Exception as exc:
                    error_msg = f"Failed to load job '{entry.name}': {exc}"
                    errors.append(error_msg)
                    logger.debug(error_msg, exc_info=True)
                    continue
        
        return {
            "deleted_count": deleted_count,
            "deleted_by_status": deleted_by_status,
            "total_size_bytes": total_size_bytes,
            "errors": errors
        }

