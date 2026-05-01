from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from ghg_engine.infrastructure.sqlite_common import connect_sqlite, utc_now_iso
from ghg_engine.infrastructure.sqlite_factors import SQLiteFactorStore
from ghg_engine.infrastructure.sqlite_inventory import SQLiteInventoryStore
from ghg_engine.infrastructure.sqlite_workspace import SQLiteWorkspaceDraftStore
from ghg_engine.models import ProjectSnapshot
from ghg_engine.ports.persistence import InventoryRepository, WorkspaceDraftRepository
from ghg_engine.services.applicability import build_applicability_map
from ghg_engine.services.factor_source_coverage import (
    build_factor_source_coverage,
    build_full_inventory_factor_catalog,
)


class ProjectService:
    """Orchestrates workspace + inventory + factor operations for a project lifecycle.

    ``save_and_materialize`` atomically persists a workspace snapshot, materializes
    the inventory version, and records a calculation run, all within a single
    connection so failure at any step rolls back cleanly.
    """

    def __init__(
        self,
        workspace: WorkspaceDraftRepository,
        inventory: InventoryRepository,
        factors: SQLiteFactorStore,
    ) -> None:
        self._workspace = workspace
        self._inventory = inventory
        self._factors = factors

    def save_and_materialize(
        self,
        *,
        conn: sqlite3.Connection,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Atomically save workspace version, materialize inventory, and record a calc run.

        The caller owns ``conn``; this method does not open or close it. All three
        sub-operations share the connection so they participate in one transaction.
        """
        saved = self._workspace.save_workspace_snapshot(
            project_id=project_id,
            inventory_year=inventory_year,
            gwp_set=gwp_set,
            include_trace=include_trace,
            snapshot=snapshot,
            note=note,
            conn=conn,
        )
        inventory = self._inventory.save_inventory_version(
            project_id=project_id,
            workspace_version_id=saved["version_id"],
            inventory_year=inventory_year,
            gwp_set=gwp_set,
            include_trace=include_trace,
            snapshot=snapshot,
            note=note,
            conn=conn,
        )
        current_dataset = self._factors.current_factor_dataset(conn=conn)
        self._inventory.save_calculation_run(
            inventory_version_id=int(inventory["inventory_version_id"]),
            workspace_version_id=saved["version_id"],
            factor_dataset_id=(current_dataset or {}).get("dataset_id"),
            results=snapshot.result_rows,
            traces=snapshot.trace_rows,
            engine_version="workspace_snapshot",
            applicability=build_applicability_map(snapshot),
            conn=conn,
        )
        # Phase D1: explicit version supersedes any in-flight draft.
        # Cleared in the same transaction so a partial failure rolls
        # back the draft delete along with the rest.
        self._workspace.delete_draft(project_id, conn=conn)
        return saved


class ProjectStore:
    """Convenience facade over workspace, inventory, factors, and service.

    Prefer accessing the sub-components directly (``store.workspace``,
    ``store.inventory``, ``store.factors``, ``store.service``) in new code.
    The top-level methods on this class are retained as thin delegates so
    existing callers continue to work.

    Schema and migration methods remain on the facade because they are
    cross-cutting DB-lifecycle concerns rather than per-entity repository ops.
    """

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._workspace = SQLiteWorkspaceDraftStore(db_path)
        self._inventory = SQLiteInventoryStore(db_path)
        self._factors = SQLiteFactorStore(db_path)
        self._service = ProjectService(self._workspace, self._inventory, self._factors)
        self._init_db()

    # ------------------------------------------------------------------
    # Direct accessors (new preferred surface).
    # ------------------------------------------------------------------
    @property
    def workspace(self) -> SQLiteWorkspaceDraftStore:
        return self._workspace

    @property
    def inventory(self) -> SQLiteInventoryStore:
        return self._inventory

    @property
    def factors(self) -> SQLiteFactorStore:
        return self._factors

    @property
    def service(self) -> ProjectService:
        return self._service

    # ------------------------------------------------------------------
    # Connection + migrations (DB-lifecycle concerns live on the facade).
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        return connect_sqlite(self._db_path)

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
                (
                    6,
                    "canonical factor warehouse and split draft inventory storage",
                    self._migration_6_canonical_storage_split,
                ),
                (
                    7,
                    "autosave draft buffer (project_drafts)",
                    self._migration_7_project_drafts,
                ),
                (
                    8,
                    "analytics index on calculation_results (inventory_version_id, facility_id)",
                    self._migration_8_analytics_index,
                ),
                (
                    9,
                    "spend-based emissions: gl_mappings, fx_rates, inflation_indices, "
                    "factor_kind on factor_versions, seed reference data",
                    self._migration_9_spend_based_foundation,
                ),
                (
                    10,
                    "gl_mappings.gl_account_name: human-readable label alongside gl_code",
                    self._migration_10_gl_account_name,
                ),
                (
                    11,
                    "strip AR6 footnote markers from refrigerant subtypes so the matcher resolves them",
                    self._migration_11_strip_refrigerant_footnote_markers,
                ),
                (
                    12,
                    "covering index on factor_versions(factor_kind, emission_category, factor_type, attribute) "
                    "for the post-#33 _coarse_records lookup",
                    self._migration_12_factor_lookup_covering_index,
                ),
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

    def _migration_6_canonical_storage_split(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            DROP INDEX IF EXISTS idx_fact_actuals_version;
            DROP TABLE IF EXISTS fact_actuals;
            DROP TABLE IF EXISTS dim_measure;
            DROP TABLE IF EXISTS dim_entity;
            DROP TABLE IF EXISTS dim_date;
            """
        )
        self._workspace.ensure_schema(conn)
        self._inventory.ensure_schema(conn)
        self._factors.ensure_schema(conn)

    def _migration_7_project_drafts(self, conn: sqlite3.Connection) -> None:
        # Phase D1 — autosave buffer. One row per project; UPSERTed by
        # the periodic autosave path. Cleared when a real version is
        # saved through ``ProjectService.save_and_materialize`` so the
        # explicit-version snapshot remains the canonical checkpoint.
        self._workspace.ensure_draft_schema(conn)

    def _migration_8_analytics_index(self, conn: sqlite3.Connection) -> None:
        # Phase D3 — dashboard analytics endpoint queries
        # ``calculation_results`` filtered by ``inventory_version_id``
        # and grouped by ``facility_id``. Existing DBs that completed
        # migration 6 already have the table; they just need the
        # composite index. ``ensure_schema`` is idempotent and will
        # only create the new index for already-migrated databases.
        self._inventory.ensure_schema(conn)

    def _migration_9_spend_based_foundation(self, conn: sqlite3.Connection) -> None:
        # Phase E1 — spend-based emissions backend foundation. Three new
        # tables (gl_mappings, fx_rates, inflation_indices), a new
        # ``factor_kind`` discriminator column on ``factor_versions``, and
        # the bundled FX + CPI seed data. The legacy migration_3 stub
        # ``factors`` table also gets the discriminator column so any
        # caller that still touches it sees the same shape.
        #
        # The column is named ``factor_kind`` rather than ``factor_type``
        # because ``factor_versions.factor_type`` is already in use as a
        # subtype/classification field (e.g. ``gasoline``, ``diesel``).
        # The new column carries the orthogonal physical/spend bit.
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS gl_mappings (
                mapping_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                reporting_unit_id TEXT,
                gl_code TEXT NOT NULL,
                factor_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
                UNIQUE(project_id, reporting_unit_id, gl_code)
            );
            CREATE INDEX IF NOT EXISTS idx_gl_mappings_project
                ON gl_mappings(project_id, reporting_unit_id);

            CREATE TABLE IF NOT EXISTS fx_rates (
                currency TEXT NOT NULL,
                year INTEGER NOT NULL,
                rate_to_usd REAL NOT NULL,
                source TEXT NOT NULL,
                PRIMARY KEY(currency, year)
            );

            CREATE TABLE IF NOT EXISTS inflation_indices (
                index_name TEXT NOT NULL,
                year INTEGER NOT NULL,
                index_value REAL NOT NULL,
                source TEXT NOT NULL,
                PRIMARY KEY(index_name, year)
            );
            """
        )

        # Add the kind discriminator to factor_versions (canonical store)
        # and to the migration_3 stub factors table. SQLite has no ADD
        # COLUMN IF NOT EXISTS, so we introspect first.
        for table_name in ("factor_versions", "factors"):
            cols = {
                row["name"]
                for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
            }
            if not cols:
                # Table doesn't exist (legacy install where migration_3
                # was skipped or factor_versions hasn't been created
                # yet). ensure_schema below will create factor_versions.
                continue
            if "factor_kind" not in cols:
                conn.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN factor_kind TEXT NOT NULL DEFAULT 'physical'"
                )

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_factor_versions_kind "
            "ON factor_versions(factor_kind, dataset_id)"
        )

        # Seed reference data (FX rates and CPI) from the bundled CSVs
        # if present. Idempotent via INSERT OR REPLACE.
        self._seed_reference_data(conn)

    def _migration_10_gl_account_name(self, conn: sqlite3.Connection) -> None:
        # Phase E2 — extend gl_mappings with a human-readable account
        # label. The column is descriptive only (not part of the lookup
        # key) and nullable for backward compatibility with rows created
        # under E1.
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(gl_mappings)").fetchall()
        }
        if "gl_account_name" not in cols:
            conn.execute("ALTER TABLE gl_mappings ADD COLUMN gl_account_name TEXT")

    def _migration_11_strip_refrigerant_footnote_markers(
        self, conn: sqlite3.Connection
    ) -> None:
        # The seed JSON imported refrigerant rows whose subtype values
        # incorporate AR6 Annex VII footnote markers — e.g.
        # ``"HFO-1234yf a"`` instead of ``"HFO-1234yf"``. The
        # ``RefrigerantMassToGwpMethod`` matcher queries by the clean
        # catalog label, so any catalog refrigerant whose subtype
        # carries a marker is unresolvable. The user reported this as
        # "no AR6 GWP factor matched refrigerant_type 'HFO-1234yf'"
        # for refrigerants that *should* be in scope.
        #
        # Fix: strip a trailing single-letter footnote suffix from
        # ``subtype_or_description`` (the field FactorQuery.description
        # ultimately matches against). Other slug fields
        # (``lineage_id``, ``source_record_key``, ``substance_code``,
        # ``greenhouse_gas``) carry the same markers but are
        # cosmetic — leaving them untouched keeps the migration
        # focused on the load-bearing fix and avoids touching every
        # column that incorporates the slug.
        import re

        pattern = re.compile(r" [a-z]$")
        rows = conn.execute(
            """
            SELECT factor_version_id, subtype_or_description
            FROM factor_versions
            WHERE factor_kind = 'physical'
              AND emission_category = 'refrigerant-release'
              AND subtype_or_description GLOB '* [a-z]'
            """
        ).fetchall()
        for row in rows:
            cleaned = pattern.sub("", row["subtype_or_description"])
            if cleaned == row["subtype_or_description"]:
                continue
            conn.execute(
                "UPDATE factor_versions SET subtype_or_description = ? "
                "WHERE factor_version_id = ?",
                (cleaned, row["factor_version_id"]),
            )

    def _migration_12_factor_lookup_covering_index(
        self, conn: sqlite3.Connection
    ) -> None:
        # PR #33 dropped ``dataset_id`` from the ``_coarse_records`` WHERE
        # clause, which left the existing
        # ``idx_factor_versions_lookup`` index (keyed on
        # ``(dataset_id, emission_category, factor_type, attribute)``)
        # unable to serve the lookup. SQLite fell back to filtering
        # against ``idx_factor_versions_kind`` which only narrows by
        # ``factor_kind``, so every per-gas factor query scanned the
        # entire physical-factor set.
        #
        # The new index matches the post-#33 query shape exactly and
        # composes with the join against ``factor_datasets`` (already
        # indexed on ``status`` via ``idx_factor_datasets_status``).
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_factor_versions_physical_lookup
                ON factor_versions(
                    factor_kind, emission_category, factor_type, attribute
                )
            """
        )

    def _seed_reference_data(self, conn: sqlite3.Connection) -> None:
        """Populate fx_rates and inflation_indices from bundled CSVs.

        The CSVs ship at ``data/reference_data/{fx_rates,us_cpi_u}.csv``
        relative to the package root. Missing files are tolerated so the
        migration runs cleanly in test fixtures that don't ship the
        bundled data — tests seed their own rows directly.
        """

        ref_dir = Path(__file__).parent / "data" / "reference_data"

        fx_csv = ref_dir / "fx_rates.csv"
        if fx_csv.is_file():
            self._seed_fx_rates_csv(conn, fx_csv)

        cpi_csv = ref_dir / "us_cpi_u.csv"
        if cpi_csv.is_file():
            self._seed_inflation_csv(conn, cpi_csv, index_name="us_cpi_u")

    @staticmethod
    def _seed_fx_rates_csv(conn: sqlite3.Connection, csv_path: Path) -> None:
        import csv

        with csv_path.open(encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                currency = (row.get("currency") or "").strip().upper()
                year_raw = row.get("year")
                rate_raw = row.get("rate_to_usd")
                source = (row.get("source") or "").strip()
                if not currency or year_raw is None or rate_raw is None:
                    continue
                try:
                    year = int(year_raw)
                    rate = float(rate_raw)
                except (TypeError, ValueError):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO fx_rates (currency, year, rate_to_usd, source) "
                    "VALUES (?, ?, ?, ?)",
                    (currency, year, rate, source or "unknown"),
                )

    @staticmethod
    def _seed_inflation_csv(
        conn: sqlite3.Connection,
        csv_path: Path,
        *,
        index_name: str,
    ) -> None:
        import csv

        with csv_path.open(encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                year_raw = row.get("year")
                value_raw = row.get("index_value")
                source = (row.get("source") or "").strip()
                if year_raw is None or value_raw is None:
                    continue
                try:
                    year = int(year_raw)
                    value = float(value_raw)
                except (TypeError, ValueError):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO inflation_indices "
                    "(index_name, year, index_value, source) VALUES (?, ?, ?, ?)",
                    (index_name, year, value, source or "unknown"),
                )

    # ------------------------------------------------------------------
    # Factor-store delegates (public API surface on the facade).
    # ------------------------------------------------------------------
    def seed_factors(self, json_path: Path) -> int:
        dataset_key = json_path.stem
        with self._connect() as conn:
            imported = self._factors.import_factor_json(
                json_path,
                dataset_key=dataset_key,
                source_name="seed",
                version_label=dataset_key,
                publish=True,
                notes=f"Seeded from {json_path.name}",
                conn=conn,
            )
        return int(imported["factor_versions"])

    def import_factor_documents(
        self,
        *,
        dataset_key: str,
        source_name: str,
        version_label: str,
        docs: list[dict[str, Any]],
        publish: bool = True,
        notes: str | None = None,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            return self._factors.import_factor_documents(
                dataset_key=dataset_key,
                source_name=source_name,
                version_label=version_label,
                docs=docs,
                publish=publish,
                notes=notes,
                conn=conn,
            )

    def factors_connection(self) -> sqlite3.Connection:
        return self._connect()

    def factor_repository(self, dataset_key: str | None = None):
        return self._factors.factor_repository(dataset_key=dataset_key)

    def current_factor_dataset(self) -> dict[str, Any] | None:
        with self._connect() as conn:
            return self._factors.current_factor_dataset(conn=conn)

    def factor_source_coverage(self, activity_types: list[Any]) -> list[dict[str, Any]]:
        factor_rows = self._factors.list_factor_versions_for_coverage()
        return build_factor_source_coverage(activity_types, factor_rows)

    def full_inventory_factor_catalog(self, activity_types: list[Any]) -> list[dict[str, Any]]:
        factor_rows = self._factors.list_factor_versions_for_coverage()
        return build_full_inventory_factor_catalog(activity_types, factor_rows)

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

    # ------------------------------------------------------------------
    # Workspace-repository delegates (backward-compat thin wrappers).
    # ------------------------------------------------------------------
    def list_projects(self) -> list[dict[str, Any]]:
        return self._workspace.list_projects()

    def create_project(self, *, project_id: str, name: str, inventory_year: int) -> dict[str, Any]:
        return self._workspace.create_project(
            project_id=project_id,
            name=name,
            inventory_year=inventory_year,
        )

    def rename_project(self, project_id: str, new_name: str) -> dict[str, Any]:
        return self._workspace.rename_project(project_id, new_name)

    def delete_project(self, project_id: str) -> None:
        self._workspace.delete_project(project_id)

    def list_versions(self, project_id: str) -> list[dict[str, Any]]:
        return self._workspace.list_versions(project_id)

    def get_version_snapshot(self, project_id: str, version_number: int | None = None) -> dict[str, Any]:
        return self._workspace.get_version_snapshot(project_id, version_number=version_number)

    # ------------------------------------------------------------------
    # Draft-buffer delegates (Phase D1 autosave surface).
    # ------------------------------------------------------------------
    def save_project_draft(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
    ) -> dict[str, Any]:
        return self._workspace.save_draft(
            project_id=project_id,
            inventory_year=inventory_year,
            gwp_set=gwp_set,
            include_trace=include_trace,
            snapshot=snapshot,
        )

    def load_project_draft(self, project_id: str) -> dict[str, Any] | None:
        return self._workspace.load_draft(project_id)

    def delete_project_draft(self, project_id: str) -> None:
        self._workspace.delete_draft(project_id)

    # ------------------------------------------------------------------
    # Service delegate (orchestration entry point).
    # ------------------------------------------------------------------
    def save_project_snapshot(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            return self._service.save_and_materialize(
                conn=conn,
                project_id=project_id,
                inventory_year=inventory_year,
                gwp_set=gwp_set,
                include_trace=include_trace,
                snapshot=snapshot,
                note=note,
            )

    # ------------------------------------------------------------------
    # Phase E1 — spend-based emissions: GL mappings, FX, inflation
    # ------------------------------------------------------------------
    def list_gl_mappings(
        self,
        project_id: str,
        *,
        reporting_unit_id: str | None = "__any__",
    ) -> list[dict[str, Any]]:
        """List GL mappings for a project.

        ``reporting_unit_id="__any__"`` (default) returns every row;
        ``None`` returns only the project-wide defaults; passing a string
        returns only rows scoped to that RU.
        """

        with self._connect() as conn:
            if reporting_unit_id == "__any__":
                rows = conn.execute(
                    """
                    SELECT mapping_id, project_id, reporting_unit_id, gl_code,
                           gl_account_name, factor_id, created_at, updated_at
                    FROM gl_mappings
                    WHERE project_id = ?
                    ORDER BY COALESCE(reporting_unit_id, ''), gl_code
                    """,
                    (project_id,),
                ).fetchall()
            elif reporting_unit_id is None:
                rows = conn.execute(
                    """
                    SELECT mapping_id, project_id, reporting_unit_id, gl_code,
                           gl_account_name, factor_id, created_at, updated_at
                    FROM gl_mappings
                    WHERE project_id = ? AND reporting_unit_id IS NULL
                    ORDER BY gl_code
                    """,
                    (project_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT mapping_id, project_id, reporting_unit_id, gl_code,
                           gl_account_name, factor_id, created_at, updated_at
                    FROM gl_mappings
                    WHERE project_id = ? AND reporting_unit_id = ?
                    ORDER BY gl_code
                    """,
                    (project_id, reporting_unit_id),
                ).fetchall()
        return [dict(row) for row in rows]

    def replace_gl_mappings(
        self,
        project_id: str,
        mappings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Atomically replace the project's GL mappings with the given list.

        Each entry must carry ``gl_code`` and ``factor_id``;
        ``reporting_unit_id`` is optional and ``None`` denotes the
        project-wide default.
        """

        project_row = None
        with self._connect() as conn:
            project_row = conn.execute(
                "SELECT project_id FROM projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if project_row is None:
                raise KeyError(f"unknown project_id {project_id}")

            now = utc_now_iso()
            conn.execute("DELETE FROM gl_mappings WHERE project_id = ?", (project_id,))
            for entry in mappings:
                gl_code = str(entry.get("gl_code") or "").strip()
                factor_id = str(entry.get("factor_id") or "").strip()
                if not gl_code or not factor_id:
                    raise ValueError("each gl mapping requires gl_code and factor_id")
                ru = entry.get("reporting_unit_id")
                ru_value = ru if (ru is None or str(ru).strip() == "") else str(ru).strip()
                if ru_value == "":
                    ru_value = None
                account_name_raw = entry.get("gl_account_name")
                account_name = (
                    str(account_name_raw).strip()
                    if account_name_raw is not None and str(account_name_raw).strip()
                    else None
                )
                conn.execute(
                    """
                    INSERT INTO gl_mappings
                        (project_id, reporting_unit_id, gl_code, gl_account_name,
                         factor_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (project_id, ru_value, gl_code, account_name, factor_id, now, now),
                )
        return self.list_gl_mappings(project_id)

    def fx_rate(self, currency: str, year: int) -> dict[str, Any] | None:
        """Return the FX rate row for (currency, year) or None.

        ``rate_to_usd`` semantics: ``usd_amount = local_amount *
        rate_to_usd``. USD is always 1.0.
        """

        normalized = (currency or "").strip().upper()
        if not normalized:
            return None
        if normalized == "USD":
            return {"currency": "USD", "year": int(year), "rate_to_usd": 1.0, "source": "identity"}
        with self._connect() as conn:
            row = conn.execute(
                "SELECT currency, year, rate_to_usd, source FROM fx_rates "
                "WHERE currency = ? AND year = ?",
                (normalized, int(year)),
            ).fetchone()
        return dict(row) if row is not None else None

    def inflation_index(self, index_name: str, year: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT index_name, year, index_value, source FROM inflation_indices "
                "WHERE index_name = ? AND year = ?",
                (index_name, int(year)),
            ).fetchone()
        return dict(row) if row is not None else None

    def list_spend_factors(
        self,
        *,
        dataset_id: str | None = None,
        query: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Browse spend-based factors filtered by optional dataset + free-text query."""

        sql_parts = [
            "SELECT factor_version_id, source_record_key, dataset_id, factor_kind, factor_type,",
            "       subtype_or_description, attribute, value, unit_label, region, country,",
            "       data_year, source_id",
            "FROM factor_versions",
            "WHERE factor_kind = 'spend'",
        ]
        params: list[Any] = []
        if dataset_id:
            sql_parts.append("AND dataset_id = ?")
            params.append(dataset_id)
        if query:
            sql_parts.append(
                "AND LOWER("
                "COALESCE(source_record_key, '') || ' ' || "
                "COALESCE(subtype_or_description, '') || ' ' || "
                "COALESCE(source_id, '') || ' ' || "
                "COALESCE(region, '') || ' ' || "
                "COALESCE(country, '')"
                ") LIKE ?"
            )
            params.append(f"%{query.lower()}%")
        sql_parts.append("ORDER BY factor_type, source_record_key")
        sql_parts.append(f"LIMIT {int(limit)}")
        sql = "\n".join(sql_parts)
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]
