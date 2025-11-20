from __future__ import annotations

from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Query, HTTPException
import subprocess
import shutil
import os
import sys

from ..settings import get_cli_path, get_default_md_filename
from ..models.job import JobStore, JobStatus

router = APIRouter(prefix="/analyze", tags=["analyze"])


@router.get("")
def analyze(
    job_id: str = Query(..., description="Job ID"),
    directory: Optional[str] = Query(None, description="Root directory containing images (overrides job directory)"),
    filename: Optional[str] = Query(None, description="Target PPT filename (for MD name derivation)"),
) -> dict:
    """Run CLI scan to produce structure MD and return content."""
    # Load job
    try:
        job = JobStore.load(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    
    # Use job directory if not provided
    if not directory:
        directory = job.directory
        if not directory:
            raise HTTPException(status_code=400, detail="No directory specified in job")
    
    # Force use default MD filename for scan
    # The CLI scan command will generate MD file as {filename}_structure.md
    # We always use the default MD filename regardless of job filename
    default_md_base = get_default_md_filename()
    # Use default MD filename for scan
    scan_filename = f"{default_md_base}.pptx"  # CLI will derive MD from this
    
    # Update job status
    JobStore.update(job_id, status=JobStatus.ANALYZING)
    
    cli_root = get_cli_path()
    # Use the project root as working directory to ensure module can be found
    project_root = cli_root.parent.resolve()
    # Run the CLI script directly instead of using -m mode
    cli_script = cli_root / "i2pptt.py"
    # Use current Python interpreter (from venv) instead of system python3
    python_exe = sys.executable
    # Use default MD filename for scan
    cmd = [python_exe, str(cli_script), "scan", "-d", directory, "-f", scan_filename]
    
    # Prepare log file path
    job_dir = JobStore.job_dir(job_id)
    log_path = job_dir / "analyze.log"
    
    try:
        # Set PYTHONPATH to include project root, and run from project root
        env = os.environ.copy()
        env["PYTHONPATH"] = str(project_root) + (os.pathsep + env.get("PYTHONPATH", ""))
        
        # Build command string for logging
        cmd_str = " ".join(cmd)
        log_content = f"$ {cmd_str}\n"
        
        # Run command and capture output
        out = subprocess.check_output(cmd, cwd=project_root, env=env, stderr=subprocess.STDOUT, text=True).strip()
        log_content += out + "\n"
        
        # Save log to file
        log_path.write_text(log_content, encoding="utf-8")
        
        md_path = Path(out)
        
        # Move MD file to job directory with default name (force default name)
        job_dir = JobStore.job_dir(job_id)
        # Always use default MD filename
        default_md_name = f"{default_md_base}_structure.md"
        job_md_path = job_dir / default_md_name
        
        # If the generated MD file exists, move/rename it to default name
        if md_path.exists():
            # Remove old default MD file if exists (to avoid conflicts)
            if job_md_path.exists() and job_md_path != md_path:
                job_md_path.unlink()
            # Move/rename to default name
            if md_path != job_md_path:
                shutil.move(str(md_path), str(job_md_path))
            md_path = job_md_path
        
        # Read MD file content
        if md_path.exists():
            md_content = md_path.read_text(encoding="utf-8")
            
            # Update job with MD path and status
            JobStore.update(
                job_id,
                md_path=str(md_path),
                status=JobStatus.ANALYZED,
            )
            
            return {
                "job_id": job_id,
                "md_path": str(md_path),
                "md_content": md_content,
                "directory": directory,
                "filename": filename,
            }
        else:
            JobStore.update(job_id, status=JobStatus.FAILED, message=f"MD file not found: {md_path}")
            raise HTTPException(status_code=500, detail=f"MD file not found: {md_path}")
    except subprocess.CalledProcessError as exc:
        # Save error to log
        cmd_str = " ".join(cmd)
        log_content = f"$ {cmd_str}\n{exc.output}\n"
        log_path.write_text(log_content, encoding="utf-8")
        JobStore.update(job_id, status=JobStatus.FAILED, message=f"scan failed: {exc.output}")
        raise HTTPException(status_code=500, detail=f"scan failed: {exc.output}") from exc
    except Exception as exc:
        JobStore.update(job_id, status=JobStatus.FAILED, message=str(exc))
        raise HTTPException(status_code=500, detail=f"Error processing scan result: {exc}") from exc


