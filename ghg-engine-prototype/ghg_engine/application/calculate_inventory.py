from __future__ import annotations

from collections import defaultdict

from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ghg_engine.services import CalculationOrchestrator


class CalculateInventoryUseCase:
    def __init__(self, orchestrator: CalculationOrchestrator):
        self.orchestrator = orchestrator

    def calculate_one(
        self,
        activity: ActivityRecord,
        ctx: CalculationContext,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        return self.orchestrator.calculate_legacy(activity, ctx)

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
