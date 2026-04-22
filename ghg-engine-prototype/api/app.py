from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from api.routers import calculation, catalog, projects
from config import get_settings

_SPA_EXCLUDED_PATHS = {"api", "docs", "redoc", "openapi.json", "healthz"}
_SPA_EXCLUDED_PREFIXES = ("api/",)


def _configure_api_routes(app: FastAPI) -> None:
    api_router = APIRouter(prefix="/api")
    for router in (calculation.router, projects.router, catalog.router):
        api_router.include_router(router)
    app.include_router(api_router)
    for router in (calculation.router, projects.router, catalog.router):
        app.include_router(router, include_in_schema=False)


def _configure_frontend_routes(app: FastAPI, frontend_dist_dir: Path) -> None:
    frontend_dist_dir = frontend_dist_dir.resolve()
    index_file = frontend_dist_dir / "index.html"
    if not index_file.is_file():
        return

    def _frontend_response(path_fragment: str | None = None) -> FileResponse:
        if path_fragment:
            normalized = path_fragment.strip("/")
            if normalized in _SPA_EXCLUDED_PATHS or any(
                normalized.startswith(prefix) for prefix in _SPA_EXCLUDED_PREFIXES
            ):
                raise HTTPException(status_code=404, detail="Not Found")
            candidate = (frontend_dist_dir / normalized).resolve()
            try:
                candidate.relative_to(frontend_dist_dir)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Not Found") from exc
            if candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(index_file)

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_root() -> FileResponse:
        return _frontend_response()

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_entry(full_path: str) -> FileResponse:
        return _frontend_response(full_path)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="GHG Prototype API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _configure_api_routes(app)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    _configure_frontend_routes(app, settings.frontend_dist_dir)

    return app
