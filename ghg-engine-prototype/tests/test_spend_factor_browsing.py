"""Phase E1 — /catalog/spend-factors browse endpoint."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build
from project_store import ProjectStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db_path = tmp_path / "test-ghg-projects.sqlite"
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("FACTOR_BACKEND", "csv")
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        # Seed two synthetic spend-based factors so the endpoint has data
        # to return. Tests run against a tmp DB, so we drive the seed
        # directly via the ProjectStore helpers.
        store = ProjectStore(db_path)
        store.factors.import_spend_factors(
            dataset_key="useeio_v1_4_0",
            source_name="USEEIO",
            version_label="USEEIO v1.4.0 test",
            factors=[
                {
                    "source_record_key": "useeio:541110",
                    "factor_type": "541110",
                    "description": "Legal services",
                    "value": 0.12,
                    "unit_label": "kg/USD",
                    "data_year": 2022,
                    "region": "US",
                    "country": "USA",
                    "source_id": "USEEIO",
                },
                {
                    "source_record_key": "useeio:541900",
                    "factor_type": "541900",
                    "description": "Other professional services",
                    "value": 0.08,
                    "unit_label": "kg/USD",
                    "data_year": 2022,
                    "region": "US",
                    "country": "USA",
                    "source_id": "USEEIO",
                },
            ],
        )
        store.factors.import_spend_factors(
            dataset_key="exiobase_3_8_2_pxp_2022",
            source_name="EXIOBASE",
            version_label="EXIOBASE 3.8.2 test",
            factors=[
                {
                    "source_record_key": "exiobase:GLOBAL:p52",
                    "factor_type": "p52",
                    "description": "Retail trade services",
                    "value": 0.04,
                    "unit_label": "kg/EUR",
                    "data_year": 2022,
                    "region": "GLOBAL",
                    "source_id": "EXIOBASE",
                },
            ],
        )
        yield test_client
    _build.cache_clear()


def test_spend_factors_default_returns_all_spend(client: TestClient):
    resp = client.get("/catalog/spend-factors")
    assert resp.status_code == 200
    rows = resp.json()
    keys = {row["source_record_key"] for row in rows}
    assert "useeio:541110" in keys
    assert "useeio:541900" in keys
    assert "exiobase:GLOBAL:p52" in keys
    assert all(row["factor_kind"] == "spend" for row in rows)


def test_spend_factors_filter_by_dataset_id(client: TestClient):
    # First fetch a row to get its dataset_id; the synthetic seed uses
    # auto-generated ids so we don't hardcode them.
    rows = client.get("/catalog/spend-factors").json()
    useeio_dataset_id = next(
        row["dataset_id"] for row in rows if row["source_record_key"].startswith("useeio:")
    )
    filtered = client.get(
        "/catalog/spend-factors", params={"dataset_id": useeio_dataset_id}
    ).json()
    assert filtered, "expected at least one row for the filtered dataset"
    assert all(row["dataset_id"] == useeio_dataset_id for row in filtered)
    assert all(row["source_record_key"].startswith("useeio:") for row in filtered)


def test_spend_factors_query_substring_search(client: TestClient):
    resp = client.get("/catalog/spend-factors", params={"query": "retail"})
    assert resp.status_code == 200
    rows = resp.json()
    assert any("Retail" in (row.get("description") or "") for row in rows)


def test_spend_factors_returns_unit_and_year(client: TestClient):
    rows = client.get("/catalog/spend-factors", params={"query": "Legal"}).json()
    assert rows
    legal = rows[0]
    assert legal["unit_label"] in {"kg/USD", "kg/EUR"}
    assert legal["data_year"] == 2022
    assert legal["value"] > 0
