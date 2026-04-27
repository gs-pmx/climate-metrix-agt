from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..factors import FactorRepository
from ..models import ResultRecord, TraceRecord
from .base import EQMPlugin
from .direct_factor import DirectFactorMethod


class FreightTonMileMethod(EQMPlugin):
    id = "freight_ton_mile"
    version = "1.0.0"

    def __init__(self) -> None:
        self._direct = DirectFactorMethod()

    def required_params_schema(self) -> dict[str, object]:
        return {"type": "object", "properties": {}, "required": []}

    def applicability(self, resolved: ResolvedActivity, activity_def: ActivityTypeDefinition) -> bool:
        del resolved
        return activity_def.method_id == self.id

    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
        *,
        eqm_context=None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        del eqm_context
        return self._direct.compute_from_template_groups(
            resolved=resolved,
            activity_def=activity_def,
            factors=factors,
            template_groups=self._direct._group_templates(activity_def),
            selected_method=self.id,
            result_method_id=self.id,
        )
