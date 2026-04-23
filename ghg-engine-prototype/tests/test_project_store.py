from __future__ import annotations

import sqlite3
from pathlib import Path

from ghg_engine.infrastructure.sqlite_factors import SQLiteFactorStore
from ghg_engine.infrastructure.sqlite_inventory import SQLiteInventoryStore
from ghg_engine.infrastructure.sqlite_workspace import SQLiteWorkspaceDraftStore
from ghg_engine.models import (
    ActivityDraft,
    ProjectSnapshot,
    ReportingUnitDraft,
    ResultRecord,
    TraceRecord,
)
from project_store import ProjectService, ProjectStore


def test_project_store_saves_and_loads_workspace_snapshot_and_inventory_version(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(project_id="prj_test", name="Test Project", inventory_year=2024)

    snapshot = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
                params={},
            )
        ],
    )
    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
        note="typed snapshot",
    )

    loaded = store.get_version_snapshot(project["project_id"], version_number=saved["version_number"])
    assert loaded["snapshot"].snapshot_version == 2
    assert loaded["snapshot"].activities[0].activity_type_id == "scope1_mobile_gasoline"
    with store._connect() as conn:  # noqa: SLF001 - explicit verification of canonical inventory tables
        inventory = conn.execute(
            """
            SELECT inventory_version_id
            FROM inventory_versions
            WHERE workspace_version_id = ?
            """,
            (saved["version_id"],),
        ).fetchone()
        locus = conn.execute(
            """
            SELECT locus_id, facility_name
            FROM inventory_loci
            WHERE inventory_version_id = ?
            """,
            (inventory["inventory_version_id"],),
        ).fetchone()
        activity = conn.execute(
            """
            SELECT activity_type_id, quantity_value, quantity_unit
            FROM inventory_activities
            WHERE inventory_version_id = ?
            """,
            (inventory["inventory_version_id"],),
        ).fetchone()
        run_count = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM calculation_runs
            WHERE inventory_version_id = ?
            """,
            (inventory["inventory_version_id"],),
        ).fetchone()["c"]
    assert inventory is not None
    assert locus is not None
    assert locus["locus_id"] == "F1"
    assert locus["facility_name"] == "Facility 1"
    assert activity is not None
    assert activity["activity_type_id"] == "scope1_mobile_gasoline"
    assert activity["quantity_value"] == 10.0
    assert activity["quantity_unit"] == "gallon"
    assert run_count == 0


def test_project_store_preserves_incomplete_drafts_without_materializing_inventory_activities(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(project_id="prj_incomplete", name="Incomplete Drafts", inventory_year=2024)

    snapshot = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="draft_blank",
                facility_id="F1",
                activity_type_id="scope1_stationary_propane",
                activity={"value": None, "unit": ""},
                params={},
            )
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
        note="incomplete typed snapshot",
    )

    loaded = store.get_version_snapshot(project["project_id"], version_number=saved["version_number"])
    assert loaded["snapshot"].activities[0].activity.value is None
    with store._connect() as conn:  # noqa: SLF001 - verifying incomplete drafts are not canonicalized as observations
        inventory = conn.execute(
            "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
            (saved["version_id"],),
        ).fetchone()
        locus_count = conn.execute(
            "SELECT COUNT(*) AS c FROM inventory_loci WHERE inventory_version_id = ?",
            (inventory["inventory_version_id"],),
        ).fetchone()["c"]
        activity_count = conn.execute(
            "SELECT COUNT(*) AS c FROM inventory_activities WHERE inventory_version_id = ?",
            (inventory["inventory_version_id"],),
        ).fetchone()["c"]
    assert locus_count == 1
    assert activity_count == 0


def test_project_store_persists_calculation_runs_separately_from_workspace_snapshot(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(project_id="prj_calc", name="Calculated", inventory_year=2024)
    snapshot = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
                params={},
            )
        ],
        result_rows=[
            ResultRecord(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Owned Vehicle Gasoline",
                scope="Scope 1",
                protocol_category_code=None,
                protocol_category_label=None,
                activity_group="Mobile Combustion",
                source_type="gasoline",
                accounting_method="none",
                gas="co2e",
                value=88.0,
                unit="kg",
                is_biogenic=False,
                method_id="direct_factor",
                factor_ids=["factor_1"],
            )
        ],
        trace_rows=[
            TraceRecord(
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Owned Vehicle Gasoline",
                selected_method="direct_factor",
                factor_matches=["factor_1"],
            )
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
        note="calculated snapshot",
    )

    with store._connect() as conn:  # noqa: SLF001 - verifying calculation runs are separated from workspace storage
        inventory = conn.execute(
            "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
            (saved["version_id"],),
        ).fetchone()
        run = conn.execute(
            """
            SELECT run_id, engine_version
            FROM calculation_runs
            WHERE inventory_version_id = ?
            """,
            (inventory["inventory_version_id"],),
        ).fetchone()
        result = conn.execute(
            """
            SELECT gas, value, method_id
            FROM calculation_results
            WHERE run_id = ?
            """,
            (run["run_id"],),
        ).fetchone()
    assert run is not None
    assert run["engine_version"] == "workspace_snapshot"
    assert result is not None
    assert result["gas"] == "co2e"
    assert result["value"] == 88.0
    assert result["method_id"] == "direct_factor"


def test_schema_reset_migration_rebuilds_split_storage_tables(tmp_path: Path):
    db_path = tmp_path / "legacy.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            INSERT INTO schema_migrations (version, description, applied_at)
            VALUES (3, 'emission factor document store', '2026-01-01T00:00:00Z');

            CREATE TABLE projects (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                inventory_year INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO projects (project_id, name, inventory_year, created_at, updated_at)
            VALUES ('prj_old', 'Legacy', 2024, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

            CREATE TABLE project_versions (
                version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                inventory_year INTEGER NOT NULL,
                gwp_set TEXT NOT NULL,
                include_trace INTEGER NOT NULL,
                note TEXT,
                snapshot_json TEXT NOT NULL
            );
            INSERT INTO project_versions (
                project_id, version_number, created_at, inventory_year, gwp_set, include_trace, snapshot_json
            )
            VALUES ('prj_old', 1, '2026-01-01T00:00:00Z', 2024, 'AR6', 1, '{}');

            CREATE TABLE dim_date (
                date_id INTEGER PRIMARY KEY AUTOINCREMENT,
                calendar_date TEXT NOT NULL UNIQUE,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                day INTEGER NOT NULL
            );
            CREATE TABLE dim_entity (
                entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                facility_id TEXT,
                facility_name TEXT,
                source_id TEXT,
                source_label TEXT,
                country TEXT,
                state TEXT,
                egrid_subregion TEXT,
                reporting_group TEXT,
                owned_leased TEXT
            );
            CREATE TABLE dim_measure (
                measure_id INTEGER PRIMARY KEY AUTOINCREMENT,
                measure_type TEXT NOT NULL,
                unit TEXT,
                scope TEXT,
                metric_group TEXT,
                metric_subgroup TEXT,
                source_type TEXT,
                gas TEXT,
                accounting_method TEXT
            );
            CREATE TABLE fact_actuals (
                fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
                version_id INTEGER NOT NULL,
                date_id INTEGER NOT NULL,
                entity_id INTEGER NOT NULL,
                measure_id INTEGER NOT NULL,
                value REAL NOT NULL,
                is_emission INTEGER NOT NULL,
                row_json TEXT NOT NULL
            );

            CREATE TABLE factors (
                factor_key TEXT PRIMARY KEY,
                lineage_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                type TEXT NOT NULL,
                attribute TEXT NOT NULL,
                is_current INTEGER DEFAULT 1,
                data_year INTEGER,
                doc TEXT NOT NULL,
                source TEXT DEFAULT 'seed'
            );
            INSERT INTO factors (factor_key, lineage_id, domain, type, attribute, is_current, data_year, doc, source)
            VALUES ('factor_keep', 'lineage', 'combustion', 'gasoline', 'co2-ef', 1, 2024, '{}', 'seed');
            """
        )

    store = ProjectStore(db_path)
    info = store.schema_info()
    assert info["current_version"] >= 6
    with store._connect() as conn:  # noqa: SLF001 - verifying migration output tables
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        factor_count = conn.execute("SELECT COUNT(*) AS c FROM factors").fetchone()["c"]
        version_count = conn.execute("SELECT COUNT(*) AS c FROM project_versions").fetchone()["c"]
    assert factor_count == 1
    assert version_count == 0
    assert "fact_actuals" not in tables
    assert {
        "inventory_versions",
        "inventory_loci",
        "inventory_activities",
        "calculation_runs",
        "calculation_results",
        "factor_datasets",
        "factor_lineages",
        "factor_versions",
        "factor_source_docs",
    }.issubset(tables)


