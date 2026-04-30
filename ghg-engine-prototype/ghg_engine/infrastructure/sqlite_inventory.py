from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from ghg_engine.models import ProjectSnapshot, ResultRecord, TraceRecord
from ghg_engine.services.applicability import (
    build_applicability_map,
    is_applicable,
)

from .sqlite_common import connect_sqlite, utc_now_iso

# PR B — applicability helpers moved to ``ghg_engine.services.applicability``
# so the API calc routes can share them. ``_applicability_map`` and
# ``_is_applicable`` remain as thin aliases for any in-tree caller that
# imports them by their historical names; new code should import from the
# service directly.
_applicability_map = build_applicability_map
_is_applicable = is_applicable


class SQLiteInventoryStore:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    @staticmethod
    def ensure_schema(conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS inventory_versions (
                inventory_version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                workspace_version_id INTEGER NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                inventory_year INTEGER NOT NULL,
                gwp_set TEXT NOT NULL,
                include_trace INTEGER NOT NULL,
                note TEXT,
                snapshot_version INTEGER NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
                FOREIGN KEY(workspace_version_id) REFERENCES project_versions(version_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS inventory_loci (
                locus_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                inventory_version_id INTEGER NOT NULL,
                locus_id TEXT NOT NULL,
                locus_kind TEXT NOT NULL,
                facility_name TEXT,
                location TEXT,
                region TEXT,
                country TEXT,
                state TEXT,
                egrid_subregion TEXT,
                reporting_group TEXT,
                owned_leased TEXT,
                row_json TEXT NOT NULL,
                UNIQUE(inventory_version_id, locus_id),
                FOREIGN KEY(inventory_version_id) REFERENCES inventory_versions(inventory_version_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS inventory_activities (
                inventory_activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
                inventory_version_id INTEGER NOT NULL,
                activity_id TEXT NOT NULL,
                locus_id TEXT NOT NULL,
                activity_type_id TEXT NOT NULL,
                quantity_value REAL NOT NULL,
                quantity_unit TEXT NOT NULL,
                params_json TEXT NOT NULL,
                period_start TEXT,
                period_end TEXT,
                timestamp TEXT,
                duration_seconds REAL,
                row_json TEXT NOT NULL,
                UNIQUE(inventory_version_id, activity_id),
                FOREIGN KEY(inventory_version_id) REFERENCES inventory_versions(inventory_version_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS calculation_runs (
                run_id INTEGER PRIMARY KEY AUTOINCREMENT,
                inventory_version_id INTEGER NOT NULL,
                workspace_version_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                factor_dataset_id TEXT,
                engine_version TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                status TEXT NOT NULL,
                trace_json TEXT,
                metadata_json TEXT,
                FOREIGN KEY(inventory_version_id) REFERENCES inventory_versions(inventory_version_id) ON DELETE CASCADE,
                FOREIGN KEY(workspace_version_id) REFERENCES project_versions(version_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS calculation_results (
                calculation_result_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                inventory_version_id INTEGER NOT NULL,
                facility_id TEXT NOT NULL,
                activity_type_id TEXT NOT NULL,
                activity_label TEXT NOT NULL,
                scope TEXT NOT NULL,
                accounting_method TEXT NOT NULL,
                gas TEXT NOT NULL,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                is_biogenic INTEGER NOT NULL DEFAULT 0,
                method_id TEXT NOT NULL,
                factor_ids_json TEXT NOT NULL,
                row_json TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES calculation_runs(run_id) ON DELETE CASCADE,
                FOREIGN KEY(inventory_version_id) REFERENCES inventory_versions(inventory_version_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_inventory_versions_project
                ON inventory_versions(project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_inventory_activities_version
                ON inventory_activities(inventory_version_id);
            CREATE INDEX IF NOT EXISTS idx_calculation_runs_inventory
                ON calculation_runs(inventory_version_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_calculation_results_run
                ON calculation_results(run_id);
            -- Phase D3: dashboard analytics path queries
            -- ``WHERE inventory_version_id = ? AND gas = 'co2e' GROUP BY facility_id, activity_type_id, scope``.
            -- The composite index lets SQLite seek directly to the
            -- per-version + per-facility slice without scanning the
            -- whole table.
            CREATE INDEX IF NOT EXISTS idx_calculation_results_inventory_facility
                ON calculation_results(inventory_version_id, facility_id);
            """
        )

    def _connect(self) -> sqlite3.Connection:
        return connect_sqlite(self._db_path)

    def save_inventory_version(
        self,
        *,
        project_id: str,
        workspace_version_id: int,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self._connect() as own_conn:
                return self.save_inventory_version(
                    project_id=project_id,
                    workspace_version_id=workspace_version_id,
                    inventory_year=inventory_year,
                    gwp_set=gwp_set,
                    include_trace=include_trace,
                    snapshot=snapshot,
                    note=note,
                    conn=own_conn,
                )
        existing = conn.execute(
            """
            SELECT inventory_version_id, project_id, workspace_version_id, created_at
            FROM inventory_versions
            WHERE workspace_version_id = ?
            """,
            (workspace_version_id,),
        ).fetchone()
        if existing is not None:
            return dict(existing)
        now = utc_now_iso()
        cur = conn.execute(
            """
            INSERT INTO inventory_versions (
                project_id, workspace_version_id, created_at, inventory_year, gwp_set,
                include_trace, note, snapshot_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                workspace_version_id,
                now,
                inventory_year,
                gwp_set,
                int(include_trace),
                note,
                snapshot.snapshot_version,
            ),
        )
        inventory_version_id = int(cur.lastrowid)
        for reporting_unit in snapshot.reporting_units:
            conn.execute(
                """
                INSERT INTO inventory_loci (
                    inventory_version_id, locus_id, locus_kind, facility_name, location, region,
                    country, state, egrid_subregion, reporting_group, owned_leased, row_json
                )
                VALUES (?, ?, 'facility', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    inventory_version_id,
                    reporting_unit.id,
                    reporting_unit.name,
                    reporting_unit.location,
                    reporting_unit.region,
                    reporting_unit.country,
                    reporting_unit.state,
                    reporting_unit.egrid_subregion,
                    reporting_unit.reporting_group,
                    reporting_unit.owned_leased,
                    reporting_unit.model_dump_json(by_alias=True),
                ),
            )
        applicability = _applicability_map(snapshot)
        for index, activity in enumerate(snapshot.activities):
            if (
                not activity.facility_id
                or not activity.activity_type_id
                or activity.activity.value is None
                or not activity.activity.unit
            ):
                continue
            if not _is_applicable(
                applicability, activity.facility_id, activity.activity_type_id
            ):
                continue
            conn.execute(
                """
                INSERT INTO inventory_activities (
                    inventory_version_id, activity_id, locus_id, activity_type_id, quantity_value,
                    quantity_unit, params_json, period_start, period_end, timestamp, duration_seconds, row_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    inventory_version_id,
                    activity.id or f"activity_{index + 1}",
                    activity.facility_id,
                    activity.activity_type_id,
                    activity.activity.value,
                    activity.activity.unit,
                    json.dumps(activity.params, sort_keys=True),
                    activity.period_start.isoformat() if activity.period_start else None,
                    activity.period_end.isoformat() if activity.period_end else None,
                    activity.timestamp.isoformat() if activity.timestamp else None,
                    activity.duration.total_seconds() if activity.duration else None,
                    activity.model_dump_json(),
                ),
            )
        return {
            "inventory_version_id": inventory_version_id,
            "project_id": project_id,
            "workspace_version_id": workspace_version_id,
            "created_at": now,
        }

    def save_calculation_run(
        self,
        *,
        inventory_version_id: int,
        workspace_version_id: int,
        factor_dataset_id: str | None,
        results: list[ResultRecord],
        traces: list[TraceRecord],
        engine_version: str,
        source_kind: str = "workspace_snapshot",
        applicability: dict[str, frozenset[str] | None] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if not results and not traces:
            return None
        if conn is None:
            with self._connect() as own_conn:
                return self.save_calculation_run(
                    inventory_version_id=inventory_version_id,
                    workspace_version_id=workspace_version_id,
                    factor_dataset_id=factor_dataset_id,
                    results=results,
                    traces=traces,
                    engine_version=engine_version,
                    source_kind=source_kind,
                    applicability=applicability,
                    conn=own_conn,
                )
        filtered_results: list[ResultRecord]
        if applicability is None:
            filtered_results = list(results)
        else:
            filtered_results = [
                r
                for r in results
                if _is_applicable(applicability, r.facility_id, r.activity_type_id)
            ]
        now = utc_now_iso()
        cur = conn.execute(
            """
            INSERT INTO calculation_runs (
                inventory_version_id, workspace_version_id, created_at, factor_dataset_id,
                engine_version, source_kind, status, trace_json, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)
            """,
            (
                inventory_version_id,
                workspace_version_id,
                now,
                factor_dataset_id,
                engine_version,
                source_kind,
                json.dumps([trace.model_dump(mode="json") for trace in traces], sort_keys=True),
                json.dumps({"result_count": len(filtered_results)}, sort_keys=True),
            ),
        )
        run_id = int(cur.lastrowid)
        for result in filtered_results:
            conn.execute(
                """
                INSERT INTO calculation_results (
                    run_id, inventory_version_id, facility_id, activity_type_id, activity_label,
                    scope, accounting_method, gas, value, unit, is_biogenic, method_id,
                    factor_ids_json, row_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    inventory_version_id,
                    result.facility_id,
                    result.activity_type_id,
                    result.activity_label,
                    result.scope,
                    result.accounting_method,
                    result.gas,
                    result.value,
                    result.unit,
                    1 if result.is_biogenic else 0,
                    result.method_id,
                    json.dumps(result.factor_ids, sort_keys=True),
                    result.model_dump_json(),
                ),
            )
        return {
            "run_id": run_id,
            "inventory_version_id": inventory_version_id,
            "workspace_version_id": workspace_version_id,
            "created_at": now,
        }

    def get_inventory_version_by_workspace_version(
        self,
        workspace_version_id: int,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if conn is None:
            with self._connect() as own_conn:
                return self.get_inventory_version_by_workspace_version(
                    workspace_version_id,
                    conn=own_conn,
                )
        row = conn.execute(
            """
            SELECT inventory_version_id, project_id, workspace_version_id, created_at,
                   inventory_year, gwp_set, include_trace, note, snapshot_version
            FROM inventory_versions
            WHERE workspace_version_id = ?
            """,
            (workspace_version_id,),
        ).fetchone()
        return dict(row) if row is not None else None
