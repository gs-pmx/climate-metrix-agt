from __future__ import annotations

from functools import lru_cache

from config import Settings, get_settings
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.routing import RoutingCatalog
from project_store import ProjectStore


@lru_cache(maxsize=1)
def _build(settings: Settings | None = None) -> tuple[RoutingCatalog, FactorRepository, GHGEngine, ProjectStore]:
    if settings is None:
        settings = get_settings()
    routing = RoutingCatalog.from_csv(str(settings.data_dir / "routing.csv"))
    factors = FactorRepository.from_csv(str(settings.data_dir / "factors.csv"))
    engine = GHGEngine(routing, factors)
    store = ProjectStore(settings.db_path)
    return routing, factors, engine, store


def get_routing() -> RoutingCatalog:
    return _build()[0]


def get_factors() -> FactorRepository:
    return _build()[1]


def get_engine() -> GHGEngine:
    return _build()[2]


def get_project_store() -> ProjectStore:
    return _build()[3]
