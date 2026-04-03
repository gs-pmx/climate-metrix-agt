from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, RoutingRow, TraceRecord
from ..units import build_unit_registry


class EQMPlugin(ABC):
    id: str
    version: str = "1.0.0"

    @abstractmethod
    def required_params_schema(self) -> dict[str, Any]:
        pass

    @abstractmethod
    def applicability(self, activity: ActivityRecord, routing: RoutingRow) -> bool:
        pass

    @abstractmethod
    def compute(
        self,
        activity: ActivityRecord,
        routing: RoutingRow,
        ctx: CalculationContext,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        pass


def default_ureg():
    return build_unit_registry()
