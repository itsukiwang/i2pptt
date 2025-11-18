from __future__ import annotations

from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
import subprocess
import os
import shutil
from ..settings import get_cli_path, get_default_ppt_filename, get_default_md_filename

router = APIRouter(prefix="/generate", tags=["generate"])


@router.post("")
def generate(
    job_id: str = Query(..., description="Job ID"),
    directory: str = Query(None, description="Root directory containing images (overrides job directory)"),
    filename: str = Query(None, description="Target PPT filename (overrides job filename)"),
) -> dict:
    """Run CLI merge to produce PPT and return output path."""
    from ..models.job import JobStore, JobStatus
    
    # Load job
    try:
        job = JobStore.load(job_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    
    # Use job values if not provided
    if not directory:
        directory = job.directory
        if not directory:
            raise HTTPException(status_code=400, detail="No directory specified in job")
    
    if not filename:
        # Try to get from job first
        if job.filename:
            filename = job.filename
            if filename.endswith('.pptx'):
                filename = filename[:-5]
            filename = f"{filename}.pptx"
        else:
            # Use default PPT filename with date
            filename = get_default_ppt_filename()
            if not filename.endswith('.pptx'):
                filename = f"{filename}.pptx"
    
    # Force use default MD filename
    job_dir = JobStore.job_dir(job_id)
    
    # Always use default MD filename
    default_md_base = get_default_md_filename()
    default_md_name = f"{default_md_base}_structure.md"
    md_path = job_dir / default_md_name
    
    if not md_path.exists():
        raise HTTPException(status_code=400, detail=f"Structure MD file not found: {md_path}. Please run analyze first.")
    
    # Determine the directory where the MD file is located
    md_dir = md_path.parent
    
    # Use default MD filename base for CLI merge command
    # CLI merge expects {filename}_structure.md, so we pass the base name (without _structure.md)
    ppt_filename = default_md_base
    
    # Update job status
    JobStore.update(job_id, status=JobStatus.GENERATING)
    
    cli_root = get_cli_path()
    project_root = cli_root.parent.resolve()
    # Run the CLI script directly instead of using -m mode
    cli_script = cli_root / "i2pptt.py"
    
    # Use the image directory for -d, and run from md_dir so CLI can find the MD file
    # The CLI will look for {ppt_filename}_structure.md in the current working directory (md_dir)
    cmd = ["python3", str(cli_script), "merge", "-d", str(directory), "-f", ppt_filename]
    # Prepare log file path
    log_path = job_dir / "generate.log"
    
    try:
        # Set PYTHONPATH to include project root
        env = os.environ.copy()
        env["PYTHONPATH"] = str(project_root) + (os.pathsep + env.get("PYTHONPATH", ""))
        
        # Build command string for logging
        cmd_str = " ".join(cmd)
        log_content = f"$ {cmd_str}\n"
        
        # Run from the MD file's directory so the CLI can find the MD file
        out = subprocess.check_output(cmd, cwd=str(md_dir), env=env, stderr=subprocess.STDOUT, text=True).strip()
        log_content += out + "\n"
        
        # Save log to file
        log_path.write_text(log_content, encoding="utf-8")
        
        # Output path is relative to md_dir, so make it absolute
        pptx_path = (md_dir / out).resolve() if not Path(out).is_absolute() else Path(out)
        
        # Get file size if file exists
        pptx_size = None
        if pptx_path.exists():
            pptx_size = pptx_path.stat().st_size
        
        # Update job with PPT path and status
        update_data = {
            "status": JobStatus.COMPLETED,
            "artifacts": {"pptx": str(pptx_path)},
        }
        if pptx_size:
            # Merge with existing details
            job = JobStore.load(job_id)
            details = job.details.copy() if job.details else {}
            details["pptx_size"] = pptx_size
            update_data["details"] = details
        
        JobStore.update(job_id, **update_data)
        
        result = {"pptx": str(pptx_path), "job_id": job_id}
        if pptx_size:
            result["pptx_size"] = pptx_size
        return result
    except subprocess.CalledProcessError as exc:
        # Save error to log
        cmd_str = " ".join(cmd)
        log_content = f"$ {cmd_str}\n{exc.output}\n"
        log_path.write_text(log_content, encoding="utf-8")
        JobStore.update(job_id, status=JobStatus.FAILED, message=f"merge failed: {exc.output}")
        raise HTTPException(status_code=500, detail=f"merge failed: {exc.output}") from exc


