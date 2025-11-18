from __future__ import annotations

from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Cookie
import shutil
import zipfile
import sys
import struct

# Optional archive support
try:
    import rarfile
    HAS_RAR = True
except ImportError:
    HAS_RAR = False

try:
    import py7zr
    HAS_7Z = True
except ImportError:
    HAS_7Z = False

from ..settings import get_cli_path, get_default_ppt_filename
from ..models.job import JobStore, JobStatus
from ..services.user_tracker import user_tracker

router = APIRouter(prefix="/upload", tags=["upload"])


def decode_zip_filename(member_name: str, raw_bytes: bytes, encodings: List[str]) -> str:
    """Try to decode a zip filename using multiple encodings.
    
    Args:
        member_name: The filename from zipfile (may be incorrectly decoded)
        raw_bytes: The raw bytes of the filename from the zip file
        encodings: List of encodings to try in order
    
    Returns:
        Decoded filename, or original if all encodings fail
    """
    # Try each encoding in order
    for encoding in encodings:
        try:
            decoded = raw_bytes.decode(encoding)
            # Validate that the decoded string is reasonable (not just question marks)
            # If decoding produces mostly replacement characters, it's probably wrong
            if decoded and '?' not in decoded[:10]:  # Check first 10 chars
                return decoded
        except (UnicodeDecodeError, UnicodeEncodeError, LookupError):
            continue
    
    # If all encodings fail, try to use the member_name as-is
    # It might already be correctly decoded by zipfile
    return member_name


def get_raw_filename_bytes(zip_file: zipfile.ZipFile, member_info: zipfile.ZipInfo) -> bytes:
    """Get raw filename bytes from zip file entry.
    
    This accesses the internal structure of the zip file to get the original
    bytes before any decoding. Tries local file header first, then central directory.
    """
    zip_path = zip_file.filename
    if isinstance(zip_path, str):
        zip_path = Path(zip_path)
    
    try:
        with open(zip_path, 'rb') as f:
            # Method 1: Try local file header (header_offset points to local file header)
            if hasattr(member_info, 'header_offset') and member_info.header_offset is not None:
                try:
                    f.seek(member_info.header_offset)
                    signature = f.read(4)
                    if signature == b'PK\x03\x04':  # Local file header signature
                        # Skip 22 bytes (version, flags, compression, etc.)
                        f.read(22)
                        # Read filename length (2 bytes, little-endian)
                        filename_len_bytes = f.read(2)
                        if len(filename_len_bytes) == 2:
                            filename_length = int.from_bytes(filename_len_bytes, 'little')
                            # Skip extra field length
                            f.read(2)
                            # Read raw filename bytes
                            raw_bytes = f.read(filename_length)
                            if len(raw_bytes) == filename_length and filename_length > 0:
                                return raw_bytes
                except (OSError, IOError, ValueError, struct.error, IndexError):
                    pass
            
            # Method 2: Try to read from the zipfile's internal _file_offsets
            # zipfile stores file offsets internally, we can use them
            # But this requires accessing private attributes, so we'll skip it
            
            # Method 3: Parse the zip file manually to find the entry
            # This is more complex but more reliable
            raise ValueError("Cannot read from local file header")
            
    except Exception as e:
        # If we can't get raw bytes, raise to trigger fallback
        raise ValueError(f"Cannot get raw filename bytes: {e}") from e


