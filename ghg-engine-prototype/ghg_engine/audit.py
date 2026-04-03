from __future__ import annotations

from collections import defaultdict
from typing import Any

from .factors import FactorRepository
from .models import ActivityRecord, ResultRecord, TraceRecord


def _eqm_description(method_id: str) -> str:
    descriptions = {
        "direct_factor": "Applies gas-specific emission factors to activity, normalizes to kg, and computes CO2e.",
        "miles_to_fuel": "Converts miles to gallons with MPG, then applies direct gas-specific emission factors.",
    }
    return descriptions.get(method_id, "No method description available.")


def _factor_detail(factor_id: str | None, factors: FactorRepository) -> dict[str, Any] | None:
    if not factor_id:
        return None
    factor = factors.get_by_factor_id(factor_id)
    if factor is None:
        return None
    return {
        "factor_id": factor.factor_id,
        "value": factor.value,
        "unit": factor.unit,
        "source": factor.factor_source or factor.source_entity_short,
        "valid_from": str(factor.valid_from) if factor.valid_from else None,
        "valid_to": str(factor.valid_to) if factor.valid_to else None,
    }


def _conversion_notes(activity_unit: str, factor_unit: str | None) -> tuple[str | None, str | None]:
    if not factor_unit or "/" not in factor_unit:
        return None, None
    numerator, denominator = [s.strip() for s in factor_unit.split("/", 1)]
    activity_note = None
    factor_note = None
    if denominator.lower() != str(activity_unit).lower():
        activity_note = f"activity converted from {activity_unit} to {denominator}"
    if numerator.lower() not in {"kg", "kilogram", "kilograms"}:
        factor_note = f"factor converted from {numerator} to kg"
    return activity_note, factor_note


def build_audit_rows(
    activity: ActivityRecord,
    rows: list[ResultRecord],
    trace: TraceRecord,
    factors: FactorRepository,
) -> list[dict[str, Any]]:
    """Build audit-row dicts for a single activity's results.

    Returns plain dicts so callers can construct whatever schema they need.
    """

    def _factor_for_gas(gas_name: str) -> dict[str, Any] | None:
        row = gas_rows.get(gas_name)
        if row is None or not row.factor_ids:
            return None
        return _factor_detail(row.factor_ids[0], factors)

    by_method: dict[str, list[ResultRecord]] = defaultdict(list)
    for row in rows:
        by_method[row.accounting_method].append(row)

    out: list[dict[str, Any]] = []
    for accounting_method, method_rows in by_method.items():
        gas_rows = {r.gas: r for r in method_rows}
        factor_ids: list[str] = []
        for r in method_rows:
            for fid in r.factor_ids:
                if fid not in factor_ids:
                    factor_ids.append(fid)

        f_co2 = _factor_for_gas("co2")
        f_ch4 = _factor_for_gas("ch4")
        f_n2o = _factor_for_gas("n2o")

        activity_notes: list[str] = []
        factor_notes: list[str] = []
        for factor in [f_co2, f_ch4, f_n2o]:
            if not factor:
                continue
            activity_note, factor_note = _conversion_notes(activity.activity.unit, factor.get("unit"))
            if activity_note and activity_note not in activity_notes:
                activity_notes.append(activity_note)
            if factor_note and factor_note not in factor_notes:
                factor_notes.append(factor_note)

        for step in trace.conversions:
            if step not in activity_notes:
                activity_notes.append(step)

        out.append(
            {
                "facility_id": activity.facility_id,
                "source_id": activity.source_id,
                "source_type": activity.source_type,
                "scope": activity.scope,
                "accounting_method": accounting_method,
                "metric_group": activity.metric_group,
                "metric_subgroup": activity.metric_subgroup,
                "input_activity_value": float(activity.activity.value),
                "input_activity_unit": activity.activity.unit,
                "eqm_method": trace.selected_method,
                "eqm_description": _eqm_description(trace.selected_method),
                "eqm_steps": trace.conversions,
                "factor_selection_notes": trace.defaults_applied,
                "activity_conversion_notes": activity_notes,
                "factor_conversion_notes": factor_notes,
                "factor_ids": factor_ids,
                "factor_co2_id": f_co2["factor_id"] if f_co2 else None,
                "factor_co2_value": f_co2["value"] if f_co2 else None,
                "factor_co2_unit": f_co2["unit"] if f_co2 else None,
                "factor_co2_source": f_co2["source"] if f_co2 else None,
                "factor_co2_valid_from": f_co2["valid_from"] if f_co2 else None,
                "factor_co2_valid_to": f_co2["valid_to"] if f_co2 else None,
                "factor_ch4_id": f_ch4["factor_id"] if f_ch4 else None,
                "factor_ch4_value": f_ch4["value"] if f_ch4 else None,
                "factor_ch4_unit": f_ch4["unit"] if f_ch4 else None,
                "factor_ch4_source": f_ch4["source"] if f_ch4 else None,
                "factor_ch4_valid_from": f_ch4["valid_from"] if f_ch4 else None,
                "factor_ch4_valid_to": f_ch4["valid_to"] if f_ch4 else None,
                "factor_n2o_id": f_n2o["factor_id"] if f_n2o else None,
                "factor_n2o_value": f_n2o["value"] if f_n2o else None,
                "factor_n2o_unit": f_n2o["unit"] if f_n2o else None,
                "factor_n2o_source": f_n2o["source"] if f_n2o else None,
                "factor_n2o_valid_from": f_n2o["valid_from"] if f_n2o else None,
                "factor_n2o_valid_to": f_n2o["valid_to"] if f_n2o else None,
                "co2_result_kg": gas_rows["co2"].value if gas_rows.get("co2") else None,
                "ch4_result_kg": gas_rows["ch4"].value if gas_rows.get("ch4") else None,
                "n2o_result_kg": gas_rows["n2o"].value if gas_rows.get("n2o") else None,
                "co2e_result_kg": gas_rows["co2e"].value if gas_rows.get("co2e") else None,
            }
        )
    return out
