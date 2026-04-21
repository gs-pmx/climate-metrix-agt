from __future__ import annotations

from pathlib import Path

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.models import ActivityRecord
from ghg_engine.routing import RoutingCatalog


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


def test_refrigerant_activity_is_repeatable_and_protocol_driven():
    activity = _catalog().get_required("scope1_fugitive_refrigerant_release")

    by_field_id = {field.field_id: field for field in activity.input_schema.fields}
    assert by_field_id["refrigerant_type"].param_key == "refrigerant_type"
    assert activity.ui_metadata["repeatable"] is True
    assert activity.accounting_metadata["requires_gwp_set"] is True


def test_status_filter_returns_only_requested_rows():
    catalog = _catalog()

    implemented = catalog.list(status="implemented")

    assert implemented
    assert all(row.implementation_status == "implemented" for row in implemented)


def test_routing_catalog_bridges_canonical_and_legacy_source_ids():
    catalog = _catalog()
    legacy = RoutingCatalog.from_csv(Path(__file__).resolve().parents[1] / "data" / "routing.csv")

    routing = RoutingCatalog.from_activity_catalog(catalog, legacy_catalog=legacy)

    bridged = routing.resolve(
        ActivityRecord(
            facility_id="F1",
            activity_type_id="scope3_business_travel_rental_vehicle",
            source_id="travel_miles_s3",
            source_type="gasoline",
            scope="Scope 3",
            metric_group="travel",
            metric_subgroup="3.6_business_travel",
            activity={"value": 100.0, "unit": "mile"},
            params={"mpg": 25, "fuel_type": "gasoline"},
        )
    )

    assert bridged.source_id == "travel_rental_vehicle_s3"
    assert bridged.legacy_source_ids == ["travel_miles_s3"]
    assert bridged.method_id == "miles_to_fuel"
