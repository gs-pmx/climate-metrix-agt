"""PR B integration tests: backend-enforced reporting-unit applicability.

These exercise the wire shape: ``CalculationRequest.applicability``
arriving at ``/calculate`` and ``/calculate/audit`` causes inapplicable
activities to be silently dropped before the engine sees them. The
fallback chain (payload -> draft -> snapshot -> permissive) is also
exercised end-to-end through the FastAPI dependency wiring.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test-applicability.sqlite"))
    monkeypatch.setenv("FACTOR_BACKEND", "csv")
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def _context() -> dict:
    return {
        "inventory_year": 2024,
        "gwp_set": "AR6",
        "source_attributes": {"country": "US", "egrid_subregion": "WECC"},
    }


def _electricity_activity(facility_id: str = "F1") -> dict:
    return {
        "facility_id": facility_id,
        "activity_type_id": "scope2_purchased_electricity_grid_mix",
        "activity": {"value": 1000.0, "unit": "kwh"},
    }


def _gasoline_activity(facility_id: str = "F1") -> dict:
    return {
        "facility_id": facility_id,
        "activity_type_id": "scope1_mobile_gasoline",
        "activity": {"value": 100.0, "unit": "gallon"},
    }


# ---------------------------------------------------------------------------
# Filtering — the headline behavior
# ---------------------------------------------------------------------------


def test_calculate_excludes_inapplicable_rows_from_results_and_summary(client: TestClient):
    """Activity not in the RU's applicability list is silently dropped."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                _electricity_activity("F1"),
                _gasoline_activity("F1"),
            ],
            "applicability": {
                "F1": ["scope2_purchased_electricity_grid_mix"],
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    # Only electricity rows survived; gasoline silently dropped.
    facility_activity_pairs = {
        (r["facility_id"], r["activity_type_id"]) for r in body["results"]
    }
    assert facility_activity_pairs == {("F1", "scope2_purchased_electricity_grid_mix")}
    # Summary keys are scoped to surviving rows too.
    for key in body["summary"]:
        assert "scope1_mobile_gasoline" not in key
    # Filtering does not produce errors.
    assert body["errors"] == []


def test_calculate_audit_excludes_inapplicable_rows_from_audit(client: TestClient):
    response = client.post(
        "/calculate/audit",
        json={
            "context": _context(),
            "activities": [
                _electricity_activity("F1"),
                _gasoline_activity("F1"),
            ],
            "applicability": {
                "F1": ["scope2_purchased_electricity_grid_mix"],
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    activity_types_in_audit = {row["activity_type_id"] for row in body["audit_rows"]}
    assert activity_types_in_audit == {"scope2_purchased_electricity_grid_mix"}


def test_legacy_permissive_passes_everything_through(client: TestClient):
    """Empty list for an RU = legacy permissive — every activity flows."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                _electricity_activity("F1"),
                _gasoline_activity("F1"),
            ],
            "applicability": {"F1": []},
        },
    )
    assert response.status_code == 200
    body = response.json()
    activity_types = {r["activity_type_id"] for r in body["results"]}
    assert activity_types == {
        "scope2_purchased_electricity_grid_mix",
        "scope1_mobile_gasoline",
    }


def test_unknown_ru_in_payload_is_permissive(client: TestClient):
    """Activities pointing at an RU that isn't in the map keep flowing."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [_electricity_activity("F_unknown")],
            "applicability": {"F_other": ["scope1_mobile_gasoline"]},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) >= 1


def test_field_omitted_uses_permissive_default_when_no_project(client: TestClient):
    """No ``applicability`` and no ``project_id`` -> legacy permissive,
    nothing dropped, identical to pre-PR-B behavior."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [_electricity_activity()],
        },
    )
    assert response.status_code == 200
    assert len(response.json()["results"]) >= 1


def test_empty_applicability_dict_is_explicit_permissive(client: TestClient):
    """``{}`` is the explicit "no rules" case — distinct from a missing
    field but yields the same behavior here (no per-RU restrictions)."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                _electricity_activity("F1"),
                _gasoline_activity("F1"),
            ],
            "applicability": {},
        },
    )
    assert response.status_code == 200
    activity_types = {r["activity_type_id"] for r in response.json()["results"]}
    assert activity_types == {
        "scope2_purchased_electricity_grid_mix",
        "scope1_mobile_gasoline",
    }


def test_all_filtered_returns_200_with_empty_results_no_errors(client: TestClient):
    """Every activity gets dropped -> 200 with empty results and empty
    errors. No "total failure" envelope, because nothing failed."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [_electricity_activity("F1"), _gasoline_activity("F1")],
            "applicability": {"F1": ["scope3_business_travel_rental_vehicle"]},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == []
    assert body["errors"] == []
    assert body["summary"] == {}
    assert body["partial_success"] is False


# ---------------------------------------------------------------------------
# Original-index preservation for engine errors
# ---------------------------------------------------------------------------


def test_kept_activity_calc_error_preserves_original_payload_index(client: TestClient):
    """When the filter drops index 0 and index 1 hits a real engine
    error, the error must report ``activity_index=1`` (the user's
    original payload index), not ``0`` (the post-filter index)."""

    response = client.post(
        "/calculate",
        json={
            "context": _context(),
            "activities": [
                # Index 0: dropped by applicability — never reaches engine.
                _gasoline_activity("F1"),
                # Index 1: kept; deliberately invalid activity_type_id so
                # the engine raises ``unknown_activity_type``.
                {
                    "facility_id": "F1",
                    "activity_type_id": "this_activity_type_does_not_exist",
                    "activity": {"value": 1.0, "unit": "kwh"},
                },
            ],
            "applicability": {
                "F1": ["this_activity_type_does_not_exist"],
            },
        },
    )
    body = response.json()
    assert len(body["errors"]) == 1
    assert body["errors"][0]["activity_index"] == 1
    assert body["errors"][0]["error_code"] == "unknown_activity_type"
