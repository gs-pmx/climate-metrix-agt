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
