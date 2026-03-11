from __future__ import annotations

from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, Quantity, ResultRecord, RoutingRow, TraceRecord
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg
from .direct_factor import DirectFactorMethod


class MilesToFuelEQM(EQMPlugin):
    id = "miles_to_fuel"
    version = "1.0.0"

    def required_params_schema(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "mpg": {"type": "number", "minimum": 0.000001},
                "fuel_type": {"type": "string", "enum": ["gasoline", "diesel"]},
            },
            "required": ["mpg"],
        }

    def applicability(self, activity: ActivityRecord, routing: RoutingRow) -> bool:
        return routing.metric_group in {"distance", "travel"} or activity.activity.unit.lower() in {"mile", "miles"}

    def compute(
        self,
        activity: ActivityRecord,
        routing: RoutingRow,
        ctx: CalculationContext,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        mpg = float(activity.params.get("mpg") or 0)
        if mpg <= 0:
            raise ValueError("miles_to_fuel requires positive params.mpg")
        fuel_type = str(activity.params.get("fuel_type") or activity.source_type or "gasoline")
        if fuel_type not in {"gasoline", "diesel"}:
            raise ValueError("miles_to_fuel only supports gasoline or diesel")
        ureg = default_ureg()
        miles = to_unit(ureg, parse_qty(ureg, activity.activity.value, activity.activity.unit), "mile")
        gallons = miles.magnitude / mpg
        transformed = activity.model_copy(
            update={
                "source_type": fuel_type,
                "metric_group": "fuel",
                "metric_subgroup": "fossil_fuel",
                "activity": Quantity(value=float(gallons), unit="gallon"),
            }
        )
        transformed_routing = routing.model_copy(update={"source_type": fuel_type, "metric_group": "fuel"})
        direct = DirectFactorMethod()
        out, trace = direct.compute(transformed, transformed_routing, ctx, factors)
        trace.selected_method = self.id
        trace.conversions.append(f"{miles.magnitude} miles / {mpg} mpg -> {gallons} gallons")
        return out, trace