# ---------------------------------------------------------------------------
# Reporting-unit rename backward-compat round-trip
# ---------------------------------------------------------------------------


def test_legacy_facilities_json_round_trips_through_sqlite(tmp_path: Path):
    """A snapshot authored with the legacy ``facilities`` JSON key must load
    through the new :class:`ReportingUnitDraft` model, persist to SQLite
    under the same ``facilities`` key, and reload with identical data."""

    legacy_json = {
        "snapshot_version": 2,
        "facilities": [
            {
                "id": "F1",
                "facility_name": "Facility 1",
                "location": "Bend, OR",
                "region": "",
                "country": "US",
                "state": "OR",
                "egrid_subregion": "WECC",
                "reporting_group": "",
                "owned_leased": "Owned",
            }
        ],
        "activities": [],
        "result_rows": [],
        "summary_rows": [],
        "trace_rows": [],
        "audit_rows": [],
    }
    snapshot = ProjectSnapshot.model_validate(legacy_json)
    assert [unit.id for unit in snapshot.reporting_units] == ["F1"]
    assert snapshot.reporting_units[0].name == "Facility 1"

    store = ProjectStore(tmp_path / "roundtrip.sqlite")
    project = store.create_project(project_id="prj_ru", name="Reporting Unit RT", inventory_year=2024)
    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=False,
        snapshot=snapshot,
        note=None,
    )

    loaded = store.get_version_snapshot(project["project_id"], version_number=saved["version_number"])
    reloaded = loaded["snapshot"]
    assert isinstance(reloaded, ProjectSnapshot)
    assert [unit.id for unit in reloaded.reporting_units] == ["F1"]
    assert reloaded.reporting_units[0].name == "Facility 1"
    assert reloaded.reporting_units[0].egrid_subregion == "WECC"

    # The raw JSON stored in SQLite must still use the ``facilities`` key so
    # the wire format is stable for existing consumers.
    with store._connect() as conn:  # noqa: SLF001 - verifying on-disk JSON shape
        row = conn.execute(
            "SELECT snapshot_json FROM project_versions WHERE version_id = ?",
            (saved["version_id"],),
        ).fetchone()
    import json as _json
    on_disk = _json.loads(row["snapshot_json"])
    assert "facilities" in on_disk
    assert "reporting_units" not in on_disk
    assert on_disk["facilities"][0]["facility_name"] == "Facility 1"


