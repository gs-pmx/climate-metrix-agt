from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from ghg_engine.models import ProjectSnapshot

from .sqlite_common import connect_sqlite, utc_now_iso


class SQLiteWorkspaceDraftStore:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    @staticmethod
    def ensure_schema(conn: sqlite3.Connection) -> None:
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

            CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_workspace_versions_project_version
                ON project_versions(project_id, version_number DESC);
            """
        )

    def _connect(self) -> sqlite3.Connection:
        return connect_sqlite(self._db_path)

    def list_projects(self, *, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        if conn is None:
            with self._connect() as own_conn:
                return self.list_projects(conn=own_conn)
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

    def create_project(
        self,
        *,
        project_id: str,
        name: str,
        inventory_year: int,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self._connect() as own_conn:
                return self.create_project(
                    project_id=project_id,
                    name=name,
                    inventory_year=inventory_year,
                    conn=own_conn,
                )
        now = utc_now_iso()
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

    def rename_project(
        self,
        project_id: str,
        new_name: str,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self._connect() as own_conn:
                return self.rename_project(project_id, new_name, conn=own_conn)
        now = utc_now_iso()
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

    def delete_project(self, project_id: str, *, conn: sqlite3.Connection | None = None) -> None:
        if conn is None:
            with self._connect() as own_conn:
                self.delete_project(project_id, conn=own_conn)
                return
        cur = conn.execute("DELETE FROM projects WHERE project_id = ?", (project_id,))
        if cur.rowcount == 0:
            raise KeyError("Project not found.")

    def list_versions(
        self,
        project_id: str,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        if conn is None:
            with self._connect() as own_conn:
                return self.list_versions(project_id, conn=own_conn)
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

    def get_version_snapshot(
        self,
        project_id: str,
        version_number: int | None = None,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self._connect() as own_conn:
                return self.get_version_snapshot(project_id, version_number=version_number, conn=own_conn)
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

    def save_workspace_snapshot(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self._connect() as own_conn:
                return self.save_workspace_snapshot(
                    project_id=project_id,
                    inventory_year=inventory_year,
                    gwp_set=gwp_set,
                    include_trace=include_trace,
                    snapshot=snapshot,
                    note=note,
                    conn=own_conn,
                )
        now = utc_now_iso()
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
                snapshot.model_dump_json(by_alias=True),
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
        return {
            "project_id": project_id,
            "version_id": version_id,
            "version_number": next_version,
            "created_at": now,
        }
