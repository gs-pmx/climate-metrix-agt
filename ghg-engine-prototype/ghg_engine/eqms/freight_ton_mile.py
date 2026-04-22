from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from .base import EQMPlugin
from .direct_factor import DirectFactorMethod


class FreightTonMileMethod(EQMPlugin):
    id = "freight_ton_mile"
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
    ) -> tuple[list[ResultRecord], TraceRecord]:
        return self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups=self._direct._group_templates(activity_def),
            selected_method=self.id,
            result_method_id=self.id,
        )
