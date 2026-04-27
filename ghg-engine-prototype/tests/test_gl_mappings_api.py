"""Phase E1 — GL mapping API endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test-ghg-projects.sqlite"))
    monkeypatch.setenv("FACTOR_BACKEND", "csv")
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def _create_project(client: TestClient, name: str = "ACME 2024") -> str:
    resp = client.post("/projects", json={"name": name, "inventory_year": 2024})
    assert resp.status_code == 200, resp.text
    return resp.json()["project_id"]


def test_get_gl_mappings_empty_for_new_project(client: TestClient):
    project_id = _create_project(client)
    resp = client.get(f"/projects/{project_id}/gl-mappings")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_gl_mappings_404_for_unknown_project(client: TestClient):
    resp = client.get("/projects/prj_does_not_exist/gl-mappings")
    assert resp.status_code == 404


def test_put_gl_mappings_replaces_atomically(client: TestClient):
    project_id = _create_project(client)
    initial = client.put(
        f"/projects/{project_id}/gl-mappings",
        json={
            "mappings": [
                {"reporting_unit_id": None, "gl_code": "G1", "factor_id": "useeio:541110"},
                {"reporting_unit_id": None, "gl_code": "G2", "factor_id": "useeio:541200"},
                {"reporting_unit_id": "ru_branch", "gl_code": "G1", "factor_id": "useeio:541900"},
            ]
        },
    )
    assert initial.status_code == 200
    rows = initial.json()
    assert len(rows) == 3
    factors = {(r["reporting_unit_id"], r["gl_code"]): r["factor_id"] for r in rows}
    assert factors[(None, "G1")] == "useeio:541110"
    assert factors[(None, "G2")] == "useeio:541200"
    assert factors[("ru_branch", "G1")] == "useeio:541900"

    # Replace with a smaller list — atomic, so the old G2 row is gone.
    second = client.put(
        f"/projects/{project_id}/gl-mappings",
        json={
            "mappings": [
                {"reporting_unit_id": None, "gl_code": "G1", "factor_id": "exiobase:p52"},
            ]
        },
    )
    assert second.status_code == 200
    rows = second.json()
    assert len(rows) == 1
    assert rows[0]["factor_id"] == "exiobase:p52"

    listing = client.get(f"/projects/{project_id}/gl-mappings").json()
    assert len(listing) == 1
    assert listing[0]["gl_code"] == "G1"


def test_put_gl_mappings_404_for_unknown_project(client: TestClient):
    resp = client.put(
        "/projects/prj_does_not_exist/gl-mappings",
        json={"mappings": []},
    )
    assert resp.status_code == 404


def test_put_gl_mappings_400_for_blank_factor(client: TestClient):
    project_id = _create_project(client)
    resp = client.put(
        f"/projects/{project_id}/gl-mappings",
        json={"mappings": [{"gl_code": "G1", "factor_id": ""}]},
    )
    assert resp.status_code == 400


def test_get_gl_mappings_filtered_by_reporting_unit(client: TestClient):
    project_id = _create_project(client)
    client.put(
        f"/projects/{project_id}/gl-mappings",
        json={
            "mappings": [
                {"reporting_unit_id": None, "gl_code": "G1", "factor_id": "useeio:541110"},
                {"reporting_unit_id": "ru_branch", "gl_code": "G1", "factor_id": "useeio:541900"},
                {"reporting_unit_id": "ru_branch", "gl_code": "G2", "factor_id": "useeio:541200"},
            ]
        },
    )
    branch_only = client.get(
        f"/projects/{project_id}/gl-mappings",
        params={"reporting_unit_id": "ru_branch"},
    )
    assert branch_only.status_code == 200
    rows = branch_only.json()
    assert {r["gl_code"] for r in rows} == {"G1", "G2"}
    assert all(r["reporting_unit_id"] == "ru_branch" for r in rows)

    project_default_only = client.get(
        f"/projects/{project_id}/gl-mappings",
        params={"reporting_unit_id": ""},
    )
    assert project_default_only.status_code == 200
    rows = project_default_only.json()
    assert len(rows) == 1
    assert rows[0]["reporting_unit_id"] is None
