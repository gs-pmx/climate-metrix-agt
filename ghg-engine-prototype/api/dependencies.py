from __future__ import annotations

import logging
from functools import lru_cache

from config import Settings, get_settings
from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.document_factors import DocumentFactorRepository
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from project_store import ProjectStore

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _build(
    settings: Settings | None = None,
) -> tuple[ActivityCatalog, FactorRepository | DocumentFactorRepository, GHGEngine, ProjectStore]:
    if settings is None:
        settings = get_settings()
    activity_catalog = ActivityCatalog.from_json(settings.data_dir / "activity_types.json")
    store = ProjectStore(settings.db_path)

    if settings.factor_backend == "document":
        ef_json = settings.data_dir / "emission_factors.json"
        seeded = store.seed_factors(ef_json)
        if seeded:
            log.info("Seeded %d emission factor documents into SQLite.", seeded)
        conn = store.factors_connection()
        factors = DocumentFactorRepository.from_sqlite(conn)
        conn.close()
        log.info("Using document-based factor repository (%d factors).", len(factors._docs))
    else:
        factors = FactorRepository.from_csv(str(settings.data_dir / "factors.csv"))
        log.info("Using CSV-based factor repository.")

    engine = GHGEngine(activity_catalog, factors)
    return activity_catalog, factors, engine, store


def get_activity_catalog() -> ActivityCatalog:
    return _build()[0]


def get_factors() -> FactorRepository | DocumentFactorRepository:
    return _build()[1]


def get_engine() -> GHGEngine:
    return _build()[2]


def get_project_store() -> ProjectStore:
    return _build()[3]
