from __future__ import annotations

import re

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..factors import FactorQuery, FactorRepository
from ..models import ActivityRecord, CalculationContext, GeoContext, ResultRecord, TraceRecord
from ..time_utils import activity_bucket
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg
from .context import gwp_set, inventory_year

REFRIGERANT_TYPE_HINTS = {
    "HFC": "hfc",
    "PFC": "pfc",
    "CFC": "cfc",
    "HCFC": "hcfc",
    "HFO": "hfo",
    "SF": "sulfur-fluoride",
    "NF": "nitrogen-fluoride",
}

FALLBACK_REFRIGERANT_TYPES = ["hfc", "pfc", "cfc", "hcfc", "hfo", "sulfur-fluoride", "nitrogen-fluoride"]


class RefrigerantMassToGwpMethod(EQMPlugin):
    id = "refrigerant_mass_to_gwp"
    version = "1.0.0"

    def required_params_schema(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "refrigerant_type": {"type": "string"},
            },
            "required": ["refrigerant_type"],
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
        *,
        resolved: ResolvedActivity | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        if gwp_set(ctx, resolved) != "AR6":
            raise ValueError("refrigerant_mass_to_gwp currently supports AR6 only")
        refrigerant_type = str(activity.params.get("refrigerant_type") or "").strip()
        if not refrigerant_type:
            raise ValueError("refrigerant_mass_to_gwp requires params.refrigerant_type")

        trace = TraceRecord(
            activity_type_id=activity.activity_type_id,
            activity_label=activity_def.label,
            selected_method=self.id,
        )
        factor = self._select_refrigerant_factor(
            factors=factors,
            activity_def=activity_def,
            refrigerant_type=refrigerant_type,
            ctx=ctx,
            trace=trace,
            resolved=resolved,
        )
        if factor is None:
            raise ValueError(f"no AR6 GWP factor matched refrigerant_type '{refrigerant_type}'")

        ureg = default_ureg()
        released_mass = to_unit(ureg, parse_qty(ureg, activity.activity.value, activity.activity.unit), "kilogram")
        if activity.activity.unit.lower() not in {"kg", "kilogram"}:
            trace.conversions.append(
                f"converted {activity.activity.value} {activity.activity.unit} to kilograms"
            )
        co2e_kg = float(released_mass.magnitude * factor.value)
        trace.factor_matches.append(factor.factor_id)
        trace.defaults_applied.append(f"used AR6 refrigerant GWP factor for {refrigerant_type}")

        result = ResultRecord(
            facility_id=activity.facility_id,
            activity_type_id=activity.activity_type_id,
            activity_label=activity_def.label,
            scope=activity_def.scope,
            protocol_category_code=activity_def.protocol_category_code,
            protocol_category_label=activity_def.protocol_category_label,
            activity_group=activity_def.ui_metadata.get("group"),
            source_type=activity_def.source_type,
            accounting_method="none",
            gas="co2e",
            value=co2e_kg,
            unit="kg",
            is_biogenic=False,
            method_id=self.id,
            factor_ids=[factor.factor_id] if factor.factor_id else [],
            time_bucket=activity_bucket(activity, inventory_year(ctx, resolved), "month"),
        )
        return [result], trace

    def _select_refrigerant_factor(
        self,
        *,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        refrigerant_type: str,
        ctx: CalculationContext,
        trace: TraceRecord,
        resolved: ResolvedActivity | None,
    ):
        normalized_type = refrigerant_type.strip()
        candidates = []
        upper = normalized_type.upper()
        for prefix, factor_type in REFRIGERANT_TYPE_HINTS.items():
            if upper.startswith(prefix):
                candidates.append(factor_type)
        candidates.extend([factor_type for factor_type in FALLBACK_REFRIGERANT_TYPES if factor_type not in candidates])
        descriptions = self._description_candidates(normalized_type)

        for factor_type in candidates:
            for description in descriptions:
                factor = factors.select_best(
                    FactorQuery(
                        emission_category=activity_def.emission_category or "",
                        type=factor_type,
                        description=description,
                        attribute="gwp_100_ar6",
                        greenhouse_gas=None,
                        inventory_year=inventory_year(ctx, resolved),
                        geo=GeoContext(),
                    ),
                    trace=trace.defaults_applied,
                )
                if factor is not None:
                    return factor
        return None

    def _description_candidates(self, refrigerant_type: str) -> list[str]:
        candidates = [refrigerant_type.strip()]
        match = re.match(r"^([A-Za-z-]+)(.*)$", refrigerant_type.strip())
        if match:
            candidates.append(f"{match.group(1).upper()}{match.group(2)}")
        candidates.append(refrigerant_type.strip().upper())
        deduped: list[str] = []
        for candidate in candidates:
            if candidate and candidate not in deduped:
                deduped.append(candidate)
        return deduped
