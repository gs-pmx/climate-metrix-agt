from __future__ import annotations

from collections import defaultdict

from .activity_catalog import ActivityCatalog
from .eqms.registry import default_plugin_registry
from .factors import FactorRepository
from .models import ActivityRecord, CalculationContext, MethodSchema, ResultRecord, TraceRecord


class GHGEngine:
    def __init__(self, activity_catalog: ActivityCatalog, factors: FactorRepository):
        self.activity_catalog = activity_catalog
        self.factors = factors
        self.plugins = default_plugin_registry()

    def method_schema(self, method_id: str) -> MethodSchema:
        plugin = self.plugins.get(method_id)
        if plugin is None:
            raise KeyError(f"unknown method_id {method_id}")
        return MethodSchema(
            method_id=plugin.id,
            version=plugin.version,
            required_params=plugin.required_params_schema(),
        )

    def calculate_one(
        self,
        activity: ActivityRecord,
        ctx: CalculationContext,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        activity_def = self.activity_catalog.get_required(activity.activity_type_id)
        self.activity_catalog.validate_activity(activity_def, activity)
        plugin = self.plugins.get(activity_def.method_id)
        if plugin is None:
            raise KeyError(f"No plugin registered for method_id={activity_def.method_id}")
        if not plugin.applicability(activity, activity_def):
            raise ValueError(f"method {activity_def.method_id} is not applicable to provided activity")
        return plugin.compute(activity, activity_def, ctx, self.factors)

    def calculate(
        self,
        activities: list[ActivityRecord],
        ctx: CalculationContext,
    ) -> tuple[list[ResultRecord], dict[str, float], list[TraceRecord]]:
        all_rows: list[ResultRecord] = []
        traces: list[TraceRecord] = []
        for activity in activities:
            rows, trace = self.calculate_one(activity, ctx)
            all_rows.extend(rows)
            traces.append(trace)
        summary = defaultdict(float)
        for row in all_rows:
            key = (
                f"{row.facility_id}|{row.scope}|{row.accounting_method}|{row.gas}|"
                f"{row.unit}|{'biogenic' if row.is_biogenic else 'non_biogenic'}"
            )
            summary[key] += row.value
        return all_rows, dict(summary), traces
