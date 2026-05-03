"""Phase F2 PR 9 — focused tests for ``build_audit_rows`` primary-factor surface.

Single-result EQMs (refrigerant_mass_to_gwp, spend_based) emit one
CO2e ResultRecord with no per-gas breakdown. The audit grid otherwise
shows empty cells for those rows — these tests pin the
``primary_factor_label / value / unit`` columns that fill the gap.
"""

from __future__ import annotations

from typing import Any

from ghg_engine.activity_catalog import (
    ActivityInputField,
    ActivityInputSchema,
    ActivityTypeDefinition,
)
from ghg_engine.audit import build_audit_rows
from ghg_engine.models import (
    ActivityRecord,
    EmissionFactorRow,
    Quantity,
    ResultRecord,
    TraceRecord,
)


def _input_schema(default_unit: str = "kg") -> ActivityInputSchema:
    return ActivityInputSchema(
        fields=[
            ActivityInputField(
                field_id="quantity",
                label="Quantity",
                kind="quantity",
                is_primary=True,
                default_unit=default_unit,
            ),
        ],
    )


class _StubFactors:
    """Minimal FactorRepository stand-in for build_audit_rows.

    ``build_audit_rows`` only ever calls ``get_by_factor_id`` on the
    repository, so a dict-backed stub is sufficient to drive the
    primary-factor lookup path without spinning up the pandas store.
    """

    def __init__(self, by_id: dict[str, EmissionFactorRow]):
        self._by_id = by_id

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        return self._by_id.get(factor_id)


def _activity_def(
    *,
    method_id: str = "direct_factor",
    scope: str = "Scope 1",
    default_unit: str = "kg",
) -> ActivityTypeDefinition:
    return ActivityTypeDefinition(
        activity_type_id="dummy",
        label="Dummy Source",
        description="dummy",
        category="dummy",
        scope=scope,  # type: ignore[arg-type]
        metric_group="dummy",
        default_unit=default_unit,
        method_id=method_id,
        implementation_status="implemented",
        input_schema=_input_schema(default_unit=default_unit),
    )


def _activity(*, activity_type_id: str, params: dict[str, Any], value: float = 1.0, unit: str = "kg") -> ActivityRecord:
    return ActivityRecord(
        facility_id="ru1",
        activity_type_id=activity_type_id,
        activity=Quantity(value=value, unit=unit),
        params=params,
    )


def _result(*, gas: str, value: float, factor_ids: list[str], method_id: str, scope: str = "Scope 1") -> ResultRecord:
    return ResultRecord(
        facility_id="ru1",
        activity_type_id="dummy",
        activity_label="Dummy Source",
        scope=scope,  # type: ignore[arg-type]
        accounting_method="none",
        gas=gas,
        value=value,
        unit="kg",
        is_biogenic=False,
        method_id=method_id,
        factor_ids=factor_ids,
    )


def _factor(*, factor_id: str, description: str, value: float, unit: str = "kg/kg", unit_label: str | None = None) -> EmissionFactorRow:
    return EmissionFactorRow(
        factor_id=factor_id,
        emission_category="dummy",
        type="dummy",
        description=description,
        attribute="dummy",
        value=value,
        unit=unit,
        unit_label=unit_label,
    )


def test_refrigerant_audit_row_uses_refrigerant_type_and_gwp():
    factors = _StubFactors(
        {
            "ipcc:hfc-32": _factor(
                factor_id="ipcc:hfc-32",
                description="Difluoromethane (HFC-32)",
                value=771.0,
                unit="kg/kg",
            ),
        }
    )
    activity = _activity(
        activity_type_id="scope1_fugitive_refrigerant_release",
        params={"refrigerant_type": "R-410A"},
    )
    activity_def = _activity_def(method_id="refrigerant_mass_to_gwp", scope="Scope 1")
    trace = TraceRecord(selected_method="refrigerant_mass_to_gwp")
    result = _result(
        gas="co2e",
        value=771.0,
        factor_ids=["ipcc:hfc-32"],
        method_id="refrigerant_mass_to_gwp",
        scope="Scope 1",
    )

    rows = build_audit_rows(activity, activity_def, [result], trace, factors)
    assert len(rows) == 1
    row = rows[0]
    # Refrigerant rows label off the input refrigerant_type, not the
    # catalog chemical name — the user pasted "R-410A" and expects to
    # see "R-410A" in the audit grid.
    assert row["primary_factor_label"] == "R-410A"
    assert row["primary_factor_value"] == 771.0
    assert row["primary_factor_unit"] == "kg/kg"
    # Per-gas slots stay empty for single-result EQMs.
    assert row["factor_co2_id"] is None
    assert row["factor_ch4_id"] is None
    assert row["factor_n2o_id"] is None


def test_spend_audit_row_uses_factor_description_and_value():
    factors = _StubFactors(
        {
            "useeio:541110": _factor(
                factor_id="useeio:541110",
                description="Offices of Lawyers",
                value=0.123,
                unit="kg/USD",
                unit_label="kg CO2e / USD",
            ),
        }
    )
    activity = _activity(
        activity_type_id="scope3_spend_based",
        params={"gl_code": "5100", "gl_account_name": "Legal Fees"},
        value=1000.0,
        unit="USD",
    )
    activity_def = _activity_def(method_id="spend_based", scope="Scope 3", default_unit="USD")
    trace = TraceRecord(selected_method="spend_based")
    result = _result(
        gas="co2e",
        value=123.0,
        factor_ids=["useeio:541110"],
        method_id="spend_based",
        scope="Scope 3",
    )

    rows = build_audit_rows(activity, activity_def, [result], trace, factors)
    assert len(rows) == 1
    row = rows[0]
    assert row["primary_factor_label"] == "Offices of Lawyers"
    assert row["primary_factor_value"] == 0.123
    # Prefers unit_label when present (e.g. "kg CO2e / USD" vs "kg/USD").
    assert row["primary_factor_unit"] == "kg CO2e / USD"


def test_per_gas_audit_row_leaves_primary_factor_fields_none():
    factors = _StubFactors({})
    activity = _activity(
        activity_type_id="scope1_natural_gas",
        params={},
        value=10.0,
        unit="mmBtu",
    )
    activity_def = _activity_def(method_id="direct_factor", scope="Scope 1", default_unit="mmBtu")
    trace = TraceRecord(selected_method="direct_factor")
    rows = build_audit_rows(
        activity,
        activity_def,
        [
            _result(gas="co2", value=530.0, factor_ids=[], method_id="direct_factor"),
            _result(gas="ch4", value=0.01, factor_ids=[], method_id="direct_factor"),
            _result(gas="co2e", value=531.0, factor_ids=[], method_id="direct_factor"),
        ],
        trace,
        factors,
    )
    assert len(rows) == 1
    row = rows[0]
    # Per-gas activities don't populate primary_factor_* — the per-gas
    # CO2/CH4/N2O columns already carry the detail in the audit grid.
    assert row["primary_factor_label"] is None
    assert row["primary_factor_value"] is None
    assert row["primary_factor_unit"] is None
