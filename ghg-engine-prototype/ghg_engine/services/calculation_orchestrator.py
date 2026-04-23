from __future__ import annotations

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.adapters import LegacyCalculationAdapter
from ghg_engine.domain import ResolvedActivity
from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ghg_engine.services.locus_resolver import LocusResolver


class CalculationOrchestrator:
    def __init__(
        self,
        activity_catalog: ActivityCatalog,
        factors,
        plugins,
        *,
        legacy_adapter: LegacyCalculationAdapter | None = None,
        locus_resolver: LocusResolver | None = None,
    ):
        self.activity_catalog = activity_catalog
        self.factors = factors
        self.plugins = plugins
        self.legacy_adapter = legacy_adapter or LegacyCalculationAdapter()
        self.locus_resolver = locus_resolver or LocusResolver()

    def calculate_legacy(
        self,
        activity: ActivityRecord,
        ctx: CalculationContext,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        resolved = self.legacy_adapter.resolve(activity, ctx)
        return self.calculate_resolved(resolved)

    def calculate_resolved(
        self,
        resolved: ResolvedActivity,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        observation = resolved.observation
        activity_def = self.activity_catalog.get_required(observation.activity_type_id)
        resolved_locus = self.locus_resolver.resolve(observation, resolved.locus)
        resolved = resolved.model_copy(update={"locus": resolved_locus})
        self.activity_catalog.validate_activity(activity_def, resolved.observation)
        plugin = self.plugins.get(activity_def.method_id)
        if plugin is None:
            raise KeyError(f"No plugin registered for method_id={activity_def.method_id}")
        if not plugin.applicability(resolved, activity_def):
            raise ValueError(f"method {activity_def.method_id} is not applicable to provided activity")
        return plugin.compute(resolved, activity_def, self.factors)
