from __future__ import annotations

from datetime import date

from ghg_engine.domain import ResolvedActivity
from ghg_engine.models import GeoContext


def inventory_year(resolved: ResolvedActivity) -> int | None:
    return resolved.policy.inventory_year


def inventory_period(resolved: ResolvedActivity) -> tuple[date | None, date | None]:
    if resolved.policy.inventory_period is not None:
        return (
            resolved.policy.inventory_period.start.date(),
            resolved.policy.inventory_period.end.date(),
        )
    return None, None


def gwp_set(resolved: ResolvedActivity) -> str:
    return resolved.policy.gwp_set


def geo_context(resolved: ResolvedActivity) -> GeoContext:
    return GeoContext(
        region=resolved.locus.geography.region,
        country=resolved.locus.geography.country,
        state=resolved.locus.geography.state,
        egrid_subregion=resolved.locus.geography.grid_region,
    )
