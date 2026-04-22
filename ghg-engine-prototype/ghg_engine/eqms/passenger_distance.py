from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from .base import EQMPlugin
from .direct_factor import DirectFactorMethod


class PassengerDistanceMethod(EQMPlugin):
    id = "passenger_distance"
    version = "1.0.0"

    def __init__(self) -> None:
        self._direct = DirectFactorMethod()

    def required_params_schema(self) -> dict[str, object]:
        return {"type": "object", "properties": {}, "required": []}

    def applicability(self, activity: ActivityRecord, activity_def: ActivityTypeDefinition) -> bool:
        del activity
        return activity_def.method_id == self.id

    def compute(
        self,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
        *,
        resolved: ResolvedActivity | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        return self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups=self._direct._group_templates(activity_def),
            selected_method=self.id,
            result_method_id=self.id,
            resolved=resolved,
        )
