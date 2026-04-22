from __future__ import annotations

import sqlite3
from pathlib import Path

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.models import ActivityDraft, ProjectSnapshot
from project_store import ProjectStore


def _catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(Path(__file__).resolve().parents[1] / "data" / "activity_types.json")


def test_project_store_saves_and_loads_typed_snapshot(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    catalog = _catalog()
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
        activity_catalog=catalog,
        note="typed snapshot",
    )

    loaded = store.get_version_snapshot(project["project_id"], version_number=saved["version_number"])
    assert loaded["snapshot"].snapshot_version == 2
    assert loaded["snapshot"].activities[0].activity_type_id == "scope1_mobile_gasoline"
    with store._connect() as conn:  # noqa: SLF001 - explicit verification of fact schema
        entity = conn.execute(
            "SELECT activity_type_id, activity_label FROM dim_entity WHERE project_id = ?",
            (project["project_id"],),
        ).fetchone()
    assert entity is not None
    assert entity["activity_type_id"] == "scope1_mobile_gasoline"
    assert entity["activity_label"] == "Owned Vehicle Gasoline"


def test_project_store_preserves_incomplete_drafts_without_materializing_facts(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    catalog = _catalog()
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
        activity_catalog=catalog,
        note="incomplete typed snapshot",
    )

    loaded = store.get_version_snapshot(project["project_id"], version_number=saved["version_number"])
    assert loaded["snapshot"].activities[0].activity.value is None
    with store._connect() as conn:  # noqa: SLF001 - verifying incomplete drafts are not materialized
        fact_count = conn.execute(
            "SELECT COUNT(*) AS c FROM fact_actuals WHERE version_id = ?",
            (saved["version_id"],),
        ).fetchone()["c"]
    assert fact_count == 0


def test_schema_reset_migration_rebuilds_typed_tables(tmp_path: Path):
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
            INSERT INTO project_versions (project_id, version_number, created_at, inventory_year, gwp_set, include_trace, snapshot_json)
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
            INSERT INTO dim_date (calendar_date, year, month, day) VALUES ('2026-01-01', 2026, 1, 1);
            INSERT INTO dim_entity (project_id, facility_id, source_id) VALUES ('prj_old', 'F1', 'fuel_gasoline_s1');
            INSERT INTO dim_measure (measure_type, unit, scope) VALUES ('activity', 'gallon', 'Scope 1');
            INSERT INTO fact_actuals (version_id, date_id, entity_id, measure_id, value, is_emission, row_json)
            VALUES (1, 1, 1, 1, 10.0, 0, '{}');

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
    assert info["current_version"] >= 5
    with store._connect() as conn:  # noqa: SLF001 - verifying migration output tables
        factor_count = conn.execute("SELECT COUNT(*) AS c FROM factors").fetchone()["c"]
        version_count = conn.execute("SELECT COUNT(*) AS c FROM project_versions").fetchone()["c"]
        fact_count = conn.execute("SELECT COUNT(*) AS c FROM fact_actuals").fetchone()["c"]
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(dim_entity)").fetchall()
        }
        measure_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(dim_measure)").fetchall()
        }
    assert factor_count == 1
    assert version_count == 0
    assert fact_count == 0
    assert {"activity_type_id", "activity_label"}.issubset(columns)
    assert "is_biogenic" in measure_columns