def test_reporting_unit_draft_accepts_both_attribute_names_via_alias():
    """Constructors using either ``name=`` or ``facility_name=`` must both
    produce the same ``ReportingUnitDraft`` and dump the legacy key."""

    via_new = ReportingUnitDraft(id="F1", name="Plant")
    via_legacy = ReportingUnitDraft.model_validate({"id": "F1", "facility_name": "Plant"})

    assert via_new == via_legacy
    assert via_new.name == "Plant"
    assert via_new.model_dump(by_alias=True)["facility_name"] == "Plant"


def test_project_snapshot_model_dump_json_emits_facilities_key():
    """`model_dump_json(by_alias=True)` must produce the legacy JSON key
    that the SQLite storage layer writes; the attribute rename is
    Python-internal only."""

    snapshot = ProjectSnapshot(
        reporting_units=[ReportingUnitDraft(id="F1", name="Plant")],
    )
    dumped = snapshot.model_dump(by_alias=True)
    assert "facilities" in dumped
    assert "reporting_units" not in dumped
    assert dumped["facilities"][0]["facility_name"] == "Plant"


def test_project_store_exposes_sub_components(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")

    assert isinstance(store.workspace, SQLiteWorkspaceDraftStore)
    assert isinstance(store.inventory, SQLiteInventoryStore)
    assert isinstance(store.factors, SQLiteFactorStore)
    assert isinstance(store.service, ProjectService)

    # Duck-type: the accessors expose the methods callers would reach for.
    assert callable(getattr(store.workspace, "list_projects", None))
    assert callable(getattr(store.workspace, "save_workspace_snapshot", None))
    assert callable(getattr(store.inventory, "save_inventory_version", None))
    assert callable(getattr(store.inventory, "save_calculation_run", None))
    assert callable(getattr(store.factors, "current_factor_dataset", None))
    assert callable(getattr(store.service, "save_and_materialize", None))

    # Sub-components returned should be the same instances the service uses
    # (no duplicate wiring) and direct workspace CRUD must work through them.
    created = store.workspace.create_project(
        project_id="prj_sub", name="Sub Components", inventory_year=2024
    )
    assert created["project_id"] == "prj_sub"
    assert store.list_projects()[0]["project_id"] == "prj_sub"


def test_save_project_snapshot_delegates_to_service(tmp_path: Path):
    snapshot = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
                params={},
            )
        ],
    )

    # Path A: use the ProjectStore facade (existing public surface).
    store_a = ProjectStore(tmp_path / "via_facade.sqlite")
    store_a.create_project(project_id="prj_ab", name="Via Facade", inventory_year=2024)
    saved_a = store_a.save_project_snapshot(
        project_id="prj_ab",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
        note="via facade",
    )

    # Path B: use ProjectService directly, owning the connection.
    store_b = ProjectStore(tmp_path / "via_service.sqlite")
    store_b.create_project(project_id="prj_ab", name="Via Service", inventory_year=2024)
    with store_b._connect() as conn:  # noqa: SLF001 - legitimate service test
        saved_b = store_b.service.save_and_materialize(
            conn=conn,
            project_id="prj_ab",
            inventory_year=2024,
            gwp_set="AR6",
            include_trace=True,
            snapshot=snapshot,
            note="via service",
        )

    # The two paths should produce equivalent outputs for the same input.
    # Each DB starts at version 1, so IDs and version numbers must match.
    assert saved_a["project_id"] == saved_b["project_id"]
    assert saved_a["version_id"] == saved_b["version_id"]
    assert saved_a["version_number"] == saved_b["version_number"]
    assert saved_a.keys() == saved_b.keys()

    # The downstream materialization should also match: same facility count,
    # same activity count, same calculation run count.
    def _counts(store: ProjectStore, workspace_version_id: int) -> tuple[int, int, int]:
        with store._connect() as conn:  # noqa: SLF001 - verifying equivalence of materialization
            inv = conn.execute(
                "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
                (workspace_version_id,),
            ).fetchone()
            inv_id = inv["inventory_version_id"]
            loci = conn.execute(
                "SELECT COUNT(*) AS c FROM inventory_loci WHERE inventory_version_id = ?", (inv_id,)
            ).fetchone()["c"]
            acts = conn.execute(
                "SELECT COUNT(*) AS c FROM inventory_activities WHERE inventory_version_id = ?",
                (inv_id,),
            ).fetchone()["c"]
            runs = conn.execute(
                "SELECT COUNT(*) AS c FROM calculation_runs WHERE inventory_version_id = ?",
                (inv_id,),
            ).fetchone()["c"]
            return int(loci), int(acts), int(runs)

    assert _counts(store_a, saved_a["version_id"]) == _counts(store_b, saved_b["version_id"])


