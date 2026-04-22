from __future__ import annotations

from datetime import timedelta
from hashlib import sha1

from ghg_engine.domain import (
    ActivityObservation,
    Geography,
    InventoryPeriod,
    InventoryPolicy,
    OperationalLocus,
    Quantity,
    ResolvedActivity,
)
from ghg_engine.models import ActivityRecord, CalculationContext


class LegacyCalculationAdapter:
    """Bridge legacy transport models onto the new domain boundary."""

    def resolve(self, activity: ActivityRecord, ctx: CalculationContext) -> ResolvedActivity:
        observation = self._observation(activity)
        return ResolvedActivity(
            observation=observation,
            locus=self._locus(activity, ctx),
            policy=self._policy(ctx),
        )

    def to_plugin_inputs(self, resolved: ResolvedActivity) -> tuple[ActivityRecord, CalculationContext]:
        observation = resolved.observation
        activity = ActivityRecord(
            facility_id=observation.locus_id,
            activity_type_id=observation.activity_type_id,
            activity={"value": observation.quantity.value, "unit": observation.quantity.unit},
            params=observation.params,
            period_start=observation.period.start if observation.period else None,
            period_end=observation.period.end if observation.period else None,
            timestamp=observation.timestamp,
            duration=(
                timedelta(seconds=observation.duration_seconds)
                if observation.duration_seconds is not None
                else None
            ),
        )
        policy = resolved.policy
        ctx = CalculationContext(
            inventory_year=policy.inventory_year,
            inventory_period=(
                {
                    "start": policy.inventory_period.start,
                    "end": policy.inventory_period.end,
                }
                if policy.inventory_period
                else None
            ),
            gwp_set=policy.gwp_set,
            include_trace=policy.include_trace,
            source_attributes=self._source_attributes_from_locus(resolved.locus),
        )
        return activity, ctx

    def _observation(self, activity: ActivityRecord) -> ActivityObservation:
        period = None
        if activity.period_start is not None and activity.period_end is not None:
            period = InventoryPeriod(start=activity.period_start, end=activity.period_end)
        payload = (
            f"{activity.facility_id}|{activity.activity_type_id}|{activity.activity.value}|"
            f"{activity.activity.unit}|{activity.period_start}|{activity.period_end}|"
            f"{activity.timestamp}|{activity.duration}"
        )
        return ActivityObservation(
            activity_id=f"legacy_{sha1(payload.encode('utf-8')).hexdigest()[:12]}",
            locus_id=activity.facility_id,
            activity_type_id=activity.activity_type_id,
            quantity=Quantity(value=activity.activity.value, unit=activity.activity.unit),
            params=dict(activity.params),
            period=period,
            timestamp=activity.timestamp,
            duration_seconds=(
                activity.duration.total_seconds() if activity.duration is not None else None
            ),
            source_kind="manual",
        )

    def _policy(self, ctx: CalculationContext) -> InventoryPolicy:
        period = None
        if ctx.inventory_period is not None:
            period = InventoryPeriod(
                start=ctx.inventory_period.start,
                end=ctx.inventory_period.end,
            )
        return InventoryPolicy(
            inventory_year=ctx.inventory_year,
            inventory_period=period,
            gwp_set=ctx.gwp_set,
            include_trace=ctx.include_trace,
        )

    def _locus(self, activity: ActivityRecord, ctx: CalculationContext) -> OperationalLocus:
        source_attributes = dict(ctx.source_attributes)
        extra_attributes = {
            key: value
            for key, value in source_attributes.items()
            if key not in {"region", "country", "state", "egrid_subregion", "reporting_group", "owned_leased"}
        }
        return OperationalLocus(
            locus_id=activity.facility_id,
            kind="facility",
            name=activity.facility_id,
            geography=Geography(
                region=source_attributes.get("region"),
                country=source_attributes.get("country"),
                state=source_attributes.get("state"),
                grid_region=source_attributes.get("egrid_subregion"),
            ),
            ownership_mode=source_attributes.get("owned_leased"),
            reporting_group=source_attributes.get("reporting_group"),
            attributes=extra_attributes,
        )

    def _source_attributes_from_locus(self, locus: OperationalLocus) -> dict[str, str]:
        source_attributes: dict[str, str] = {}
        if locus.geography.region:
            source_attributes["region"] = locus.geography.region
        if locus.geography.country:
            source_attributes["country"] = locus.geography.country
        if locus.geography.state:
            source_attributes["state"] = locus.geography.state
        if locus.geography.grid_region:
            source_attributes["egrid_subregion"] = locus.geography.grid_region
        if locus.reporting_group:
            source_attributes["reporting_group"] = locus.reporting_group
        if locus.ownership_mode:
            source_attributes["owned_leased"] = locus.ownership_mode
        for key, value in locus.attributes.items():
            if isinstance(value, str):
                source_attributes[key] = value
        return source_attributes
