from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client_with_frontend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    frontend_dist = tmp_path / "frontend-dist"
    assets_dir = frontend_dist / "assets"
    assets_dir.mkdir(parents=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html><body>spa-shell</body></html>", encoding="utf-8")
    (assets_dir / "app.js").write_text("console.log('spa asset');", encoding="utf-8")
    monkeypatch.setenv("DB_PATH", str(tmp_path / "state" / "runtime.sqlite"))
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(frontend_dist))
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


@pytest.fixture()
def client_api_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "state" / "runtime.sqlite"))
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(tmp_path / "missing-frontend-dist"))
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def test_healthz_returns_ok(client_api_only: TestClient):
    response = client_api_only.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_only_mode_leaves_root_unserved(client_api_only: TestClient):
    response = client_api_only.get("/")

    assert response.status_code == 404


def test_frontend_dist_serves_root_and_assets(client_with_frontend: TestClient):
    root = client_with_frontend.get("/")
    asset = client_with_frontend.get("/assets/app.js")

    assert root.status_code == 200
    assert "spa-shell" in root.text
    assert asset.status_code == 200
    assert "spa asset" in asset.text


def test_frontend_dist_falls_back_to_index_for_deep_links(client_with_frontend: TestClient):
    response = client_with_frontend.get("/projects/demo")

    assert response.status_code == 200
    assert "spa-shell" in response.text


def test_spa_fallback_does_not_override_unknown_api_paths(client_with_frontend: TestClient):
    response = client_with_frontend.get("/api/not-a-route")

    assert response.status_code == 404


def test_docs_remain_available_when_frontend_is_served(client_with_frontend: TestClient):
    response = client_with_frontend.get("/docs")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_save_and_load_version_round_trips_reporting_unit_display_name(
    client_api_only: TestClient,
):
    """Bug 5 regression: a frontend-style save payload (keyed ``facilities``
    with ``facility_name`` on each unit) must round-trip through SQLite and
    be returned to the frontend on load under the same ``facility_name``
    key. Before the fix the response used ``"name"``, causing the frontend
    to see blank display names and drop the unit from data-entry grids.
    """

    project = client_api_only.post(
        "/api/projects",
        json={"name": "Round Trip", "inventory_year": 2024},
    ).json()
    project_id = project["project_id"]

    frontend_style_snapshot = {
        "snapshot_version": 2,
        "facilities": [
            {
                "id": "ru_1",
                "facility_name": "Reporting Unit 1",
                "location": "Seattle, WA",
                "region": "",
                "country": "US",
                "state": "Washington",
                "egrid_subregion": "NWPP",
                "reporting_group": "",
                "owned_leased": "Owned",
                "applicable_activity_types": ["scope1_mobile_gasoline"],
            }
        ],
        "activities": [],
        "result_rows": [],
        "summary_rows": [],
        "trace_rows": [],
        "audit_rows": [],
    }

    save_response = client_api_only.post(
        f"/api/projects/{project_id}/versions",
        json={
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "include_trace": False,
            "snapshot": frontend_style_snapshot,
            "note": None,
        },
    )
    assert save_response.status_code == 200, save_response.text

    load_response = client_api_only.get(f"/api/projects/{project_id}/snapshot")
    assert load_response.status_code == 200, load_response.text
    body = load_response.json()

    facilities = body["snapshot"]["facilities"]
    assert len(facilities) == 1
    unit = facilities[0]
    # The frontend reads ``facility_name``; this is the bug-5 assertion.
    assert unit["facility_name"] == "Reporting Unit 1"
    assert unit["state"] == "Washington"
    assert unit["egrid_subregion"] == "NWPP"
    assert unit["applicable_activity_types"] == ["scope1_mobile_gasoline"]
    assert "name" not in unit
