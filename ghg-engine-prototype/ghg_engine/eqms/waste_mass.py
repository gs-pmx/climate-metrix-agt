from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition, FactorQueryTemplate
from ..domain import ResolvedActivity
from ..factors import FactorRepository
from ..models import ResultRecord, TraceRecord
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

    def applicability(self, resolved: ResolvedActivity, activity_def: ActivityTypeDefinition) -> bool:
        del resolved
        return activity_def.method_id == self.id

    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        disposal_method = str(resolved.observation.params.get("disposal_method") or "")
        template = DISPOSAL_TEMPLATE_MAP.get(disposal_method)
        if template is None:
            raise ValueError(
                "waste_mass requires params.disposal_method to be one of "
                f"{sorted(DISPOSAL_TEMPLATE_MAP)}"
            )
        return self._direct.compute_from_template_groups(
            resolved=resolved,
            activity_def=activity_def,
            factors=factors,
            template_groups={"none": [template]},
            selected_method=self.id,
            result_method_id=self.id,
        )
