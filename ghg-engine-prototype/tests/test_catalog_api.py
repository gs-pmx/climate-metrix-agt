from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test-ghg-projects.sqlite"))
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def test_catalog_activity_types_endpoint_returns_protocol_catalog(client: TestClient):
    response = client.get("/catalog/activity-types")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) >= 30
    assert any(row["activity_type_id"] == "scope2_purchased_electricity_grid_mix" for row in payload)


def test_catalog_factor_source_coverage_endpoint_returns_source_level_rows(client: TestClient):
    response = client.get("/catalog/factor-source-coverage")

    assert response.status_code == 200
    payload = response.json()
    assert payload

    electricity = next(
        row
        for row in payload
        if row["category"] == "Stationary Energy"
        and row["scope"] == "Scope 2"
        and row["factor_domain"] == "electricity-generation"
        and row["accounting_method"] == "location_based"
    )
    assert "egrid" in electricity["sources"]
    assert 2023 in electricity["data_years"]
    assert set(electricity["expected_attributes"]) == {"co2_ef", "ch4_ef", "n2o_ef"}
    assert electricity["coverage_status"] == "available"

    market_based = next(
        row
        for row in payload
        if row["category"] == "Stationary Energy"
        and row["scope"] == "Scope 2"
        and row["factor_domain"] == "electricity-generation"
        and row["accounting_method"] == "market_based"
    )
    assert market_based["coverage_status"] == "missing"
    assert market_based["sources"] == []


def test_catalog_full_inventory_factor_catalog_returns_every_activity_need(client: TestClient):
    response = client.get("/catalog/full-inventory-factor-catalog")

    assert response.status_code == 200
    payload = response.json()
    assert payload

    activity_ids = {row["activity_type_id"] for row in payload}
    activity_response = client.get("/catalog/activity-types")
    all_activity_ids = {row["activity_type_id"] for row in activity_response.json()}
    assert all_activity_ids.issubset(activity_ids)

    grid_rows = [
        row
        for row in payload
        if row["activity_type_id"] == "scope2_purchased_electricity_grid_mix"
    ]
    assert {row["accounting_method"] for row in grid_rows} == {"location_based", "market_based"}
    location_based = next(row for row in grid_rows if row["accounting_method"] == "location_based")
    assert location_based["coverage_status"] == "available"
    assert "egrid" in location_based["sources"]
    assert "lb/MWh" in location_based["unit_labels"]
    assert "eGRID subregion" in location_based["geography_summary"]

    unmapped = next(
        row
        for row in payload
        if row["activity_type_id"] == "scope1_onsite_generation_electricity"
    )
    assert unmapped["coverage_status"] == "not_mapped"
    assert unmapped["notes"]


def test_catalog_activity_types_endpoint_is_available_under_api_prefix(client: TestClient):
    response = client.get("/api/catalog/activity-types")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) >= 30
    assert any(row["activity_type_id"] == "scope2_purchased_electricity_grid_mix" for row in payload)


def test_catalog_activity_types_endpoint_filters_by_status(client: TestClient):
    response = client.get("/catalog/activity-types", params={"status": "implemented"})

    assert response.status_code == 200
    payload = response.json()
    assert payload
    assert all(row["implementation_status"] == "implemented" for row in payload)


def test_catalog_activity_types_endpoint_exposes_full_ui_contract(client: TestClient):
    response = client.get("/catalog/activity-types", params={"status": "implemented"})

    assert response.status_code == 200
    activity = next(
        row for row in response.json()
        if row["activity_type_id"] == "scope3_business_travel_rental_vehicle"
    )
    assert "source_id" not in activity
    assert activity["default_unit"] == "mile"
    assert activity["allowed_units"] == ["mile"]
    assert activity["ui_metadata"]["group"] == "Transportation"
    assert [field["field_id"] for field in activity["input_schema"]["fields"]] == [
        "distance",
        "fuel_efficiency",
        "fuel_type",
    ]


def test_catalog_activity_types_endpoint_exposes_partial_reason_and_bulk_entry_mode(client: TestClient):
    response = client.get("/catalog/activity-types")

    assert response.status_code == 200
    by_id = {row["activity_type_id"]: row for row in response.json()}
    refrigerant = by_id["scope1_fugitive_refrigerant_release"]
    renewable_electricity = by_id["scope2_purchased_electricity_renewable_purchase"]

    assert refrigerant["ui_metadata"]["bulk_entry_mode"] == "repeatable_summary"
    assert renewable_electricity["accounting_metadata"]["partial_reason"]


def test_catalog_activity_types_endpoint_exposes_manual_factor_override_fields(client: TestClient):
    response = client.get("/catalog/activity-types")

    assert response.status_code == 200
    by_id = {row["activity_type_id"]: row for row in response.json()}
    grid_mix = by_id["scope2_purchased_electricity_grid_mix"]
    natural_gas = by_id["scope1_stationary_natural_gas"]

    grid_fields = {field["field_id"]: field for field in grid_mix["input_schema"]["fields"]}
    gas_fields = {field["field_id"]: field for field in natural_gas["input_schema"]["fields"]}

    assert grid_fields["market_based_emission_factor"]["kind"] == "quantity"
    assert grid_fields["market_based_emission_factor"]["allowed_units"] == [
        "kg/kwh",
        "kg/mwh",
        "lb/kwh",
        "lb/mwh",
    ]
    assert gas_fields["emission_factor_override"]["kind"] == "quantity"
    assert gas_fields["emission_factor_override_source"]["kind"] == "string"


def test_schema_method_exposes_registered_scope2_plugin(client: TestClient):
    response = client.get("/schema/method/scope2_energy")

    assert response.status_code == 200
    payload = response.json()
    assert payload["method_id"] == "scope2_energy"


def test_schema_method_is_available_under_api_prefix(client: TestClient):
    response = client.get("/api/schema/method/scope2_energy")

    assert response.status_code == 200
    payload = response.json()
    assert payload["method_id"] == "scope2_energy"