def test_save_and_materialize_rolls_back_on_failure(tmp_path: Path):
    """Failure mid-orchestration must not leave a partial workspace version behind.

    We inject the failure at ``save_calculation_run`` (the last step). If the
    transaction boundary is correct, the workspace save that happened earlier
    in the same connection must be rolled back too.
    """
    store = ProjectStore(tmp_path / "rollback.sqlite")
    store.create_project(project_id="prj_rb", name="Rollback", inventory_year=2024)

    snapshot = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
                params={},
            )
        ],
    )

    # Sanity: no workspace versions exist yet.
    assert store.list_versions("prj_rb") == []

    original = store.inventory.save_calculation_run

    def _boom(*args, **kwargs):
        raise RuntimeError("injected failure after workspace save")

    store.inventory.save_calculation_run = _boom  # type: ignore[method-assign]
    try:
        try:
            store.save_project_snapshot(
                project_id="prj_rb",
                inventory_year=2024,
                gwp_set="AR6",
                include_trace=True,
                snapshot=snapshot,
                note="rollback probe",
            )
        except RuntimeError:
            pass
        else:
            raise AssertionError("expected injected RuntimeError to propagate")
    finally:
        store.inventory.save_calculation_run = original  # type: ignore[method-assign]

    # The workspace save was inside the same transaction; it must be rolled back.
    assert store.list_versions("prj_rb") == []


