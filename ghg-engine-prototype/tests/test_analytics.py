"""Tests for the Phase D3 analytics endpoint and service module.

Two layers:

* Service-layer (``compute_project_analytics``) tests build a real
  SQLite ``ProjectStore``, persist a snapshot with calculation results,
  then call the function directly. This locks the SQL aggregation
  semantics (group-by grain, filters, biogenic exclusion, scope sums).

* HTTP-layer tests drive the FastAPI ``TestClient`` through
  ``GET /projects/{id}/analytics`` and confirm the wire shape and
  the 404 handling for unknown project/version combinations.

The CO2e rollup assumption (Option A — every EQM emits a co2e row) is
locked by ``test_co2e_only_rollup_assumption_holds_for_all_runtime_eqms``
which exercises the canonical EQM via ``GHGEngine`` and asserts a co2e
row is present.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import _build, get_activity_catalog
from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import (
    ActivityDraft,
    ActivityRecord,
    CalculationContext,
    ProjectSnapshot,
    ResultRecord,
)
from ghg_engine.services.analytics import compute_project_analytics
from project_store import ProjectStore

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def activity_catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(ROOT / "data" / "activity_types.json")


@pytest.fixture()
def store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(tmp_path / "analytics.sqlite")


@pytest.fixture()
def client_api_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DB_PATH", str(tmp_path / "state" / "runtime.sqlite"))
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(tmp_path / "missing-frontend-dist"))
    _build.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    _build.cache_clear()


def _make_result_row(
    *,
    facility_id: str,
    activity_type_id: str,
    activity_label: str,
    scope: str,
    gas: str,
    value: float,
    is_biogenic: bool = False,
    accounting_method: str = "none",
) -> ResultRecord:
    return ResultRecord(
        facility_id=facility_id,
        activity_type_id=activity_type_id,
        activity_label=activity_label,
        scope=scope,
        protocol_category_code=None,
        protocol_category_label=None,
        activity_group=None,
        source_type=None,
        accounting_method=accounting_method,
        gas=gas,
        value=value,
        unit="kg",
        is_biogenic=is_biogenic,
        method_id="direct_factor",
        factor_ids=["fx_test"],
    )


def _persist_snapshot(
    store: ProjectStore,
    *,
    project_id: str,
    project_name: str,
    inventory_year: int,
    facilities: list[dict],
    activity_drafts: list[ActivityDraft],
    result_rows: list[ResultRecord],
) -> dict:
    store.create_project(
        project_id=project_id,
        name=project_name,
        inventory_year=inventory_year,
    )
    snapshot = ProjectSnapshot(
        facilities=facilities,
        activities=activity_drafts,
        result_rows=result_rows,
    )
    return store.save_project_snapshot(
        project_id=project_id,
        inventory_year=inventory_year,
        gwp_set="AR6",
        include_trace=False,
        snapshot=snapshot,
    )


# ---------------------------------------------------------------------------
# Service-layer tests
# ---------------------------------------------------------------------------


def test_empty_version_returns_no_rows_zero_total_zero_facility_count(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """A version with no calculation_results rows returns an empty
    AnalyticsResult, not None. None is reserved for "no version exists"
    so the API can map it cleanly to 404."""
    _persist_snapshot(
        store,
        project_id="prj_empty",
        project_name="Empty Project",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activity_drafts=[],
        result_rows=[],
    )
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_empty",
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert result is not None
    assert result.rows == []
    assert result.total_co2e_kg == 0.0
    assert result.facility_count == 0
    assert result.inventory_year == 2024


def test_single_facility_single_activity_co2e_aggregates_correctly(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """The simplest happy path: one facility, one activity, one co2e
    row. The analytics row carries that value verbatim and the headline
    total matches."""
    _persist_snapshot(
        store,
        project_id="prj_single",
        project_name="Single Activity",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "Main Office"}],
        activity_drafts=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
            )
        ],
        result_rows=[
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Owned Vehicle Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=88.0,
            )
        ],
    )
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_single",
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert result is not None
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.facility_id == "F1"
    assert row.facility_name == "Main Office"
    assert row.scope == "Scope 1"
    assert row.activity_type_id == "scope1_mobile_gasoline"
    assert row.co2e_kg == pytest.approx(88.0)
    # The catalog supplies category from the in-memory map.
    assert row.category == "Transportation"
    assert result.total_co2e_kg == pytest.approx(88.0)
    assert result.facility_count == 1


def test_per_gas_rows_are_excluded_only_co2e_counted(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """Per-gas rows (co2/ch4/n2o) live alongside the co2e row in the
    canonical table — that's how EQMs persist them. Analytics must filter
    to ``gas='co2e'`` so we don't double-count.

    This test plants a co2e row of 100 plus a co2 row of 60 and a ch4
    row of 0.5 and asserts the total is 100, not 160.5.
    """
    _persist_snapshot(
        store,
        project_id="prj_pergas",
        project_name="Per-Gas Rows",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activity_drafts=[],
        result_rows=[
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Mobile Gasoline",
                scope="Scope 1",
                gas="co2",
                value=60.0,
            ),
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Mobile Gasoline",
                scope="Scope 1",
                gas="ch4",
                value=0.5,
            ),
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Mobile Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=100.0,
            ),
        ],
    )
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_pergas",
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert result is not None
    assert len(result.rows) == 1
    assert result.rows[0].co2e_kg == pytest.approx(100.0)
    assert result.total_co2e_kg == pytest.approx(100.0)


def test_multi_facility_multi_activity_multi_scope_aggregation(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """Stress the group-by: two facilities, three activities across
    Scope 1 and Scope 2, plus a duplicate row to exercise the SUM."""
    _persist_snapshot(
        store,
        project_id="prj_multi",
        project_name="Multi-Facility",
        inventory_year=2024,
        facilities=[
            {"id": "F1", "facility_name": "Headquarters"},
            {"id": "F2", "facility_name": "Warehouse"},
        ],
        activity_drafts=[],
        result_rows=[
            # F1 Scope 1 — two months of mobile gasoline summed
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Mobile Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=100.0,
            ),
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Mobile Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=50.0,
            ),
            # F1 Scope 2 — purchased electricity
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope2_purchased_electricity_grid_mix",
                activity_label="Purchased Electricity",
                scope="Scope 2",
                gas="co2e",
                value=200.0,
                accounting_method="location_based",
            ),
            # F2 Scope 1 — stationary natural gas
            _make_result_row(
                facility_id="F2",
                activity_type_id="scope1_stationary_natural_gas",
                activity_label="Stationary Natural Gas",
                scope="Scope 1",
                gas="co2e",
                value=300.0,
            ),
        ],
    )
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_multi",
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert result is not None
    by_key = {(row.facility_id, row.activity_type_id, row.scope): row for row in result.rows}
    f1_gasoline = by_key[("F1", "scope1_mobile_gasoline", "Scope 1")]
    f1_electricity = by_key[("F1", "scope2_purchased_electricity_grid_mix", "Scope 2")]
    f2_gas = by_key[("F2", "scope1_stationary_natural_gas", "Scope 1")]
    # F1 mobile rows are summed across the same group cell.
    assert f1_gasoline.co2e_kg == pytest.approx(150.0)
    assert f1_gasoline.facility_name == "Headquarters"
    assert f1_electricity.co2e_kg == pytest.approx(200.0)
    assert f2_gas.co2e_kg == pytest.approx(300.0)
    assert f2_gas.facility_name == "Warehouse"
    assert result.total_co2e_kg == pytest.approx(650.0)
    assert result.facility_count == 2


def test_default_version_id_resolves_to_latest(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """When ``version_id`` is None the service must resolve to the
    most-recent inventory version. We save two versions back-to-back
    and assert the analytics output reflects the second one."""
    project_id = "prj_versions"
    store.create_project(project_id=project_id, name="Versioned", inventory_year=2024)

    # Version 1: 100 kg total
    snapshot_1 = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activities=[],
        result_rows=[
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=100.0,
            )
        ],
    )
    saved_1 = store.save_project_snapshot(
        project_id=project_id,
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=False,
        snapshot=snapshot_1,
    )

    # Version 2: 250 kg total
    snapshot_2 = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activities=[],
        result_rows=[
            _make_result_row(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Gasoline",
                scope="Scope 1",
                gas="co2e",
                value=250.0,
            )
        ],
    )
    saved_2 = store.save_project_snapshot(
        project_id=project_id,
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=False,
        snapshot=snapshot_2,
    )
    assert saved_2["version_number"] > saved_1["version_number"]

    # Default (None) resolves to the latest — version 2's total.
    latest = compute_project_analytics(
        db_path=store._db_path,
        project_id=project_id,
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert latest is not None
    assert latest.total_co2e_kg == pytest.approx(250.0)


def test_unknown_project_returns_none(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """The service returns None for unknown projects so the API maps
    cleanly to 404 without fishing through exception types."""
    # Create a project so the store is non-empty (catches a bug where we
    # might accidentally short-circuit on table-empty).
    _persist_snapshot(
        store,
        project_id="prj_other",
        project_name="Other",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activity_drafts=[],
        result_rows=[],
    )
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_does_not_exist",
        version_id=None,
        activity_catalog=activity_catalog,
    )
    assert result is None


def test_unknown_version_id_returns_none_even_for_known_project(
    store: ProjectStore, activity_catalog: ActivityCatalog
):
    """Asking for a version_id that exists in the DB but belongs to a
    different project must still return None — version IDs are scoped
    to the (project, version) pair."""
    saved = _persist_snapshot(
        store,
        project_id="prj_a",
        project_name="A",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activity_drafts=[],
        result_rows=[],
    )
    # Save a second project with its own version_id.
    saved_b = _persist_snapshot(
        store,
        project_id="prj_b",
        project_name="B",
        inventory_year=2024,
        facilities=[{"id": "F1", "facility_name": "F1"}],
        activity_drafts=[],
        result_rows=[],
    )
    # Get the inventory_version_id for project B.
    with store._connect() as conn:
        b_inventory_version = conn.execute(
            """
            SELECT inventory_version_id
            FROM inventory_versions
            WHERE project_id = ?
            """,
            ("prj_b",),
        ).fetchone()
    assert b_inventory_version is not None
    foreign_version_id = int(b_inventory_version["inventory_version_id"])

    # Looking up B's version under project A must return None.
    result = compute_project_analytics(
        db_path=store._db_path,
        project_id="prj_a",
        version_id=foreign_version_id,
        activity_catalog=activity_catalog,
    )
    assert result is None


def test_co2e_only_rollup_assumption_holds_for_all_runtime_eqms():
    """Lock the Option-A assumption: every runtime EQM emits a
    ``gas='co2e'`` row. If a future EQM lands without one, this test
    fails loudly and the caller can decide whether to switch to a
    GWP-weighted rollup or to update the EQM.

    We exercise a representative activity that touches the
    DirectFactor/Scope2/Refrigerant code paths and assert the result
    set always contains a co2e row.
    """
    catalog = ActivityCatalog.from_json(ROOT / "data" / "activity_types.json")
    factors = FactorRepository.from_csv(str(ROOT / "data" / "factors.csv"))
    engine = GHGEngine(catalog, factors)

    cases = [
        # DirectFactor — emits per-gas + computed co2e
        ActivityRecord(
            facility_id="F1",
            activity_type_id="scope1_mobile_gasoline",
            activity={"value": 10.0, "unit": "gallon"},
        ),
        # Scope2Energy — delegates to DirectFactor
        ActivityRecord(
            facility_id="F1",
            activity_type_id="scope2_purchased_electricity_grid_mix",
            activity={"value": 1000.0, "unit": "kwh"},
        ),
    ]
    ctx = CalculationContext(inventory_year=2024, gwp_set="AR6")
    for activity in cases:
        rows, _, _ = engine.calculate([activity], ctx)
        gases = {row.gas for row in rows}
        assert "co2e" in gases, (
            f"EQM for {activity.activity_type_id} did not emit a co2e row; "
            "the Option-A rollup assumption in services/analytics.py is broken."
        )


# ---------------------------------------------------------------------------
# HTTP-layer tests
# ---------------------------------------------------------------------------


def _post_save_snapshot(
    client: TestClient,
    project_id: str,
    *,
    inventory_year: int,
    facilities: list[dict],
    result_rows: list[dict],
) -> dict:
    payload = {
        "inventory_year": inventory_year,
        "gwp_set": "AR6",
        "include_trace": False,
        "snapshot": {
            "snapshot_version": 2,
            "facilities": facilities,
            "activities": [],
            "result_rows": result_rows,
            "summary_rows": [],
            "trace_rows": [],
            "audit_rows": [],
        },
        "note": None,
    }
    response = client.post(f"/api/projects/{project_id}/versions", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_analytics_endpoint_returns_200_with_aggregated_rows(client_api_only: TestClient):
    project = client_api_only.post(
        "/api/projects",
        json={"name": "HTTP Analytics", "inventory_year": 2024},
    ).json()
    project_id = project["project_id"]

    _post_save_snapshot(
        client_api_only,
        project_id,
        inventory_year=2024,
        facilities=[
            {
                "id": "F1",
                "facility_name": "Main Office",
                "location": "",
                "region": "",
                "country": "US",
                "state": "",
                "egrid_subregion": "",
                "reporting_group": "",
                "owned_leased": "Owned",
                "applicable_activity_types": [],
            }
        ],
        result_rows=[
            {
                "facility_id": "F1",
                "activity_type_id": "scope1_mobile_gasoline",
                "activity_label": "Mobile Gasoline",
                "scope": "Scope 1",
                "protocol_category_code": None,
                "protocol_category_label": None,
                "activity_group": None,
                "source_type": None,
                "accounting_method": "none",
                "gas": "co2e",
                "value": 88.0,
                "unit": "kg",
                "is_biogenic": False,
                "method_id": "direct_factor",
                "factor_ids": ["fx"],
            }
        ],
    )

    response = client_api_only.get(f"/api/projects/{project_id}/analytics")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_co2e_kg"] == pytest.approx(88.0)
    assert body["facility_count"] == 1
    assert body["inventory_year"] == 2024
    assert isinstance(body["version_id"], int)
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["facility_id"] == "F1"
    assert row["facility_name"] == "Main Office"
    assert row["scope"] == "Scope 1"
    assert row["co2e_kg"] == pytest.approx(88.0)
    # The category is supplied from the catalog (Transportation for
    # ``scope1_mobile_gasoline``).
    assert row["category"] == "Transportation"


def test_analytics_endpoint_404_on_unknown_project(client_api_only: TestClient):
    response = client_api_only.get("/api/projects/prj_does_not_exist/analytics")
    assert response.status_code == 404


def test_analytics_endpoint_404_on_unknown_version_id(client_api_only: TestClient):
    project = client_api_only.post(
        "/api/projects",
        json={"name": "Has Project No Version", "inventory_year": 2024},
    ).json()
    project_id = project["project_id"]
    response = client_api_only.get(
        f"/api/projects/{project_id}/analytics?version_id=99999"
    )
    assert response.status_code == 404