def extract_zip_with_encoding(archive_path: Path, output_dir: Path) -> None:
    """Extract zip file with automatic encoding detection for filenames.
    
    Supports multiple languages: Chinese (GBK, UTF-8), Japanese (Shift_JIS, CP932),
    Korean (EUC-KR, CP949), and other languages (UTF-8).
    Automatically detects and uses the correct encoding.
    """
    # Common encodings to try, in order of likelihood
    encodings = [
        'utf-8',           # Modern standard, supports all languages
        'gbk',             # Chinese (Simplified)
        'gb2312',          # Chinese (Simplified, older)
        'big5',            # Chinese (Traditional)
        'shift_jis',       # Japanese
        'cp932',           # Japanese (Windows)
        'euc-kr',          # Korean
        'cp949',           # Korean (Windows)
        'latin1',          # Western European
        'cp437',           # Original zipfile default
    ]
    
    # Try each encoding with metadata_encoding (Python 3.11+)
    if sys.version_info >= (3, 11):
        last_error = None
        for encoding in encodings:
            try:
                with zipfile.ZipFile(archive_path, "r", metadata_encoding=encoding) as zf:
                    # Test a few filenames to see if encoding is correct
                    test_files = list(zf.infolist())[:5]
                    if not test_files:
                        # Empty zip, extract anyway
                        zf.extractall(output_dir)
                        return
                    
                    all_valid = True
                    garbled_chars = ['µ', 'ê', 'É', 'Θ', 'â', '╜', 'Φ', 'σ', 'ñ', '⌐', 'τ', 'º', 'æ', 'è', 'Ç', 'Ä', 'ª', '▒', 'Å']
                    
                    for test_info in test_files:
                        test_name = test_info.filename
                        # Check for garbled characters
                        if any(char in test_name for char in garbled_chars):
                            all_valid = False
                            break
                        # Check if contains valid CJK characters (indicates correct encoding)
                        has_cjk = any(
                            '\u4e00' <= c <= '\u9fff' or  # Chinese
                            '\u3040' <= c <= '\u309f' or  # Hiragana
                            '\u30a0' <= c <= '\u30ff' or  # Katakana
                            '\uac00' <= c <= '\ud7a3'     # Korean
                            for c in test_name[:50]
                        )
                        # If no CJK but has garbled indicators, probably wrong encoding
                        if not has_cjk and any(char in test_name for char in ['?', '\ufffd']):
                            all_valid = False
                            break
                    
                    if all_valid:
                        # This encoding works, extract all files
                        try:
                            zf.extractall(output_dir)
                            return  # Success!
                        except (OSError, IOError) as e:
                            # extractall failed (maybe filesystem issue), fall through to manual extraction
                            last_error = e
                            break  # Break out of encoding loop, use manual extraction
            except (UnicodeDecodeError, UnicodeEncodeError, LookupError) as e:
                last_error = e
                continue
    
    # Fallback: manual extraction with automatic encoding detection
    # Get raw bytes and try each encoding
    with zipfile.ZipFile(archive_path, "r") as zf:
        for member_info in zf.infolist():
            member_name = member_info.filename
            raw_bytes = None
            safe_name = None
            
            # Method 1: Try to get raw filename bytes from zip file structure (most reliable)
            try:
                raw_bytes = get_raw_filename_bytes(zf, member_info)
                if raw_bytes:
                    # Try each encoding to decode raw bytes
                    for encoding in encodings:
                        try:
                            decoded = raw_bytes.decode(encoding)
                            # Validate: check if decoded name looks reasonable
                            garbled_chars = ['µ', 'ê', 'É', 'Θ', 'â', '╜', 'Φ', 'σ', 'ñ', '⌐', 'τ', 'º', 'æ', 'è', 'Ç', 'Ä', 'ª', '▒', 'Å']
                            if decoded and '?' not in decoded[:20] and '\ufffd' not in decoded[:20]:
                                # Check if contains valid CJK characters
                                has_cjk = any(
                                    '\u4e00' <= c <= '\u9fff' or  # Chinese
                                    '\u3040' <= c <= '\u309f' or  # Hiragana
                                    '\u30a0' <= c <= '\u30ff' or  # Katakana
                                    '\uac00' <= c <= '\ud7a3'     # Korean
                                    for c in decoded[:50]
                                )
                                # If it has CJK characters and no obvious errors, use it
                                if has_cjk or (not any(char in decoded for char in garbled_chars)):
                                    safe_name = decoded
                                    break
                        except (UnicodeDecodeError, UnicodeEncodeError, LookupError):
                            continue
            except Exception:
                # get_raw_filename_bytes failed, try recovery from garbled name
                pass
            
            # Method 2: If raw bytes method failed, try to recover from garbled name
            if not safe_name:
                # The member_name is likely garbled (CP437 decoded UTF-8/GBK/etc)
                # Try encoding back to CP437 to get original bytes, then decode with different encodings
                for encoding in encodings:
                    try:
                        # Try CP437 first (zipfile default)
                        recovered_bytes = member_name.encode('cp437', errors='strict')
                        safe_name = recovered_bytes.decode(encoding, errors='strict')
                        # Validate
                        garbled_chars = ['µ', 'ê', 'É', 'Θ', 'â', '╜', 'Φ', 'σ', 'ñ', '⌐', 'τ', 'º', 'æ', 'è', 'Ç', 'Ä', 'ª', '▒', 'Å']
                        if safe_name and '?' not in safe_name[:20] and not any(char in safe_name for char in garbled_chars):
                            break
                        safe_name = None  # Reset if validation failed
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        continue
                
                # If CP437 encoding failed (member_name contains non-CP437 characters), try latin1
                if not safe_name:
                    for encoding in encodings:
                        try:
                            recovered_bytes = member_name.encode('latin1', errors='strict')
                            safe_name = recovered_bytes.decode(encoding, errors='strict')
                            garbled_chars = ['µ', 'ê', 'É', 'Θ', 'â', '╜', 'Φ', 'σ', 'ñ', '⌐', 'τ', 'º', 'æ', 'è', 'Ç', 'Ä', 'ª', '▒', 'Å']
                            if safe_name and '?' not in safe_name[:20] and not any(char in safe_name for char in garbled_chars):
                                break
                            safe_name = None
                        except (UnicodeEncodeError, UnicodeDecodeError):
                            continue
                
                # If still no success, use original (may be garbled)
                if not safe_name:
                    safe_name = member_name
            
            # Extract to safe path
            # Handle potential filesystem encoding issues
            try:
                target_path = output_dir / safe_name
            except (UnicodeEncodeError, ValueError):
                # If path creation fails, use a safe fallback
                import hashlib
                safe_hash = hashlib.md5(safe_name.encode('utf-8', errors='replace')).hexdigest()[:8]
                target_path = output_dir / f"file_{safe_hash}"
            
            if member_info.is_dir():
                target_path.mkdir(parents=True, exist_ok=True)
            else:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member_info) as source, target_path.open('wb') as target:
                    target.write(source.read())