def test_applicable_activity_types_empty_means_show_all(tmp_path: Path):
    """Legacy snapshots (empty applicable list) canonicalize every activity."""

    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(
        project_id="prj_legacy", name="Legacy Defaults", inventory_year=2024
    )
    snapshot = ProjectSnapshot(
        facilities=[
            # No applicable_activity_types supplied; defaults to [] (show all).
            ReportingUnitDraft(id="F1", name="Facility 1"),
        ],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
            ),
            ActivityDraft(
                id="a2",
                facility_id="F1",
                activity_type_id="scope2_purchased_electricity",
                activity={"value": 500.0, "unit": "kWh"},
            ),
        ],
        result_rows=[
            ResultRecord(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Owned Vehicle Gasoline",
                scope="Scope 1",
                activity_group="Mobile Combustion",
                source_type="gasoline",
                accounting_method="none",
                gas="co2e",
                value=88.0,
                unit="kg",
                is_biogenic=False,
                method_id="direct_factor",
            ),
            ResultRecord(
                facility_id="F1",
                activity_type_id="scope2_purchased_electricity",
                activity_label="Purchased Electricity",
                scope="Scope 2",
                activity_group="Purchased Energy",
                source_type="electricity",
                accounting_method="location_based",
                gas="co2e",
                value=200.0,
                unit="kg",
                is_biogenic=False,
                method_id="scope2_energy",
            ),
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
    )

    with store._connect() as conn:  # noqa: SLF001
        inventory = conn.execute(
            "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
            (saved["version_id"],),
        ).fetchone()
        activity_types = {
            row["activity_type_id"]
            for row in conn.execute(
                "SELECT activity_type_id FROM inventory_activities WHERE inventory_version_id = ?",
                (inventory["inventory_version_id"],),
            ).fetchall()
        }
        run = conn.execute(
            "SELECT run_id FROM calculation_runs WHERE inventory_version_id = ?",
            (inventory["inventory_version_id"],),
        ).fetchone()
        result_types = {
            row["activity_type_id"]
            for row in conn.execute(
                "SELECT activity_type_id FROM calculation_results WHERE run_id = ?",
                (run["run_id"],),
            ).fetchall()
        }
    assert activity_types == {
        "scope1_mobile_gasoline",
        "scope2_purchased_electricity",
    }
    assert result_types == {
        "scope1_mobile_gasoline",
        "scope2_purchased_electricity",
    }


