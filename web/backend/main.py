from __future__ import annotations

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from .routes import upload, analyze, generate
from .api import jobs
from .settings import get_root_path
from .services.job_cleanup import cleanup_service


# Note: For large file uploads, Starlette/FastAPI handles streaming automatically
# The main limitation is usually memory. For very large files (>500MB), 
# consider using nginx as reverse proxy with client_max_body_size configuration


def create_app() -> FastAPI:
    app = FastAPI(title="i2pptt API", version="0.1.0", root_path=get_root_path())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(upload.router, prefix="/api")
    app.include_router(analyze.router, prefix="/api")
    app.include_router(generate.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    
    # Start job cleanup service
    cleanup_service.start()

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handle validation errors with more detailed messages."""
        errors = []
        for error in exc.errors():
            field = " -> ".join(str(loc) for loc in error.get("loc", []))
            msg = error.get("msg", "Validation error")
            errors.append(f"{field}: {msg}")
        
        return JSONResponse(
            status_code=422,
            content={
                "detail": "; ".join(errors) if errors else "Validation error",
                "errors": exc.errors()
            }
        )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


