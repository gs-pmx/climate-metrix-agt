from __future__ import annotations

from .activity_catalog import ActivityCatalog
from .application import CalculateInventoryUseCase
from .eqms.registry import default_plugin_registry
from .factors import FactorRepository
from .services import CalculationOrchestrator
from .models import ActivityRecord, CalculationContext, MethodSchema, ResultRecord, TraceRecord


class GHGEngine:
    def __init__(self, activity_catalog: ActivityCatalog, factors: FactorRepository):
        self.activity_catalog = activity_catalog
        self.factors = factors
        self.plugins = default_plugin_registry()
        self._orchestrator = CalculationOrchestrator(
            activity_catalog=self.activity_catalog,
            factors=self.factors,
            plugins=self.plugins,
        )
        self._calculate_inventory = CalculateInventoryUseCase(self._orchestrator)

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
        return self._calculate_inventory.calculate_one(activity, ctx)

    def calculate(
        self,
        activities: list[ActivityRecord],
        ctx: CalculationContext,
    ) -> tuple[list[ResultRecord], dict[str, float], list[TraceRecord]]:
        return self._calculate_inventory.calculate(activities, ctx)
