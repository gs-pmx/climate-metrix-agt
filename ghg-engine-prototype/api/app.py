from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import calculation, catalog, projects
from config import get_settings


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

    app.include_router(calculation.router)
    app.include_router(projects.router)
    app.include_router(catalog.router)

    return app
