from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ..units import build_unit_registry


class EQMPlugin(ABC):
    id: str
    version: str = "1.0.0"

    @abstractmethod
    def required_params_schema(self) -> dict[str, Any]:
        pass

    @abstractmethod
    def applicability(self, activity: ActivityRecord, activity_def: ActivityTypeDefinition) -> bool:
        pass

    @abstractmethod
    def compute(
        self,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
        *,
        resolved: ResolvedActivity | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        pass


def default_ureg():
    return build_unit_registry()