def test_applicable_activity_types_filters_inventory_canonicalization(tmp_path: Path):
    """A non-empty list restricts which activities flow into ``inventory_activities``."""

    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(
        project_id="prj_filter", name="Filtered", inventory_year=2024
    )
    snapshot = ProjectSnapshot(
        facilities=[
            ReportingUnitDraft(
                id="F1",
                name="Facility 1",
                applicable_activity_types=["scope1_mobile_gasoline"],
            ),
        ],
        activities=[
            ActivityDraft(
                id="a_keep",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
            ),
            ActivityDraft(
                id="a_skip",
                facility_id="F1",
                activity_type_id="scope2_purchased_electricity",
                activity={"value": 500.0, "unit": "kWh"},
            ),
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
    )

    with store._connect() as conn:  # noqa: SLF001
        inventory = conn.execute(
            "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
            (saved["version_id"],),
        ).fetchone()
        activity_types = [
            row["activity_type_id"]
            for row in conn.execute(
                "SELECT activity_type_id FROM inventory_activities WHERE inventory_version_id = ?",
                (inventory["inventory_version_id"],),
            ).fetchall()
        ]
    assert activity_types == ["scope1_mobile_gasoline"]


def test_applicable_activity_types_filters_calculation_results(tmp_path: Path):
    """A non-empty list restricts which result rows flow into ``calculation_results``."""

    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(
        project_id="prj_calc_filter", name="Calc Filtered", inventory_year=2024
    )
    snapshot = ProjectSnapshot(
        facilities=[
            ReportingUnitDraft(
                id="F1",
                name="Facility 1",
                applicable_activity_types=["scope1_mobile_gasoline"],
            ),
        ],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
            ),
        ],
        result_rows=[
            ResultRecord(
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity_label="Owned Vehicle Gasoline",
                scope="Scope 1",
                activity_group="Mobile Combustion",
                source_type="gasoline",
                accounting_method="none",
                gas="co2e",
                value=88.0,
                unit="kg",
                is_biogenic=False,
                method_id="direct_factor",
            ),
            # This result should be filtered out — its activity type is not applicable.
            ResultRecord(
                facility_id="F1",
                activity_type_id="scope2_purchased_electricity",
                activity_label="Purchased Electricity",
                scope="Scope 2",
                activity_group="Purchased Energy",
                source_type="electricity",
                accounting_method="location_based",
                gas="co2e",
                value=200.0,
                unit="kg",
                is_biogenic=False,
                method_id="scope2_energy",
            ),
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
    )

    with store._connect() as conn:  # noqa: SLF001
        inventory = conn.execute(
            "SELECT inventory_version_id FROM inventory_versions WHERE workspace_version_id = ?",
            (saved["version_id"],),
        ).fetchone()
        run = conn.execute(
            "SELECT run_id FROM calculation_runs WHERE inventory_version_id = ?",
            (inventory["inventory_version_id"],),
        ).fetchone()
        result_types = [
            row["activity_type_id"]
            for row in conn.execute(
                "SELECT activity_type_id FROM calculation_results WHERE run_id = ?",
                (run["run_id"],),
            ).fetchall()
        ]
    assert result_types == ["scope1_mobile_gasoline"]


def test_applicable_activity_types_round_trips_through_workspace_snapshot(tmp_path: Path):
    """Saving and reloading a snapshot preserves ``applicable_activity_types``."""

    store = ProjectStore(tmp_path / "projects.sqlite")
    project = store.create_project(
        project_id="prj_roundtrip", name="Roundtrip", inventory_year=2024
    )
    snapshot = ProjectSnapshot(
        facilities=[
            ReportingUnitDraft(
                id="F1",
                name="Facility 1",
                applicable_activity_types=[
                    "scope1_mobile_gasoline",
                    "scope2_purchased_electricity",
                ],
            ),
            ReportingUnitDraft(id="F2", name="Facility 2"),  # empty list preserved
        ],
    )

    saved = store.save_project_snapshot(
        project_id=project["project_id"],
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
    )

    loaded = store.get_version_snapshot(
        project["project_id"], version_number=saved["version_number"]
    )
    units = {u.id: u for u in loaded["snapshot"].reporting_units}
    assert units["F1"].applicable_activity_types == [
        "scope1_mobile_gasoline",
        "scope2_purchased_electricity",
    ]
    assert units["F2"].applicable_activity_types == []
