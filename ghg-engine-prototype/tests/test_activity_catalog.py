from __future__ import annotations

from pathlib import Path

import pytest

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.domain import ActivityObservation


def _catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(Path(__file__).resolve().parents[1] / "data" / "activity_types.json")


def test_activity_catalog_loads_reasonable_v1_coverage():
    catalog = _catalog()

    assert len(catalog.rows) >= 30

    activity_ids = {row.activity_type_id for row in catalog.rows}
    assert "scope2_purchased_electricity_grid_mix" in activity_ids
    assert "scope1_fugitive_refrigerant_release" in activity_ids
    assert "scope3_waste_generated_in_operations" in activity_ids


def test_rental_vehicle_schema_captures_multi_input_requirements():
    activity = _catalog().get_required("scope3_business_travel_rental_vehicle")

    assert activity.method_id == "distance_plus_efficiency"
    assert activity.implementation_status == "implemented"

    by_field_id = {field.field_id: field for field in activity.input_schema.fields}
    assert by_field_id["distance"].is_primary is True
    assert by_field_id["distance"].allowed_units == ["mile"]
    assert by_field_id["fuel_efficiency"].param_key == "mpg"
    assert by_field_id["fuel_type"].options == ["gasoline", "diesel"]


def test_employee_owned_vehicle_is_now_runtime_ready():
    activity = _catalog().get_required("scope3_business_travel_employee_owned_vehicle")

    assert activity.method_id == "distance_plus_efficiency"
    assert activity.implementation_status == "implemented"

    by_field_id = {field.field_id: field for field in activity.input_schema.fields}
    assert by_field_id["fuel_efficiency"].required is True
    assert by_field_id["fuel_efficiency"].param_key == "mpg"


def test_renewable_electricity_claim_keeps_dual_scope2_templates():
    activity = _catalog().get_required("scope2_purchased_electricity_renewable_purchase")

    assert activity.implementation_status == "partial"
    methods = {template.accounting_method for template in activity.factor_query_templates}
    assert methods == {"location_based", "market_based"}


def test_catalog_exposes_manual_factor_override_fields_for_supported_activities():
    grid_mix = _catalog().get_required("scope2_purchased_electricity_grid_mix")
    natural_gas = _catalog().get_required("scope1_stationary_natural_gas")

    grid_fields = {field.field_id: field for field in grid_mix.input_schema.fields}
    gas_fields = {field.field_id: field for field in natural_gas.input_schema.fields}

    assert grid_fields["market_based_emission_factor"].kind == "quantity"
    assert grid_fields["market_based_emission_factor"].allowed_units == [
        "kg/kwh",
        "kg/mwh",
        "lb/kwh",
        "lb/mwh",
    ]
    assert gas_fields["emission_factor_override"].kind == "quantity"
    assert gas_fields["emission_factor_override"].default_unit == "kg/mmbtu"


def test_refrigerant_activity_is_repeatable_and_protocol_driven():
    activity = _catalog().get_required("scope1_fugitive_refrigerant_release")

    by_field_id = {field.field_id: field for field in activity.input_schema.fields}
    assert by_field_id["refrigerant_type"].param_key == "refrigerant_type"
    assert activity.ui_metadata["repeatable"] is True
    assert activity.ui_metadata["bulk_entry_mode"] == "repeatable_summary"
    assert activity.accounting_metadata["requires_gwp_set"] is True


def test_status_filter_returns_only_requested_rows():
    catalog = _catalog()

    implemented = catalog.list(status="implemented")

    assert implemented
    assert all(row.implementation_status == "implemented" for row in implemented)


def test_runtime_catalog_rows_have_required_metadata():
    catalog = _catalog()

    active = [
        row
        for row in catalog.rows
        if row.implementation_status in {"implemented", "partial"}
    ]

    assert active
    assert all(row.source_type for row in active)
    assert all(row.default_unit for row in active)
    assert all(row.method_id for row in active)


def test_partial_rows_require_partial_reason():
    catalog = _catalog()

    partial_rows = catalog.list(status="partial")
    assert partial_rows
    assert all(row.accounting_metadata.get("partial_reason") for row in partial_rows)


def test_only_explicitly_blocked_rows_remain_non_runtime():
    catalog = _catalog()

    assert {row.activity_type_id for row in catalog.list(status="planned")} == {
        "scope1_onsite_generation_electricity",
        "scope2_purchased_district_steam_renewable",
    }
    assert {row.activity_type_id for row in catalog.list(status="deferred")} == {
        "scope3_upstream_transport_other_freight_fuel",
    }


def test_catalog_validates_required_secondary_fields():
    catalog = _catalog()
    activity_def = catalog.get_required("scope3_business_travel_rental_vehicle")
    observation = ActivityObservation(
        activity_id="a1",
        locus_id="F1",
        activity_type_id=activity_def.activity_type_id,
        quantity={"value": 100.0, "unit": "mile"},
        params={},
    )

    with pytest.raises(ValueError, match="requires params.mpg"):
        catalog.validate_activity(activity_def, observation)


def test_catalog_validates_quantity_secondary_field_units():
    catalog = _catalog()
    activity_def = catalog.get_required("scope2_purchased_electricity_grid_mix")
    observation = ActivityObservation(
        activity_id="a1",
        locus_id="F1",
        activity_type_id=activity_def.activity_type_id,
        quantity={"value": 100.0, "unit": "kwh"},
        params={"market_based_emission_factor": {"value": 0.2, "unit": "kg/short-ton"}},
    )

    with pytest.raises(ValueError, match="must be one of"):
        catalog.validate_activity(activity_def, observation)
