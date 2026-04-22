from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition, FactorQueryTemplate
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from .base import EQMPlugin
from .direct_factor import DirectFactorMethod

DISPOSAL_TEMPLATE_MAP = {
    "landfill_no_recovery": FactorQueryTemplate(
        domain="waste-decomposition",
        type="landfill",
        attributes=["ch4-ef"],
        description="landfill-no-ch4-recovery",
        life_cycle_stage="downstream",
    ),
    "landfill_flaring": FactorQueryTemplate(
        domain="waste-decomposition",
        type="landfill",
        attributes=["ch4-ef"],
        description="landfill-ch4-recovery-flaring",
        life_cycle_stage="downstream",
    ),
    "landfill_electricity_recovery": FactorQueryTemplate(
        domain="waste-decomposition",
        type="landfill",
        attributes=["ch4-ef"],
        description="landfill-ch4-recovery-electricity-gen",
        life_cycle_stage="downstream",
    ),
    "incineration": FactorQueryTemplate(
        domain="waste-decomposition",
        type="incineration",
        attributes=["co2e-ef"],
        description="incineration",
        life_cycle_stage="downstream",
    ),
}


class WasteMassMethod(EQMPlugin):
    id = "waste_mass"
    version = "1.0.0"

    def __init__(self) -> None:
        self._direct = DirectFactorMethod()

    def required_params_schema(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "disposal_method": {
                    "type": "string",
                    "enum": sorted(DISPOSAL_TEMPLATE_MAP),
                }
            },
            "required": ["disposal_method"],
        }

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
        disposal_method = str(activity.params.get("disposal_method") or "")
        template = DISPOSAL_TEMPLATE_MAP.get(disposal_method)
        if template is None:
            raise ValueError(
                "waste_mass requires params.disposal_method to be one of "
                f"{sorted(DISPOSAL_TEMPLATE_MAP)}"
            )
        return self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups={"none": [template]},
            selected_method=self.id,
            result_method_id=self.id,
        )
