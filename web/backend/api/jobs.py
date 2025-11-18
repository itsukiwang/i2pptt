"""Job management endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException, Response, status, Query
from fastapi.responses import FileResponse, PlainTextResponse

from ..models.job import JobResponse, JobStore

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=List[JobResponse])
def list_jobs() -> List[JobResponse]:
    """List all jobs."""
    return [JobResponse.from_job(job) for job in JobStore.list_jobs()]


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str) -> JobResponse:
    """Get job by ID."""
    try:
        job = JobStore.load(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return JobResponse.from_job(job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_job(job_id: str) -> Response:
    """Delete job by ID."""
    try:
        JobStore.delete(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{job_id}/download")
def download_job_pptx(job_id: str) -> FileResponse:
    """Download the generated PPTX file for a job."""
    try:
        job = JobStore.load(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    # Get PPTX path from artifacts
    pptx_path = job.artifacts.get("pptx")
    if not pptx_path:
        raise HTTPException(status_code=404, detail="PPTX file not found for this job")
    
    pptx_file = Path(pptx_path)
    if not pptx_file.exists():
        raise HTTPException(status_code=404, detail=f"PPTX file not found: {pptx_path}")
    
    return FileResponse(
        path=str(pptx_file),
        filename=pptx_file.name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


@router.get("/{job_id}/log", response_class=PlainTextResponse)
def get_job_log(job_id: str, log_type: str = Query("all", description="Log type: 'analyze', 'generate', or 'all'")) -> PlainTextResponse:
    """Get terminal log for a job."""
    try:
        job = JobStore.load(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
    job_dir = JobStore.job_dir(job_id)
    log_content = []
    
    if log_type in ("analyze", "all"):
        analyze_log = job_dir / "analyze.log"
        if analyze_log.exists():
            try:
                log_content.append(analyze_log.read_text(encoding="utf-8"))
            except OSError:
                pass
    
    if log_type in ("generate", "all"):
        generate_log = job_dir / "generate.log"
        if generate_log.exists():
            try:
                log_content.append(generate_log.read_text(encoding="utf-8"))
            except OSError:
                pass
    
    return PlainTextResponse("\n".join(log_content))

