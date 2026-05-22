import logging
from pathlib import Path
from time import sleep

from fastapi import Request
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.database import init_db
from app.services.auth import bearer_token, user_from_token
from app.services.scheduler import start_scheduler, stop_scheduler

configure_logging()
settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, version="0.1.0")
@app.middleware("http")
async def authenticate_api(request: Request, call_next):
    if request.method == "OPTIONS" or not request.url.path.startswith(settings.api_prefix):
        return await call_next(request)
    public_paths = {f"{settings.api_prefix}/health", f"{settings.api_prefix}/auth/login"}
    if request.url.path in public_paths:
        return await call_next(request)
    token = bearer_token(request)
    user = user_from_token(token) if token else None
    if user is None:
        return JSONResponse({"detail": "Authentication required"}, status_code=401)
    request.state.user = user
    return await call_next(request)


if settings.force_https:
    app.add_middleware(HTTPSRedirectMiddleware)
if settings.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix=settings.api_prefix)

frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str):
    index = frontend_dist / "index.html"
    if index.exists() and not path.startswith("api"):
        return FileResponse(index)
    return {"message": "Frontend build not found. Run `npm run build` in frontend."}


def _init_db_with_retry(attempts: int = 12, delay_seconds: int = 5) -> None:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            init_db()
            return
        except Exception as exc:
            last_error = exc
            if attempt == attempts:
                break
            logger.warning(
                "Metadata database unavailable during startup (attempt %s/%s): %s",
                attempt,
                attempts,
                exc,
            )
            sleep(delay_seconds)
    raise RuntimeError("Metadata database unavailable after startup retries") from last_error


@app.on_event("startup")
def startup() -> None:
    _init_db_with_retry()
    start_scheduler()


@app.on_event("shutdown")
def shutdown() -> None:
    stop_scheduler()
