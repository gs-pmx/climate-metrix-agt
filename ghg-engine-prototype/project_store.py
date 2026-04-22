from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.models import ActivityDraft, FacilityDraft, ProjectSnapshot, ResultRecord


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
                (3, "emission factor document store", self._migration_3_factors),
                (4, "canonical activity snapshots and typed fact schema", self._migration_4_canonical_activity_schema),
                (5, "biogenic-aware measure schema", self._migration_5_biogenic_measure_schema),
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

    def _migration_3_factors(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS factors (
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
            CREATE INDEX IF NOT EXISTS idx_factors_lookup
                ON factors(domain, type, attribute, is_current);
            CREATE INDEX IF NOT EXISTS idx_factors_lineage
                ON factors(lineage_id, is_current);
            """
        )

    def _migration_4_canonical_activity_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            DROP INDEX IF EXISTS idx_fact_actuals_version;
            DROP INDEX IF EXISTS idx_versions_project_version;

            DROP TABLE IF EXISTS fact_actuals;
            DROP TABLE IF EXISTS dim_measure;
            DROP TABLE IF EXISTS dim_entity;
            DROP TABLE IF EXISTS dim_date;
            DROP TABLE IF EXISTS project_versions;

            CREATE TABLE project_versions (
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
                activity_type_id TEXT,
                activity_label TEXT,
                activity_group TEXT,
                protocol_category_code TEXT,
                protocol_category_label TEXT,
                country TEXT,
                state TEXT,
                egrid_subregion TEXT,
                reporting_group TEXT,
                owned_leased TEXT,
                UNIQUE(
                    project_id,
                    facility_id,
                    activity_type_id,
                    country,
                    state,
                    egrid_subregion,
                    reporting_group,
                    owned_leased
                ),
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
            );

            CREATE TABLE dim_measure (
                measure_id INTEGER PRIMARY KEY AUTOINCREMENT,
                measure_type TEXT NOT NULL,
                unit TEXT,
                scope TEXT,
                activity_group TEXT,
                source_type TEXT,
                gas TEXT,
                accounting_method TEXT,
                is_biogenic INTEGER NOT NULL DEFAULT 0,
                UNIQUE(
                    measure_type,
                    unit,
                    scope,
                    activity_group,
                    source_type,
                    gas,
                    accounting_method,
                    is_biogenic
                )
            );

            CREATE TABLE fact_actuals (
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

            CREATE INDEX idx_versions_project_version
                ON project_versions(project_id, version_number DESC);
            CREATE INDEX idx_fact_actuals_version ON fact_actuals(version_id);
            """
        )

    def _migration_5_biogenic_measure_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            DROP INDEX IF EXISTS idx_fact_actuals_version;
            DROP INDEX IF EXISTS idx_versions_project_version;

            DROP TABLE IF EXISTS fact_actuals;
            DROP TABLE IF EXISTS dim_measure;
            DROP TABLE IF EXISTS dim_entity;
            DROP TABLE IF EXISTS dim_date;
            DROP TABLE IF EXISTS project_versions;

            CREATE TABLE project_versions (
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
                activity_type_id TEXT,
                activity_label TEXT,
                activity_group TEXT,
                protocol_category_code TEXT,
                protocol_category_label TEXT,
                country TEXT,
                state TEXT,
                egrid_subregion TEXT,
                reporting_group TEXT,
                owned_leased TEXT,
                UNIQUE(
                    project_id,
                    facility_id,
                    activity_type_id,
                    country,
                    state,
                    egrid_subregion,
                    reporting_group,
                    owned_leased
                ),
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
            );

            CREATE TABLE dim_measure (
                measure_id INTEGER PRIMARY KEY AUTOINCREMENT,
                measure_type TEXT NOT NULL,
                unit TEXT,
                scope TEXT,
                activity_group TEXT,
                source_type TEXT,
                gas TEXT,
                accounting_method TEXT,
                is_biogenic INTEGER NOT NULL DEFAULT 0,
                UNIQUE(
                    measure_type,
                    unit,
                    scope,
                    activity_group,
                    source_type,
                    gas,
                    accounting_method,
                    is_biogenic
                )
            );

            CREATE TABLE fact_actuals (
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

            CREATE INDEX idx_versions_project_version
                ON project_versions(project_id, version_number DESC);
            CREATE INDEX idx_fact_actuals_version ON fact_actuals(version_id);
            """
        )

    def seed_factors(self, json_path: Path) -> int:
        with self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM factors").fetchone()[0]
            if count > 0:
                return 0
            with open(json_path, encoding="utf-8") as f:
                docs = json.load(f)
            rows = []
            for doc in docs:
                classification = doc.get("classification", {})
                factor = doc.get("factor", {})
                provenance = doc.get("provenance", {})
                versioning = doc.get("versioning", {})
                rows.append((
                    doc.get("factor_key", doc.get("_id", "")),
                    doc.get("lineage_id", ""),
                    classification.get("domain", ""),
                    classification.get("type", ""),
                    factor.get("attribute", ""),
                    1 if versioning.get("is_current", True) else 0,
                    provenance.get("data_year"),
                    json.dumps(doc, sort_keys=True),
                    "seed",
                ))
            conn.executemany(
                """
                INSERT OR IGNORE INTO factors
                    (factor_key, lineage_id, domain, type, attribute, is_current, data_year, doc, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            return len(rows)

    def factors_connection(self) -> sqlite3.Connection:
        return self._connect()

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
                "migrations": [dict(row) for row in rows],
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
            return [dict(row) for row in rows]

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
            return [dict(row) for row in rows]

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
            try:
                payload["snapshot"] = ProjectSnapshot.model_validate_json(payload.pop("snapshot_json"))
            except Exception as exc:
                raise ValueError(f"Unsupported snapshot schema for project '{project_id}': {exc}") from exc
            payload["include_trace"] = bool(payload["include_trace"])
            return payload

    def save_project_snapshot(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        activity_catalog: ActivityCatalog,
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
                    snapshot.model_dump_json(),
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
                facilities=snapshot.facilities,
                activities=snapshot.activities,
                result_rows=snapshot.result_rows,
                activity_catalog=activity_catalog,
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
        facilities: list[FacilityDraft],
        activities: list[ActivityDraft],
        result_rows: list[ResultRecord],
        activity_catalog: ActivityCatalog,
    ) -> None:
        date_id = self._upsert_dim_date(conn, as_of)
        facility_by_id = {facility.id: facility for facility in facilities}

        for row in activities:
            if (
                not row.facility_id
                or not row.activity_type_id
                or row.activity.value is None
                or not row.activity.unit
            ):
                continue
            facility = facility_by_id.get(row.facility_id, FacilityDraft(id=row.facility_id))
            activity_def = activity_catalog.get_required(row.activity_type_id)
            entity_id = self._upsert_dim_entity(
                conn=conn,
                project_id=project_id,
                facility=facility,
                activity_type_id=row.activity_type_id,
                activity_label=activity_def.label,
                activity_group=activity_def.ui_metadata.get("group"),
                protocol_category_code=activity_def.protocol_category_code,
                protocol_category_label=activity_def.protocol_category_label,
            )
            measure_id = self._upsert_dim_measure(
                conn=conn,
                measure_type="activity",
                unit=row.activity.unit,
                scope=activity_def.scope,
                activity_group=activity_def.ui_metadata.get("group"),
                source_type=activity_def.source_type,
                gas=None,
                accounting_method=None,
                is_biogenic=False,
            )
            conn.execute(
                """
                INSERT INTO fact_actuals (version_id, date_id, entity_id, measure_id, value, is_emission, row_json)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    version_id,
                    date_id,
                    entity_id,
                    measure_id,
                    row.activity.value,
                    row.model_dump_json(),
                ),
            )

        for row in result_rows:
            facility = facility_by_id.get(row.facility_id, FacilityDraft(id=row.facility_id))
            entity_id = self._upsert_dim_entity(
                conn=conn,
                project_id=project_id,
                facility=facility,
                activity_type_id=row.activity_type_id,
                activity_label=row.activity_label,
                activity_group=row.activity_group,
                protocol_category_code=row.protocol_category_code,
                protocol_category_label=row.protocol_category_label,
            )
            measure_id = self._upsert_dim_measure(
                conn=conn,
                measure_type="emission",
                unit=row.unit,
                scope=row.scope,
                activity_group=row.activity_group,
                source_type=row.source_type,
                gas=row.gas,
                accounting_method=row.accounting_method,
                is_biogenic=row.is_biogenic,
            )
            conn.execute(
                """
                INSERT INTO fact_actuals (version_id, date_id, entity_id, measure_id, value, is_emission, row_json)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    version_id,
                    date_id,
                    entity_id,
                    measure_id,
                    row.value,
                    row.model_dump_json(),
                ),
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
        facility: FacilityDraft,
        activity_type_id: str,
        activity_label: str | None,
        activity_group: str | None,
        protocol_category_code: str | None,
        protocol_category_label: str | None,
    ) -> int:
        row = conn.execute(
            """
            SELECT entity_id
            FROM dim_entity
            WHERE project_id = ?
              AND facility_id IS ?
              AND activity_type_id IS ?
              AND country IS ?
              AND state IS ?
              AND egrid_subregion IS ?
              AND reporting_group IS ?
              AND owned_leased IS ?
            """,
            (
                project_id,
                facility.id,
                activity_type_id,
                facility.country,
                facility.state,
                facility.egrid_subregion,
                facility.reporting_group,
                facility.owned_leased,
            ),
        ).fetchone()
        if row is not None:
            return int(row["entity_id"])
        cur = conn.execute(
            """
            INSERT INTO dim_entity (
                project_id,
                facility_id,
                facility_name,
                activity_type_id,
                activity_label,
                activity_group,
                protocol_category_code,
                protocol_category_label,
                country,
                state,
                egrid_subregion,
                reporting_group,
                owned_leased
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                facility.id,
                facility.facility_name,
                activity_type_id,
                activity_label,
                activity_group,
                protocol_category_code,
                protocol_category_label,
                facility.country,
                facility.state,
                facility.egrid_subregion,
                facility.reporting_group,
                facility.owned_leased,
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
        activity_group: Any,
        source_type: Any,
        gas: Any,
        accounting_method: Any,
        is_biogenic: bool,
    ) -> int:
        row = conn.execute(
            """
            SELECT measure_id
            FROM dim_measure
            WHERE measure_type = ?
              AND unit IS ?
              AND scope IS ?
              AND activity_group IS ?
              AND source_type IS ?
              AND gas IS ?
              AND accounting_method IS ?
              AND is_biogenic = ?
            """,
            (
                measure_type,
                unit,
                scope,
                activity_group,
                source_type,
                gas,
                accounting_method,
                1 if is_biogenic else 0,
            ),
        ).fetchone()
        if row is not None:
            return int(row["measure_id"])
        cur = conn.execute(
            """
            INSERT INTO dim_measure (
                measure_type, unit, scope, activity_group, source_type, gas, accounting_method, is_biogenic
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (measure_type, unit, scope, activity_group, source_type, gas, accounting_method, 1 if is_biogenic else 0),
        )
        return int(cur.lastrowid)
