from __future__ import annotations

import logging
import sqlite3
from functools import lru_cache

from config import Settings, get_settings
from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.infrastructure.sqlite_factors import SQLiteFactorRepository
from project_store import ProjectStore

log = logging.getLogger(__name__)


def _enable_wal_mode(db_path) -> None:
    """Switch the SQLite database into WAL journal mode.

    WAL is a sticky, database-wide setting (persists across opens once
    set), so applying it once at boot is enough. Read paths benefit
    from concurrent readers + a single writer; the cost is one extra
    ``-wal`` and ``-shm`` file alongside the database.
    """
    try:
        conn = sqlite3.connect(db_path)
        try:
            mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()
            log.info("SQLite journal_mode=%s db=%s", mode[0] if mode else "?", db_path)
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:  # pragma: no cover - defensive
        log.warning("Could not enable WAL mode on %s: %s", db_path, exc)


@lru_cache(maxsize=1)
def _build(
    settings: Settings | None = None,
) -> tuple[ActivityCatalog, FactorRepository | SQLiteFactorRepository, GHGEngine, ProjectStore]:
    if settings is None:
        settings = get_settings()
    activity_catalog = ActivityCatalog.from_json(settings.data_dir / "activity_types.json")
    _enable_wal_mode(settings.db_path)
    store = ProjectStore(settings.db_path)

    if settings.factor_backend == "document":
        ef_json = settings.data_dir / "emission_factors.json"
        seeded = store.seed_factors(ef_json)
        if seeded:
            log.info("Seeded %d canonical emission factor rows into SQLite.", seeded)
        factors = store.factor_repository()
        dataset = store.current_factor_dataset()
        log.info(
            "Using canonical SQLite factor repository (%d factors, dataset=%s).",
            factors.count(),
            dataset["dataset_key"] if dataset else "none",
        )
    else:
        factors = FactorRepository.from_csv(str(settings.data_dir / "factors.csv"))
        log.info("Using CSV-based factor repository.")

    engine = GHGEngine(activity_catalog, factors)
    return activity_catalog, factors, engine, store


def get_activity_catalog() -> ActivityCatalog:
    return _build()[0]


def get_factors() -> FactorRepository | SQLiteFactorRepository:
    return _build()[1]


def get_engine() -> GHGEngine:
    return _build()[2]


def get_project_store() -> ProjectStore:
    return _build()[3]
