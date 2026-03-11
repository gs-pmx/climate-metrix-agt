from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ProjectStore:
    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    description TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
            current = self._current_schema_version(conn)
            if current == 0 and self._legacy_schema_exists(conn):
                conn.execute(
                    """
                    INSERT INTO schema_migrations (version, description, applied_at)
                    VALUES (1, 'legacy baseline', ?)
                    """,
                    (utc_now_iso(),),
                )
                current = 1
            migrations: list[tuple[int, str, Any]] = [
                (1, "initial project storage schema", self._migration_1_initial_schema),
                (2, "project name index and helper views", self._migration_2_indexes),
            ]
            for version, description, fn in migrations:
                if version <= current:
                    continue
                fn(conn)
                conn.execute(
                    """
                    INSERT INTO schema_migrations (version, description, applied_at)
                    VALUES (?, ?, ?)
                    """,
                    (version, description, utc_now_iso()),
                )
                current = version

    def _current_schema_version(self, conn: sqlite3.Connection) -> int:
        row = conn.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").fetchone()
        return int(row["v"]) if row else 0

    def _legacy_schema_exists(self, conn: sqlite3.Connection) -> bool:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'project_versions')"
        ).fetchall()
        return len(rows) == 2

    def _migration_1_initial_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                inventory_year INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_versions (
                version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                inventory_year INTEGER NOT NULL,
                gwp_set TEXT NOT NULL,
                include_trace INTEGER NOT NULL,
                note TEXT,
                snapshot_json TEXT NOT NULL,
                UNIQUE(project_id, version_number),
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dim_date (
                date_id INTEGER PRIMARY KEY AUTOINCREMENT,
                calendar_date TEXT NOT NULL UNIQUE,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                day INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dim_entity (
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
                owned_leased TEXT,
                UNIQUE(
                    project_id,
                    facility_id,
                    source_id,
                    country,
                    state,
                    egrid_subregion,
                    reporting_group,
                    owned_leased
                ),
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dim_measure (
                measure_id INTEGER PRIMARY KEY AUTOINCREMENT,
                measure_type TEXT NOT NULL,
                unit TEXT,
                scope TEXT,
                metric_group TEXT,
                metric_subgroup TEXT,
                source_type TEXT,
                gas TEXT,
                accounting_method TEXT,
                UNIQUE(
                    measure_type,
                    unit,
                    scope,
                    metric_group,
                    metric_subgroup,
                    source_type,
                    gas,
                    accounting_method
                )
            );

            CREATE TABLE IF NOT EXISTS fact_actuals (
                fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
                version_id INTEGER NOT NULL,
                date_id INTEGER NOT NULL,
                entity_id INTEGER NOT NULL,
                measure_id INTEGER NOT NULL,
                value REAL NOT NULL,
                is_emission INTEGER NOT NULL,
                row_json TEXT NOT NULL,
                FOREIGN KEY(version_id) REFERENCES project_versions(version_id) ON DELETE CASCADE,
                FOREIGN KEY(date_id) REFERENCES dim_date(date_id),
                FOREIGN KEY(entity_id) REFERENCES dim_entity(entity_id),
                FOREIGN KEY(measure_id) REFERENCES dim_measure(measure_id)
            );
            """
        )

    def _migration_2_indexes(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_versions_project_version
                ON project_versions(project_id, version_number DESC);
            CREATE INDEX IF NOT EXISTS idx_fact_actuals_version ON fact_actuals(version_id);
            """
        )

    def schema_info(self) -> dict[str, Any]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT version, description, applied_at
                FROM schema_migrations
                ORDER BY version
                """
            ).fetchall()
            return {
                "current_version": self._current_schema_version(conn),
                "migrations": [dict(r) for r in rows],
            }

    def list_projects(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT p.project_id, p.name, p.inventory_year, p.created_at, p.updated_at,
                       COALESCE(MAX(v.version_number), 0) AS latest_version
                FROM projects p
                LEFT JOIN project_versions v ON v.project_id = p.project_id
                GROUP BY p.project_id, p.name, p.inventory_year, p.created_at, p.updated_at
                ORDER BY p.updated_at DESC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def create_project(self, *, project_id: str, name: str, inventory_year: int) -> dict[str, Any]:
        now = utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO projects (project_id, name, inventory_year, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (project_id, name, inventory_year, now, now),
            )
            row = conn.execute(
                "SELECT project_id, name, inventory_year, created_at, updated_at FROM projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Failed to create project.")
            data = dict(row)
            data["latest_version"] = 0
            return data

    def rename_project(self, project_id: str, new_name: str) -> dict[str, Any]:
        now = utc_now_iso()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE projects
                SET name = ?, updated_at = ?
                WHERE project_id = ?
                """,
                (new_name, now, project_id),
            )
            if cur.rowcount == 0:
                raise KeyError("Project not found.")
            row = conn.execute(
                """
                SELECT p.project_id, p.name, p.inventory_year, p.created_at, p.updated_at,
                       COALESCE(MAX(v.version_number), 0) AS latest_version
                FROM projects p
                LEFT JOIN project_versions v ON v.project_id = p.project_id
                WHERE p.project_id = ?
                GROUP BY p.project_id, p.name, p.inventory_year, p.created_at, p.updated_at
                """,
                (project_id,),
            ).fetchone()
            if row is None:
                raise KeyError("Project not found.")
            return dict(row)

    def delete_project(self, project_id: str) -> None:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM projects WHERE project_id = ?", (project_id,))
            if cur.rowcount == 0:
                raise KeyError("Project not found.")

    def list_versions(self, project_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT version_id, project_id, version_number, created_at, inventory_year, gwp_set, include_trace, note
                FROM project_versions
                WHERE project_id = ?
                ORDER BY version_number DESC
                """,
                (project_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_version_snapshot(self, project_id: str, version_number: int | None = None) -> dict[str, Any]:
        with self._connect() as conn:
            if version_number is None:
                row = conn.execute(
                    """
                    SELECT
                        version_id,
                        project_id,
                        version_number,
                        created_at,
                        inventory_year,
                        gwp_set,
                        include_trace,
                        note,
                        snapshot_json
                    FROM project_versions
                    WHERE project_id = ?
                    ORDER BY version_number DESC
                    LIMIT 1
                    """,
                    (project_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT
                        version_id,
                        project_id,
                        version_number,
                        created_at,
                        inventory_year,
                        gwp_set,
                        include_trace,
                        note,
                        snapshot_json
                    FROM project_versions
                    WHERE project_id = ? AND version_number = ?
                    """,
                    (project_id, version_number),
                ).fetchone()

            if row is None:
                raise KeyError("Project version not found.")
            payload = dict(row)
            payload["snapshot"] = json.loads(payload.pop("snapshot_json"))
            payload["include_trace"] = bool(payload["include_trace"])
            return payload

    def save_project_snapshot(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: dict[str, Any],
        note: str | None = None,
    ) -> dict[str, Any]:
        now = utc_now_iso()
        with self._connect() as conn:
            project_row = conn.execute(
                "SELECT project_id FROM projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if project_row is None:
                raise KeyError("Project not found.")

            current = conn.execute(
                "SELECT COALESCE(MAX(version_number), 0) AS latest_version FROM project_versions WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            next_version = int(current["latest_version"]) + 1 if current else 1

            snapshot_json = json.dumps(snapshot, sort_keys=True)
            cur = conn.execute(
                """
                INSERT INTO project_versions (
                    project_id, version_number, created_at, inventory_year, gwp_set, include_trace, note, snapshot_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    next_version,
                    now,
                    inventory_year,
                    gwp_set,
                    int(include_trace),
                    note,
                    snapshot_json,
                ),
            )
            version_id = int(cur.lastrowid)
            conn.execute(
                """
                UPDATE projects
                SET inventory_year = ?, updated_at = ?
                WHERE project_id = ?
                """,
                (inventory_year, now, project_id),
            )
            self._materialize_facts(
                conn=conn,
                project_id=project_id,
                version_id=version_id,
                as_of=now,
                facilities=snapshot.get("facilities", []),
                activities=snapshot.get("activities", []),
                result_rows=snapshot.get("result_rows", []),
            )

            return {
                "project_id": project_id,
                "version_id": version_id,
                "version_number": next_version,
                "created_at": now,
            }

    def _materialize_facts(
        self,
        *,
        conn: sqlite3.Connection,
        project_id: str,
        version_id: int,
        as_of: str,
        facilities: list[dict[str, Any]],
        activities: list[dict[str, Any]],
        result_rows: list[dict[str, Any]],
    ) -> None:
        date_id = self._upsert_dim_date(conn, as_of)
        facility_by_id = {str(f.get("id")): f for f in facilities if f.get("id") is not None}

        for row in activities:
            raw_value = row.get("activity_value")
            if raw_value in ("", None):
                continue
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
            facility = facility_by_id.get(str(row.get("facility_id")), {})
            entity_id = self._upsert_dim_entity(
                conn=conn,
                project_id=project_id,
                facility_id=row.get("facility_id"),
                facility_name=facility.get("facility_name"),
                source_id=row.get("source_id"),
                source_label=row.get("source_label"),
                country=facility.get("country"),
                state=facility.get("state"),
                egrid_subregion=facility.get("egrid_subregion"),
                reporting_group=facility.get("reporting_group"),
                owned_leased=facility.get("owned_leased"),
            )
            measure_id = self._upsert_dim_measure(
                conn=conn,
                measure_type="activity",
                unit=row.get("activity_unit"),
                scope=row.get("scope"),
                metric_group=row.get("metric_group"),
                metric_subgroup=row.get("metric_subgroup"),
                source_type=row.get("source_type"),
                gas=None,
                accounting_method=None,
            )
            conn.execute(
                """
                INSERT INTO fact_actuals (version_id, date_id, entity_id, measure_id, value, is_emission, row_json)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (version_id, date_id, entity_id, measure_id, value, json.dumps(row, sort_keys=True)),
            )

        for row in result_rows:
            raw_value = row.get("value")
            if raw_value in ("", None):
                continue
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
            facility = facility_by_id.get(str(row.get("facility_id")), {})
            entity_id = self._upsert_dim_entity(
                conn=conn,
                project_id=project_id,
                facility_id=row.get("facility_id"),
                facility_name=facility.get("facility_name"),
                source_id=row.get("source_id"),
                source_label=None,
                country=facility.get("country"),
                state=facility.get("state"),
                egrid_subregion=facility.get("egrid_subregion"),
                reporting_group=facility.get("reporting_group"),
                owned_leased=facility.get("owned_leased"),
            )
            measure_id = self._upsert_dim_measure(
                conn=conn,
                measure_type="emission",
                unit=row.get("unit"),
                scope=row.get("scope"),
                metric_group=None,
                metric_subgroup=None,
                source_type=None,
                gas=row.get("gas"),
                accounting_method=row.get("accounting_method"),
            )
            conn.execute(
                """
                INSERT INTO fact_actuals (version_id, date_id, entity_id, measure_id, value, is_emission, row_json)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (version_id, date_id, entity_id, measure_id, value, json.dumps(row, sort_keys=True)),
            )

    def _upsert_dim_date(self, conn: sqlite3.Connection, as_of: str) -> int:
        calendar_date = as_of[:10]
        row = conn.execute(
            "SELECT date_id FROM dim_date WHERE calendar_date = ?",
            (calendar_date,),
        ).fetchone()
        if row is not None:
            return int(row["date_id"])
        year, month, day = [int(x) for x in calendar_date.split("-")]
        cur = conn.execute(
            """
            INSERT INTO dim_date (calendar_date, year, month, day)
            VALUES (?, ?, ?, ?)
            """,
            (calendar_date, year, month, day),
        )
        return int(cur.lastrowid)

    def _upsert_dim_entity(
        self,
        *,
        conn: sqlite3.Connection,
        project_id: str,
        facility_id: Any,
        facility_name: Any,
        source_id: Any,
        source_label: Any,
        country: Any,
        state: Any,
        egrid_subregion: Any,
        reporting_group: Any,
        owned_leased: Any,
    ) -> int:
        row = conn.execute(
            """
            SELECT entity_id
            FROM dim_entity
            WHERE project_id = ?
              AND facility_id IS ?
              AND source_id IS ?
              AND country IS ?
              AND state IS ?
              AND egrid_subregion IS ?
              AND reporting_group IS ?
              AND owned_leased IS ?
            """,
            (
                project_id,
                facility_id,
                source_id,
                country,
                state,
                egrid_subregion,
                reporting_group,
                owned_leased,
            ),
        ).fetchone()
        if row is not None:
            return int(row["entity_id"])
        cur = conn.execute(
            """
            INSERT INTO dim_entity (
                project_id, facility_id, facility_name, source_id, source_label, country,
                state, egrid_subregion, reporting_group, owned_leased
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                facility_id,
                facility_name,
                source_id,
                source_label,
                country,
                state,
                egrid_subregion,
                reporting_group,
                owned_leased,
            ),
        )
        return int(cur.lastrowid)

    def _upsert_dim_measure(
        self,
        *,
        conn: sqlite3.Connection,
        measure_type: str,
        unit: Any,
        scope: Any,
        metric_group: Any,
        metric_subgroup: Any,
        source_type: Any,
        gas: Any,
        accounting_method: Any,
    ) -> int:
        row = conn.execute(
            """
            SELECT measure_id
            FROM dim_measure
            WHERE measure_type = ?
              AND unit IS ?
              AND scope IS ?
              AND metric_group IS ?
              AND metric_subgroup IS ?
              AND source_type IS ?
              AND gas IS ?
              AND accounting_method IS ?
            """,
            (
                measure_type,
                unit,
                scope,
                metric_group,
                metric_subgroup,
                source_type,
                gas,
                accounting_method,
            ),
        ).fetchone()
        if row is not None:
            return int(row["measure_id"])
        cur = conn.execute(
            """
            INSERT INTO dim_measure (
                measure_type, unit, scope, metric_group, metric_subgroup, source_type, gas, accounting_method
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (measure_type, unit, scope, metric_group, metric_subgroup, source_type, gas, accounting_method),
        )
        return int(cur.lastrowid)