def extract_archive(archive_path: Path, extract: bool) -> Optional[str]:
    """Extract archive file if extract is True and file is a supported archive format.
    
    Supports multiple languages for zip files (Chinese, Japanese, Korean, etc.)
    """
    if not extract:
        return None
    
    suffix = archive_path.suffix.lower()
    output_dir = archive_path.with_suffix("")
    
    try:
        if suffix == ".zip":
            extract_zip_with_encoding(archive_path, output_dir)
            return str(output_dir)
        elif suffix == ".rar":
            if not HAS_RAR:
                raise HTTPException(status_code=400, detail="RAR support requires 'rarfile' package")
            with rarfile.RarFile(archive_path, "r") as rf:
                rf.extractall(output_dir)
            return str(output_dir)
        elif suffix == ".7z":
            if not HAS_7Z:
                raise HTTPException(status_code=400, detail="7z support requires 'py7zr' package")
            with py7zr.SevenZipFile(archive_path, mode='r') as z:
                z.extractall(output_dir)
            return str(output_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract {suffix}: {exc}") from exc
    
    return None


@router.post("")
async def upload_files(
    request: Request,
    files: List[UploadFile] = File(..., alias="files"),
    extract: bool = Form(True),
    job_id: Optional[str] = Form(None),
    session_id: Optional[str] = Cookie(None),
) -> dict:
    """Upload multiple files. Supports images and archive files (zip, rar, 7z).
    
    Creates or uses an existing job to store uploaded files.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    # Register user session
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    session_id = user_tracker.register_session(session_id, ip=client_ip, user_agent=user_agent)
    
    # Check concurrent user limit
    if user_tracker.is_at_capacity():
        raise HTTPException(
            status_code=503,
            detail=f"Server at capacity. Maximum {user_tracker.get_max_concurrent()} concurrent users."
        )
    
    # Get or create job
    if job_id:
        try:
            job = JobStore.load(job_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    else:
        # Create new job with default PPT filename
        default_filename = get_default_ppt_filename()
        if not default_filename.endswith('.pptx'):
            default_filename = f"{default_filename}.pptx"
        job = JobStore.create_job(filename=default_filename)
        job_id = job.id
    
    # Use job directory for uploads
    job_dir = JobStore.job_dir(job_id)
    uploads_dir = job_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    base = uploads_dir
    
    uploaded_files = []
    extracted_dirs = []
    errors = []
    
    for file in files:
        file_size_mb = 0
        dest = None
        try:
            # Check file size (warn if very large)
            if hasattr(file, 'size') and file.size:
                file_size_mb = file.size / (1024 * 1024)
                if file_size_mb > 500:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File '{file.filename}' is too large ({file_size_mb:.2f} MB). Maximum size is 500 MB."
                    )
            
            # Create unique filename if file already exists
            dest = base / file.filename
            counter = 1
            while dest.exists():
                stem = dest.stem
                suffix = dest.suffix
                dest = base / f"{stem}_{counter}{suffix}"
                counter += 1
            
            # Save file
            bytes_written = 0
            with dest.open("wb") as fh:
                while True:
                    chunk = await file.read(1 << 20)  # 1MB chunks
                    if not chunk:
                        break
                    fh.write(chunk)
                    bytes_written += len(chunk)
            
            uploaded_files.append({
                "filename": file.filename,
                "path": str(dest),
                "size": bytes_written,
            })
            
            # Extract if it's an archive
            extracted_dir = extract_archive(dest, extract)
            if extracted_dir:
                extracted_dirs.append(extracted_dir)
                uploaded_files[-1]["extracted_dir"] = extracted_dir
            
        except HTTPException:
            raise
        except OSError as exc:
            if dest:
                dest.unlink(missing_ok=True)
            error_msg = f"Failed to save file '{file.filename}'"
            if "No space left" in str(exc):
                error_msg += ": No space left on device"
            elif "Permission denied" in str(exc):
                error_msg += ": Permission denied"
            else:
                error_msg += f": {exc}"
            errors.append(error_msg)
        except Exception as exc:
            if dest:
                dest.unlink(missing_ok=True)
            error_msg = f"Failed to process file '{file.filename}': {str(exc)}"
            errors.append(error_msg)
    
    if errors and not uploaded_files:
        # If all files failed, return error
        raise HTTPException(
            status_code=500,
            detail="; ".join(errors)
        )
    elif errors:
        # If some files failed, include errors in response
        return {
            "files": uploaded_files,
            "count": len(uploaded_files),
            "extracted_dirs": extracted_dirs,
            "errors": errors,
            "warning": f"Some files failed to upload: {'; '.join(errors)}"
        }
    
    # Update job with directory info
    extracted_dir = extracted_dirs[0] if extracted_dirs else None
    analyze_dir = extracted_dir or str(uploads_dir)
    
    JobStore.update(
        job_id,
        directory=analyze_dir,
        status=JobStatus.UPLOADED,
    )
    
    return {
        "job_id": job_id,
        "session_id": session_id,
        "files": uploaded_files,
        "count": len(uploaded_files),
        "extracted_dirs": extracted_dirs,
    }


