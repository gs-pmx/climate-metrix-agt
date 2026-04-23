from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test-ghg-projects.sqlite"))
    # Use the CSV factor backend so the WECC electricity factors from
    # tests/fixtures golden data are available to this test suite.
    monkeypatch.setenv("FACTOR_BACKEND", "csv")
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def _valid_activity() -> dict:
    return {
        "facility_id": "F1",
        "activity_type_id": "scope2_purchased_electricity_grid_mix",
        "activity": {"value": 1000.0, "unit": "kwh"},
    }


def _invalid_activity_unknown_type() -> dict:
    return {
        "facility_id": "F2",
        "activity_type_id": "this_activity_type_does_not_exist",
        "activity": {"value": 1.0, "unit": "kwh"},
    }


def _context() -> dict:
    return {
        "inventory_year": 2024,
        "gwp_set": "AR6",
        "source_attributes": {
            "country": "US",
            "egrid_subregion": "WECC",
        },
    }


def test_calculate_unknown_activity_type_returns_400_with_structured_envelope(client: TestClient):
    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [_invalid_activity_unknown_type()],
        },
    )

    assert response.status_code == 400
    body = response.json()
    # Structured envelope present for new clients
    assert body["results"] == []
    assert body["partial_success"] is False
    assert len(body["errors"]) == 1
    error = body["errors"][0]
    assert error["activity_index"] == 0
    assert error["error_code"] == "unknown_activity_type"
    assert error["activity_type_id"] == "this_activity_type_does_not_exist"
    assert error["facility_id"] == "F2"
    # Old clients keep reading detail
    assert isinstance(body.get("detail"), str)
    assert body["detail"]


def test_calculate_partial_success_returns_200_with_both_results_and_errors(client: TestClient):
    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                _valid_activity(),
                _invalid_activity_unknown_type(),
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["partial_success"] is True
    assert len(body["results"]) >= 1
    assert len(body["errors"]) == 1
    err = body["errors"][0]
    assert err["activity_index"] == 1
    assert err["error_code"] == "unknown_activity_type"
    assert err["activity_type_id"] == "this_activity_type_does_not_exist"


def test_calculate_all_valid_returns_200_with_no_errors(client: TestClient):
    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [_valid_activity()],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert body["partial_success"] is False
    assert len(body["results"]) >= 1


def test_calculate_empty_activities_returns_clean_200(client: TestClient):
    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["results"] == []
    assert body["errors"] == []
    assert body["partial_success"] is False
    assert body["summary"] == {}


def test_calculate_invalid_unit_maps_to_invalid_unit_code(client: TestClient):
    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                {
                    "facility_id": "F1",
                    "activity_type_id": "scope2_purchased_electricity_grid_mix",
                    "activity": {"value": 1000.0, "unit": "bogus_unit"},
                }
            ],
        },
    )

    assert response.status_code == 400
    body = response.json()
    assert len(body["errors"]) == 1
    assert body["errors"][0]["error_code"] == "invalid_unit"


def test_calculate_audit_partial_success_excludes_failed_audit_rows(client: TestClient):
    response = client.post(
        "/calculate/audit",
        json={
            "context": _context(),
            "activities": [
                _valid_activity(),
                _invalid_activity_unknown_type(),
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["partial_success"] is True
    assert len(body["results"]) >= 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["activity_index"] == 1
    # Audit rows are only produced for the successful activity.
    for row in body["audit_rows"]:
        assert row["facility_id"] == "F1"


def test_calculate_audit_total_failure_returns_400_with_envelope(client: TestClient):
    response = client.post(
        "/calculate/audit",
        json={
            "context": _context(),
            "activities": [_invalid_activity_unknown_type()],
        },
    )

    assert response.status_code == 400
    body = response.json()
    assert body["results"] == []
    assert body["audit_rows"] == []
    assert len(body["errors"]) == 1
    assert body["errors"][0]["error_code"] == "unknown_activity_type"
    assert isinstance(body.get("detail"), str)
