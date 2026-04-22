from __future__ import annotations

from ..activity_catalog import ActivityTypeDefinition
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, Quantity, ResultRecord, TraceRecord
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg
from .direct_factor import DirectFactorMethod

FUEL_FACTOR_DEFAULTS = {
    "gasoline": "motor-gasoline-default",
    "diesel": "motor-diesel-default",
}


class DistancePlusEfficiencyEQM(EQMPlugin):
    id = "distance_plus_efficiency"
    version = "2.0.0"

    def __init__(self) -> None:
        self._direct = DirectFactorMethod()

    def required_params_schema(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "mpg": {"type": "number", "minimum": 0.000001},
                "fuel_type": {"type": "string", "enum": ["gasoline", "diesel"]},
            },
            "required": ["mpg"],
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
        mpg = float(activity.params.get("mpg") or 0)
        if mpg <= 0:
            raise ValueError("distance_plus_efficiency requires positive params.mpg")
        fuel_type = str(activity.params.get("fuel_type") or "gasoline")
        if fuel_type not in FUEL_FACTOR_DEFAULTS:
            raise ValueError("distance_plus_efficiency only supports gasoline or diesel")
        ureg = default_ureg()
        miles = to_unit(ureg, parse_qty(ureg, activity.activity.value, activity.activity.unit), "mile")
        gallons = miles.magnitude / mpg

        # Keep the transformed quantity explicit so future electric/CNG/propane
        # paths can swap the intermediate carrier without another interface break.
        transformed_activity = activity.model_copy(
            update={
                "activity": Quantity(value=float(gallons), unit="gallon"),
            }
        )
        transformed_activity_def = self._transform_activity_def(activity_def, fuel_type)
        out, trace = self._direct.compute_from_template_groups(
            activity=transformed_activity,
            activity_def=transformed_activity_def,
            ctx=ctx,
            factors=factors,
            template_groups=self._direct._group_templates(transformed_activity_def),
            selected_method=self.id,
            result_method_id=self.id,
        )
        trace.conversions.append(f"{miles.magnitude} miles / {mpg} mpg -> {gallons} gallons")
        trace.intermediate_quantities["distance_miles"] = float(miles.magnitude)
        trace.intermediate_quantities["fuel_gallons"] = float(gallons)
        return out, trace

    def _transform_activity_def(
        self,
        activity_def: ActivityTypeDefinition,
        fuel_type: str,
    ) -> ActivityTypeDefinition:
        combustion_templates = []
        for template in activity_def.factor_query_templates:
            if template.domain != "combustion":
                continue
            if template.type == fuel_type:
                combustion_templates.append(template)
        if not combustion_templates:
            base_template = next(
                (template for template in activity_def.factor_query_templates if template.domain == "combustion"),
                None,
            )
            if base_template is None:
                raise ValueError(f"{activity_def.activity_type_id} is missing combustion factor templates")
            combustion_templates.append(
                base_template.model_copy(
                    update={
                        "type": fuel_type,
                        "description": FUEL_FACTOR_DEFAULTS[fuel_type],
                    }
                )
            )
        return activity_def.model_copy(
            update={
                "source_type": fuel_type,
                "metric_group": "fuel",
                "metric_subgroup": "fossil_fuel",
                "factor_description": FUEL_FACTOR_DEFAULTS[fuel_type],
                "factor_query_templates": combustion_templates,
            }
        )
