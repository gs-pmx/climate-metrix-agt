from __future__ import annotations

from datetime import date

from ghg_engine.domain import ResolvedActivity
from ghg_engine.models import CalculationContext, GeoContext


def inventory_year(ctx: CalculationContext, resolved: ResolvedActivity | None) -> int | None:
    if resolved is not None:
        return resolved.policy.inventory_year
    return ctx.inventory_year


def inventory_period(
    ctx: CalculationContext,
    resolved: ResolvedActivity | None,
) -> tuple[date | None, date | None]:
    if resolved is not None and resolved.policy.inventory_period is not None:
        return (
            resolved.policy.inventory_period.start.date(),
            resolved.policy.inventory_period.end.date(),
        )
    if ctx.inventory_period is not None:
        return ctx.inventory_period.start.date(), ctx.inventory_period.end.date()
    return None, None


def gwp_set(ctx: CalculationContext, resolved: ResolvedActivity | None) -> str:
    if resolved is not None:
        return resolved.policy.gwp_set
    return ctx.gwp_set


def geo_context(ctx: CalculationContext, resolved: ResolvedActivity | None) -> GeoContext:
    if resolved is not None:
        return GeoContext(
            region=resolved.locus.geography.region,
            country=resolved.locus.geography.country,
            state=resolved.locus.geography.state,
            egrid_subregion=resolved.locus.geography.grid_region,
        )
    return GeoContext(
        region=ctx.source_attributes.get("region"),
        country=ctx.source_attributes.get("country"),
        state=ctx.source_attributes.get("state"),
        egrid_subregion=ctx.source_attributes.get("egrid_subregion"),
    )
