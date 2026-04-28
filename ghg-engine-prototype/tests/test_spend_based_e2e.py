"""Phase E1.5 — end-to-end: ``/calculate`` resolves spend rows.

Exercises the orchestrator's ``eqm_context_builder`` wiring. Each test
spins up a TestClient with the SQLite document factor backend, seeds a
spend factor, creates a project + GL mapping, then POSTs a spend
activity through ``/calculate`` and asserts the structured response.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build
from project_store import ProjectStore


SPEND_FACTOR_ID = "useeio:541110"
SPEND_FACTOR_VALUE = 0.12  # kg CO2e / USD


@pytest.fixture()
def client_and_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "test-ghg-projects.sqlite"
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("FACTOR_BACKEND", "document")
    _build.cache_clear()
    store = ProjectStore(db_path)
    store.factors.import_spend_factors(
        dataset_key="useeio_v1_4_0",
        source_name="USEEIO",
        version_label="USEEIO v1.4.0 test",
        factors=[
            {
                "source_record_key": SPEND_FACTOR_ID,
                "factor_type": "541110",
                "description": "Legal services",
                "value": SPEND_FACTOR_VALUE,
                "unit_label": "kg/USD",
                "unit_numerator": "kg",
                "unit_denominator": "USD",
                "data_year": 2022,
                "region": "US",
                "country": "USA",
                "source_id": "USEEIO",
            },
        ],
        publish=True,
    )
    with TestClient(create_app()) as test_client:
        yield test_client, store
    _build.cache_clear()


def _create_project(client: TestClient, *, year: int = 2022) -> str:
    resp = client.post("/projects", json={"name": "ACME", "inventory_year": year})
    assert resp.status_code == 200, resp.text
    return resp.json()["project_id"]


def _add_gl_mapping(client: TestClient, project_id: str, gl_code: str, factor_id: str):
    resp = client.put(
        f"/projects/{project_id}/gl-mappings",
        json={"mappings": [{"reporting_unit_id": None, "gl_code": gl_code, "factor_id": factor_id}]},
    )
    assert resp.status_code == 200, resp.text


def _spend_activity(*, gl_code: str, spend: float = 1000.0, year: int = 2022) -> dict:
    return {
        "facility_id": "ru1",
        "activity_type_id": "scope3_spend_based",
        "activity": {"value": spend, "unit": "USD"},
        "params": {"gl_code": gl_code, "transaction_year": year},
    }


def _context(year: int = 2022) -> dict:
    return {"inventory_year": year, "gwp_set": "AR6"}


def test_calculate_spend_based_succeeds_when_project_has_mapping(client_and_store):
    client, _ = client_and_store
    project_id = _create_project(client)
    _add_gl_mapping(client, project_id, "G123", SPEND_FACTOR_ID)

    response = client.post(
        "/calculate",
        json={
            "project_id": project_id,
            "context": _context(),
            "activities": [_spend_activity(gl_code="G123", spend=1000.0)],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["errors"] == []
    assert body["partial_success"] is False
    assert len(body["results"]) == 1
    result = body["results"][0]
    assert result["activity_type_id"] == "scope3_spend_based"
    assert result["facility_id"] == "ru1"
    assert result["scope"] == "Scope 3"
    assert result["unit"] == "kg"
    assert result["value"] == pytest.approx(SPEND_FACTOR_VALUE * 1000.0, rel=1e-6)


def test_calculate_spend_based_unmapped_gl_code_surfaces_structured_error(client_and_store):
    client, _ = client_and_store
    project_id = _create_project(client)
    # Project exists but no mapping for G_UNKNOWN.
    response = client.post(
        "/calculate",
        json={
            "project_id": project_id,
            "context": _context(),
            "activities": [_spend_activity(gl_code="G_UNKNOWN")],
        },
    )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["results"] == []
    assert len(body["errors"]) == 1
    err = body["errors"][0]
    assert err["error_code"] == "unmapped_gl_code"
    assert err["details"]["gl_code"] == "G_UNKNOWN"


def test_calculate_spend_based_per_ru_mapping_overrides_project_default(client_and_store):
    client, store = client_and_store
    project_id = _create_project(client)
    # Seed a second factor so we can tell which mapping actually fired.
    other_factor_id = "useeio:541900"
    other_value = 0.50
    store.factors.import_spend_factors(
        dataset_key="useeio_v1_4_0",
        source_name="USEEIO",
        version_label="USEEIO v1.4.0 test",
        factors=[
            {
                "source_record_key": other_factor_id,
                "factor_type": "541900",
                "description": "Other professional",
                "value": other_value,
                "unit_label": "kg/USD",
                "unit_numerator": "kg",
                "unit_denominator": "USD",
                "data_year": 2022,
                "region": "US",
                "country": "USA",
                "source_id": "USEEIO",
            },
        ],
        publish=True,
    )
    resp = client.put(
        f"/projects/{project_id}/gl-mappings",
        json={
            "mappings": [
                {"reporting_unit_id": None, "gl_code": "G123", "factor_id": SPEND_FACTOR_ID},
                {"reporting_unit_id": "ru_branch", "gl_code": "G123", "factor_id": other_factor_id},
            ]
        },
    )
    assert resp.status_code == 200, resp.text

    # Activity scoped to ru_branch — per-RU override should win.
    response = client.post(
        "/calculate",
        json={
            "project_id": project_id,
            "context": _context(),
            "activities": [
                {
                    "facility_id": "ru_branch",
                    "activity_type_id": "scope3_spend_based",
                    "activity": {"value": 1000.0, "unit": "USD"},
                    "params": {"gl_code": "G123", "transaction_year": 2022},
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["errors"] == []
    assert len(body["results"]) == 1
    assert body["results"][0]["value"] == pytest.approx(other_value * 1000.0, rel=1e-6)
