from __future__ import annotations

from collections import defaultdict

from .eqms.registry import default_plugin_registry
from .factors import FactorRepository
from .models import ActivityRecord, CalculationContext, MethodSchema, ResultRecord, TraceRecord
from .routing import RoutingCatalog


class GHGEngine:
    def __init__(self, routing: RoutingCatalog, factors: FactorRepository):
        self.routing = routing
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
        routing = self.routing.resolve(activity)
        plugin = self.plugins.get(routing.method_id)
        if plugin is None:
            raise KeyError(f"No plugin registered for method_id={routing.method_id}")
        if not plugin.applicability(activity, routing):
            raise ValueError(f"method {routing.method_id} is not applicable to provided activity")
        return plugin.compute(activity, routing, ctx, self.factors)

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
            k = f"{row.facility_id}|{row.scope}|{row.accounting_method}|{row.gas}|{row.unit}"
            summary[k] += row.value
        return all_rows, dict(summary), traces
