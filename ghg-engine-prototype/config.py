from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Field(default=_BASE_DIR / "data")
    db_path: Path = Field(default=_BASE_DIR / "state" / "ghg_projects.sqlite")
    frontend_dist_dir: Path = Field(default=_BASE_DIR / "frontend" / "dist")
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    log_level: str = "INFO"
    factor_backend: str = Field(default="document", description="Factor repository backend: 'csv' or 'document'.")


def get_settings() -> Settings:
    return Settings()
