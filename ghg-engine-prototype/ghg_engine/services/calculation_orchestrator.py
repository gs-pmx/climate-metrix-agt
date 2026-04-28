from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.adapters import LegacyCalculationAdapter
from ghg_engine.domain import ResolvedActivity
from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ghg_engine.services.locus_resolver import LocusResolver

if TYPE_CHECKING:
    from ghg_engine.eqms.base import EQMContext


class CalculationOrchestrator:
    def __init__(
        self,
        activity_catalog: ActivityCatalog,
        factors,
        plugins,
        *,
        legacy_adapter: LegacyCalculationAdapter | None = None,
        locus_resolver: LocusResolver | None = None,
        eqm_context_builder: Callable[[ResolvedActivity], "EQMContext | None"] | None = None,
    ):
        self.activity_catalog = activity_catalog
        self.factors = factors
        self.plugins = plugins
        self.legacy_adapter = legacy_adapter or LegacyCalculationAdapter()
        self.locus_resolver = locus_resolver or LocusResolver()
        # Hook for callers (e.g. the API surface) that need to compose a
        # per-activity EQMContext — most plugins ignore the argument; the
        # spend-based plugin uses it to thread GL mappings + FX/inflation
        # providers through.
        self.eqm_context_builder = eqm_context_builder

    def calculate_legacy(
        self,
        activity: ActivityRecord,
        ctx: CalculationContext,
        *,
        eqm_context_builder: Callable[[ResolvedActivity], "EQMContext | None"] | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        resolved = self.legacy_adapter.resolve(activity, ctx)
        return self.calculate_resolved(resolved, eqm_context_builder=eqm_context_builder)

    def calculate_resolved(
        self,
        resolved: ResolvedActivity,
        *,
        eqm_context_builder: Callable[[ResolvedActivity], "EQMContext | None"] | None = None,
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
        builder = eqm_context_builder or self.eqm_context_builder
        eqm_context = builder(resolved) if builder else None
        return plugin.compute(resolved, activity_def, self.factors, eqm_context=eqm_context)
