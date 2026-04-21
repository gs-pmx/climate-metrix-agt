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


def test_catalog_activity_types_endpoint_filters_by_status(client: TestClient):
    response = client.get("/catalog/activity-types", params={"status": "implemented"})

    assert response.status_code == 200
    payload = response.json()
    assert payload
    assert all(row["implementation_status"] == "implemented" for row in payload)


def test_activity_schema_endpoint_exposes_multi_input_form_contract(client: TestClient):
    response = client.get("/schema/activity/scope3_business_travel_rental_vehicle")

    assert response.status_code == 200
    payload = response.json()
    assert payload["method_id"] == "distance_plus_efficiency"
    assert payload["protocol_category_code"] == "6"
    assert [field["field_id"] for field in payload["input_schema"]["fields"]] == [
        "distance",
        "fuel_efficiency",
        "fuel_type",
    ]


def test_activity_schema_endpoint_returns_404_for_unknown_activity(client: TestClient):
    response = client.get("/schema/activity/not-a-real-activity")

    assert response.status_code == 404
    assert "unknown activity_type_id" in response.json()["detail"]
