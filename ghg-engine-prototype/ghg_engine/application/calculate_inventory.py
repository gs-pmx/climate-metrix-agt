from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Callable

from ghg_engine.domain import ResolvedActivity
from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ghg_engine.services import CalculationOrchestrator

if TYPE_CHECKING:
    from ghg_engine.eqms.base import EQMContext


class CalculateInventoryUseCase:
    def __init__(self, orchestrator: CalculationOrchestrator):
        self.orchestrator = orchestrator

    def calculate_one(
        self,
        activity: ActivityRecord,
        ctx: CalculationContext,
        *,
        eqm_context_builder: Callable[[ResolvedActivity], "EQMContext | None"] | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        return self.orchestrator.calculate_legacy(
            activity, ctx, eqm_context_builder=eqm_context_builder
        )

    def calculate(
        self,
        activities: list[ActivityRecord],
        ctx: CalculationContext,
        *,
        eqm_context_builder: Callable[[ResolvedActivity], "EQMContext | None"] | None = None,
    ) -> tuple[list[ResultRecord], dict[str, float], list[TraceRecord]]:
        all_rows: list[ResultRecord] = []
        traces: list[TraceRecord] = []
        for activity in activities:
            rows, trace = self.calculate_one(activity, ctx, eqm_context_builder=eqm_context_builder)
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
