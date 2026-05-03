from __future__ import annotations

from collections import defaultdict
from typing import Any

from .activity_catalog import ActivityTypeDefinition
from .factors import FactorRepository
from .models import ActivityRecord, AuditRecord, ResultRecord, TraceRecord


def _eqm_description(method_id: str) -> str:
    descriptions = {
        "direct_factor": (
            "Applies factor templates from the activity catalog to the reported quantity "
            "and computes gas rows and CO2e."
        ),
        "scope2_energy": (
            "Runs the Scope 2 factor templates and preserves location-based and "
            "market-based reporting where required."
        ),
        "distance_plus_efficiency": (
            "Converts reported distance and fuel efficiency into an intermediate fuel "
            "quantity, then applies combustion factors."
        ),
        "freight_ton_mile": "Applies freight transport factors to reported ton-mile activity.",
        "passenger_distance": "Applies passenger travel factors to reported passenger-mile activity.",
        "refrigerant_mass_to_gwp": (
            "Converts released refrigerant mass to CO2e using refrigerant-specific AR6 "
            "GWP values."
        ),
        "waste_mass": "Applies disposal-path-specific waste factors to reported waste mass.",
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
        "description": factor.description,
        "value": factor.value,
        "unit": factor.unit,
        "unit_label": factor.unit_label,
        "source": factor.factor_source or factor.source_entity_short,
        "valid_from": str(factor.valid_from) if factor.valid_from else None,
        "valid_to": str(factor.valid_to) if factor.valid_to else None,
    }


# Phase F2 PR 9 — single-result EQMs (refrigerant_mass_to_gwp,
# spend_based) emit one CO2e ResultRecord with no per-gas breakdown.
# When that's the case we surface the meaningful factor under
# ``primary_factor_*`` so the audit grid shows ``R-410A | 2088 | kg/kg``
# or ``Offices of Lawyers | 0.012 | kg/USD`` instead of an empty row.
_SINGLE_RESULT_METHODS = frozenset({"refrigerant_mass_to_gwp", "spend_based"})


def _primary_factor_for_single_result(
    *,
    method_id: str,
    factor_ids: list[str],
    factors: FactorRepository,
    input_params: dict[str, Any],
) -> tuple[str | None, float | None, str | None]:
    """Return (label, value, unit) for the row's meaningful factor.

    Refrigerant rows label off the input ``refrigerant_type`` param —
    cleaner than the catalog's chemical-name description. Spend rows
    label off the factor's catalog description (e.g. EEIO category).
    """
    if method_id not in _SINGLE_RESULT_METHODS or not factor_ids:
        return None, None, None
    detail = _factor_detail(factor_ids[0], factors)
    if not detail:
        return None, None, None
    if method_id == "refrigerant_mass_to_gwp":
        refrigerant_type = str(input_params.get("refrigerant_type") or "").strip()
        label = refrigerant_type or detail.get("description")
    else:
        label = detail.get("description")
    unit = detail.get("unit_label") or detail.get("unit")
    return label, detail.get("value"), unit


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
    activity_def: ActivityTypeDefinition,
    rows: list[ResultRecord],
    trace: TraceRecord,
    factors: FactorRepository,
) -> list[dict[str, Any]]:
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
        gas_rows = {row.gas: row for row in method_rows}
        factor_ids: list[str] = []
        for row in method_rows:
            for factor_id in row.factor_ids:
                if factor_id not in factor_ids:
                    factor_ids.append(factor_id)

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
        factor_selection_notes = list(trace.defaults_applied)
        partial_reason = activity_def.accounting_metadata.get("partial_reason")
        if partial_reason:
            factor_selection_notes.append(f"partial support: {partial_reason}")
        if any(row.gas == "co2" and row.is_biogenic for row in method_rows):
            factor_selection_notes.append("biogenic CO2 is reported separately from scope totals")

        primary_label, primary_value, primary_unit = _primary_factor_for_single_result(
            method_id=trace.selected_method,
            factor_ids=factor_ids,
            factors=factors,
            input_params=activity.params,
        )

        out.append(
            AuditRecord(
                facility_id=activity.facility_id,
                activity_type_id=activity.activity_type_id,
                activity_label=activity_def.label,
                source_type=activity_def.source_type,
                scope=activity_def.scope,
                protocol_category_code=activity_def.protocol_category_code,
                protocol_category_label=activity_def.protocol_category_label,
                activity_group=activity_def.ui_metadata.get("group"),
                metric_group=activity_def.metric_group,
                metric_subgroup=activity_def.metric_subgroup,
                accounting_method=accounting_method,
                input_activity_value=float(activity.activity.value),
                input_activity_unit=activity.activity.unit,
                input_params=activity.params,
                eqm_method=trace.selected_method,
                eqm_description=_eqm_description(trace.selected_method),
                eqm_steps=trace.conversions,
                factor_selection_notes=factor_selection_notes,
                activity_conversion_notes=activity_notes,
                factor_conversion_notes=factor_notes,
                factor_ids=factor_ids,
                factor_co2_id=f_co2["factor_id"] if f_co2 else None,
                factor_co2_value=f_co2["value"] if f_co2 else None,
                factor_co2_unit=f_co2["unit"] if f_co2 else None,
                factor_co2_source=f_co2["source"] if f_co2 else None,
                factor_co2_valid_from=f_co2["valid_from"] if f_co2 else None,
                factor_co2_valid_to=f_co2["valid_to"] if f_co2 else None,
                factor_ch4_id=f_ch4["factor_id"] if f_ch4 else None,
                factor_ch4_value=f_ch4["value"] if f_ch4 else None,
                factor_ch4_unit=f_ch4["unit"] if f_ch4 else None,
                factor_ch4_source=f_ch4["source"] if f_ch4 else None,
                factor_ch4_valid_from=f_ch4["valid_from"] if f_ch4 else None,
                factor_ch4_valid_to=f_ch4["valid_to"] if f_ch4 else None,
                factor_n2o_id=f_n2o["factor_id"] if f_n2o else None,
                factor_n2o_value=f_n2o["value"] if f_n2o else None,
                factor_n2o_unit=f_n2o["unit"] if f_n2o else None,
                factor_n2o_source=f_n2o["source"] if f_n2o else None,
                factor_n2o_valid_from=f_n2o["valid_from"] if f_n2o else None,
                factor_n2o_valid_to=f_n2o["valid_to"] if f_n2o else None,
                co2_result_kg=gas_rows["co2"].value if gas_rows.get("co2") else None,
                ch4_result_kg=gas_rows["ch4"].value if gas_rows.get("ch4") else None,
                n2o_result_kg=gas_rows["n2o"].value if gas_rows.get("n2o") else None,
                co2e_result_kg=gas_rows["co2e"].value if gas_rows.get("co2e") else None,
                primary_factor_label=primary_label,
                primary_factor_value=primary_value,
                primary_factor_unit=primary_unit,
            ).model_dump()
        )
    return out
