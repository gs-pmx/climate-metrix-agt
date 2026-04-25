"""HTTP-level tests for the Phase D1 autosave draft endpoints.

Mirrors the pattern in :mod:`tests.test_catalog_api`: spin up a real
``TestClient`` against an isolated SQLite file per test, exercise the
GET / POST / DELETE draft routes, and confirm the explicit-version save
clears the draft.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "draft-api.sqlite"))
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def _empty_snapshot() -> dict:
    return {
        "snapshot_version": 2,
        "facilities": [
            {
                "id": "F1",
                "facility_name": "Facility 1",
                "applicable_activity_types": ["scope1_mobile_gasoline"],
            }
        ],
        "activities": [
            {
                "id": "a1",
                "facility_id": "F1",
                "activity_type_id": "scope1_mobile_gasoline",
                "activity": {"value": 7.5, "unit": "gallon"},
                "params": {},
            }
        ],
        "result_rows": [],
        "summary_rows": [],
        "trace_rows": [],
        "audit_rows": [],
    }


def _create_project(client: TestClient, name: str = "Draft API Project") -> str:
    response = client.post(
        "/projects",
        json={"name": name, "inventory_year": 2024},
    )
    assert response.status_code == 200, response.text
    return response.json()["project_id"]


def test_get_draft_returns_404_when_no_draft_exists(client: TestClient):
    project_id = _create_project(client)

    response = client.get(f"/projects/{project_id}/draft")
    assert response.status_code == 404


def test_post_then_get_draft_returns_matching_payload(client: TestClient):
    project_id = _create_project(client)

    save_response = client.post(
        f"/projects/{project_id}/draft",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
        },
    )
    assert save_response.status_code == 200, save_response.text
    saved = save_response.json()
    assert saved["project_id"] == project_id
    assert saved["updated_at"]

    get_response = client.get(f"/projects/{project_id}/draft")
    assert get_response.status_code == 200, get_response.text
    body = get_response.json()
    assert body["project_id"] == project_id
    assert body["inventory_year"] == 2024
    assert body["gwp_set"] == "AR6"
    assert body["include_trace"] is True
    units = body["snapshot"]["facilities"]
    assert len(units) == 1
    assert units[0]["facility_name"] == "Facility 1"
    assert units[0]["applicable_activity_types"] == ["scope1_mobile_gasoline"]
    activities = body["snapshot"]["activities"]
    assert len(activities) == 1
    assert activities[0]["activity"]["value"] == 7.5


def test_post_draft_then_save_version_clears_draft(client: TestClient):
    """An explicit version save deletes the draft so GET returns 404."""

    project_id = _create_project(client)

    client.post(
        f"/projects/{project_id}/draft",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
        },
    )

    save_version_response = client.post(
        f"/projects/{project_id}/versions",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
            "note": "explicit",
        },
    )
    assert save_version_response.status_code == 200, save_version_response.text

    get_response = client.get(f"/projects/{project_id}/draft")
    assert get_response.status_code == 404


def test_delete_draft_is_idempotent(client: TestClient):
    project_id = _create_project(client)

    # Delete with no draft present succeeds.
    response = client.delete(f"/projects/{project_id}/draft")
    assert response.status_code == 200
    assert response.json()["status"] == "deleted"

    # Save then delete then GET returns 404.
    client.post(
        f"/projects/{project_id}/draft",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
        },
    )
    response = client.delete(f"/projects/{project_id}/draft")
    assert response.status_code == 200
    assert client.get(f"/projects/{project_id}/draft").status_code == 404


def test_post_draft_unknown_project_returns_404(client: TestClient):
    response = client.post(
        "/projects/prj_does_not_exist/draft",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
        },
    )
    assert response.status_code == 404


def test_post_draft_upserts_one_row(client: TestClient):
    project_id = _create_project(client)

    first = client.post(
        f"/projects/{project_id}/draft",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": True,
            "snapshot": _empty_snapshot(),
        },
    ).json()
    assert first["updated_at"]

    # Second save with different metadata replaces the row in place.
    second = client.post(
        f"/projects/{project_id}/draft",
        json={
            "inventory_year": 2025,
            "gwp_set": "AR5",
            "include_trace": False,
            "snapshot": _empty_snapshot(),
        },
    ).json()
    assert second["project_id"] == project_id

    body = client.get(f"/projects/{project_id}/draft").json()
    assert body["inventory_year"] == 2025
    assert body["gwp_set"] == "AR5"
    assert body["include_trace"] is False
