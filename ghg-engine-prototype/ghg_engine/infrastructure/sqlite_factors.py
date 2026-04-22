from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from hashlib import sha1
from pathlib import Path
from typing import Any
from uuid import uuid4

from ghg_engine.domain import CanonicalFactorRecord
from ghg_engine.factors import FactorQuery, FactorRepository
from ghg_engine.models import EmissionFactorRow
from ghg_engine.services import FactorSelectionService

from .sqlite_common import connect_sqlite, utc_now_iso

_CATEGORY_TO_DOMAIN: dict[str, str] = {
    "mobile-combustion": "combustion",
    "stationary-energy": "combustion",
    "purchased-electricity": "electricity-generation",
    "purchased-steam": "combustion",
    "3.4-upstream-transportation-distribution": "freight-transport",
    "3.5-waste-operations": "waste-decomposition",
    "3.6-business-travel": "passenger-transport",
    "3.7-employee-commuting": "passenger-transport",
    "fugitive-emission": "refrigerant-release",
}
_ATTR_FROM_DOC = str.maketrans("-", "_")


def _get(doc: dict[str, Any], *keys: str, default=None):
    node: Any = doc
    for key in keys:
        if not isinstance(node, dict):
            return default
        node = node.get(key, default)
    return node


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _doc_accounting_method(doc: dict[str, Any]) -> str:
    domain = str(_get(doc, "classification", "domain", default=""))
    if domain != "electricity-generation":
        return "none"
    explicit = _get(doc, "accounting", "method")
    if explicit in {"location_based", "market_based", "none"}:
        return str(explicit)
    text = " ".join(
        str(value).lower()
        for value in [
            doc.get("factor_key", ""),
            _get(doc, "classification", "subtype", default=""),
            _get(doc, "provenance", "source_detail", default=""),
        ]
    )
    if any(
        token in text
        for token in [
            "residual-mix",
            "residual mix",
            "supplier-specific",
            "supplier specific",
            "contractual",
            "ppa",
            "rec",
            "tariff",
        ]
    ):
        return "market_based"
    return "location_based"


def _normalize_description(doc: dict[str, Any]) -> str | None:
    subtype = _get(doc, "classification", "subtype")
    if subtype is None:
        return None
    normalized = str(subtype)
    denom = _get(doc, "factor", "unit_denominator")
    if denom:
        suffix = f"-{str(denom).strip().lower()}"
        if normalized.lower().endswith(suffix):
            normalized = normalized[: -len(suffix)]
    return normalized


def _maybe_substance_code(doc: dict[str, Any], description: str | None) -> str | None:
    domain = str(_get(doc, "classification", "domain", default=""))
    if domain != "refrigerant-release":
        return None
    candidate = description or str(_get(doc, "classification", "subtype", default="")).strip()
    return candidate or None


def _unit_label(factor: dict[str, Any]) -> str | None:
    if factor.get("unit_label"):
        return str(factor["unit_label"])
    numerator = factor.get("unit_numerator")
    denominator = factor.get("unit_denominator")
    if numerator and denominator:
        return f"{numerator}/{denominator}"
    if numerator:
        return str(numerator)
    basis = factor.get("unit_basis")
    if basis == "dimensionless":
        return "unitless"
    return None


class SQLiteFactorRepository:
    def __init__(self, db_path: Path, *, dataset_key: str | None = None):
        self._db_path = db_path
        self._dataset_key = dataset_key
        self._selector = FactorSelectionService()

    def _connect(self) -> sqlite3.Connection:
        return connect_sqlite(self._db_path)

    def _dataset(self, conn: sqlite3.Connection) -> sqlite3.Row | None:
        if self._dataset_key is not None:
            return conn.execute(
                """
                SELECT dataset_id, dataset_key, source_name, source_year, version_label, status
                FROM factor_datasets
                WHERE dataset_key = ?
                """,
                (self._dataset_key,),
            ).fetchone()
        return conn.execute(
            """
            SELECT dataset_id, dataset_key, source_name, source_year, version_label, status
            FROM factor_datasets
            WHERE status = 'published'
            ORDER BY COALESCE(published_at, imported_at) DESC
            LIMIT 1
            """
        ).fetchone()

    def _translate_query(self, q: FactorQuery) -> tuple[str, str, str]:
        return (
            _CATEGORY_TO_DOMAIN.get(q.emission_category, q.emission_category),
            q.type,
            q.attribute,
        )

    def _coarse_records(self, conn: sqlite3.Connection, q: FactorQuery) -> list[CanonicalFactorRecord]:
        dataset = self._dataset(conn)
        if dataset is None:
            return []
        emission_category, factor_type, attribute = self._translate_query(q)
        rows = conn.execute(
            """
            SELECT *
            FROM factor_versions
            WHERE dataset_id = ?
              AND emission_category = ?
              AND factor_type = ?
              AND attribute = ?
            """,
            (dataset["dataset_id"], emission_category, factor_type, attribute),
        ).fetchall()
        return [self._record_from_row(row) for row in rows]

    def _record_from_row(self, row: sqlite3.Row) -> CanonicalFactorRecord:
        return CanonicalFactorRecord(
            factor_id=str(row["source_record_key"] or row["factor_version_id"]),
            emission_category=str(row["emission_category"]),
            type=str(row["factor_type"]),
            description=row["subtype_or_description"],
            attribute=str(row["attribute"]),
            greenhouse_gas=row["greenhouse_gas"],
            gas=row["greenhouse_gas"],
            value=float(row["value"]),
            unit=str(row["unit_label"]),
            unit_label=row["unit_label"],
            unit_1=row["unit_numerator"],
            unit_2=row["unit_denominator"],
            life_cycle_stage=row["life_cycle_stage"],
            geography_global=bool(row["geography_global"]),
            region=row["region"],
            country=row["country"],
            state=row["state"],
            egrid_subregion=row["egrid_subregion"],
            factor_source=row["source_id"],
            source_entity_short=row["source_id"],
            data_year=int(row["data_year"]) if row["data_year"] is not None else None,
            priority=float(row["priority"]) if row["priority"] is not None else None,
            confidence=float(row["confidence"]) if row["confidence"] is not None else None,
            confidence_level=row["confidence_level"],
            updated_at=_parse_date(row["updated_at"]),
            last_updated=_parse_date(row["last_updated"]),
            valid_from=_parse_date(row["valid_from"]),
            valid_to=_parse_date(row["valid_to"]),
            accounting_method=str(row["accounting_method"] or "none"),
            factor_role=row["factor_role"],
        )

    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        with self._connect() as conn:
            records = self._coarse_records(conn, q)
        return [
            FactorRepository._model_from_canonical(record)
            for record in self._selector.candidates(records, q)
        ]

    def select_best(
        self,
        q: FactorQuery,
        *,
        trace: list[str] | None = None,
    ) -> EmissionFactorRow | None:
        with self._connect() as conn:
            records = self._coarse_records(conn, q)
        chosen = self._selector.select_best(
            records,
            q,
            trace=trace,
            trace_prefix="sqlite factor select",
        )
        return FactorRepository._model_from_canonical(chosen) if chosen is not None else None

    def find(self, q: FactorQuery) -> list[EmissionFactorRow]:
        return self.candidates(q)

    def select(self, q: FactorQuery) -> EmissionFactorRow | None:
        return self.select_best(q)

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM factor_versions
                WHERE source_record_key = ? OR factor_version_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (factor_id, factor_id),
            ).fetchone()
        if row is None:
            return None
        return FactorRepository._model_from_canonical(self._record_from_row(row))

    def preview(self, query_text: str | None = None) -> list[dict[str, str]]:
        with self._connect() as conn:
            dataset = self._dataset(conn)
            if dataset is None:
                return []
            params: list[Any] = [dataset["dataset_id"]]
            sql = """
                SELECT source_record_key, emission_category, factor_type, subtype_or_description,
                       attribute, greenhouse_gas, unit_label, source_id
                FROM factor_versions
                WHERE dataset_id = ?
            """
            if query_text:
                sql += """
                    AND LOWER(
                        COALESCE(source_record_key, '') || ' ' ||
                        COALESCE(emission_category, '') || ' ' ||
                        COALESCE(factor_type, '') || ' ' ||
                        COALESCE(subtype_or_description, '') || ' ' ||
                        COALESCE(attribute, '') || ' ' ||
                        COALESCE(source_id, '')
                    ) LIKE ?
                """
                params.append(f"%{query_text.lower()}%")
            sql += " ORDER BY factor_type, attribute LIMIT 100"
            rows = conn.execute(sql, params).fetchall()
        return [
            {
                "factor_id": str(row["source_record_key"] or ""),
                "emission_category": str(row["emission_category"] or ""),
                "type": str(row["factor_type"] or ""),
                "description": str(row["subtype_or_description"] or ""),
                "attribute": str(row["attribute"] or ""),
                "gas": str(row["greenhouse_gas"] or ""),
                "unit": str(row["unit_label"] or ""),
                "factor_source": str(row["source_id"] or ""),
            }
            for row in rows
        ]

    def count(self) -> int:
        with self._connect() as conn:
            dataset = self._dataset(conn)
            if dataset is None:
                return 0
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM factor_versions WHERE dataset_id = ?",
                (dataset["dataset_id"],),
            ).fetchone()
        return int(row["c"]) if row is not None else 0


class SQLiteFactorStore:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    @staticmethod
    def ensure_schema(conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS factor_datasets (
                dataset_id TEXT PRIMARY KEY,
                dataset_key TEXT NOT NULL UNIQUE,
                source_name TEXT NOT NULL,
                source_year INTEGER,
                version_label TEXT NOT NULL,
                status TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                published_at TEXT,
                parent_dataset_id TEXT,
                notes TEXT,
                FOREIGN KEY(parent_dataset_id) REFERENCES factor_datasets(dataset_id)
            );

            CREATE TABLE IF NOT EXISTS factor_lineages (
                lineage_id TEXT PRIMARY KEY,
                lineage_key TEXT NOT NULL UNIQUE,
                canonical_name TEXT,
                emission_category TEXT NOT NULL,
                factor_type TEXT NOT NULL,
                attribute TEXT NOT NULL,
                greenhouse_gas TEXT,
                factor_role TEXT NOT NULL,
                substance_code TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS factor_versions (
                factor_version_id TEXT PRIMARY KEY,
                dataset_id TEXT NOT NULL,
                lineage_id TEXT NOT NULL,
                source_record_key TEXT,
                emission_category TEXT NOT NULL,
                classification_class TEXT,
                factor_type TEXT NOT NULL,
                subtype_or_description TEXT,
                attribute TEXT NOT NULL,
                greenhouse_gas TEXT,
                factor_role TEXT NOT NULL,
                accounting_method TEXT NOT NULL,
                life_cycle_stage TEXT,
                value REAL NOT NULL,
                unit_label TEXT NOT NULL,
                unit_numerator TEXT,
                unit_denominator TEXT,
                geography_global INTEGER NOT NULL DEFAULT 0,
                geographic_specificity TEXT,
                region TEXT,
                country TEXT,
                state TEXT,
                egrid_subregion TEXT,
                data_year INTEGER,
                valid_from TEXT,
                valid_to TEXT,
                priority REAL,
                confidence REAL,
                confidence_level TEXT,
                source_id TEXT,
                source_detail TEXT,
                updated_at TEXT,
                last_updated TEXT,
                substance_code TEXT,
                extra_json TEXT,
                row_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(dataset_id) REFERENCES factor_datasets(dataset_id) ON DELETE CASCADE,
                FOREIGN KEY(lineage_id) REFERENCES factor_lineages(lineage_id)
            );

            CREATE TABLE IF NOT EXISTS factor_source_docs (
                source_doc_id TEXT PRIMARY KEY,
                dataset_id TEXT NOT NULL,
                source_record_key TEXT,
                source_format TEXT NOT NULL,
                raw_payload TEXT NOT NULL,
                raw_hash TEXT NOT NULL,
                parsed_ok INTEGER NOT NULL DEFAULT 1,
                parse_errors_json TEXT,
                imported_at TEXT NOT NULL,
                FOREIGN KEY(dataset_id) REFERENCES factor_datasets(dataset_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_factor_datasets_status
                ON factor_datasets(status, published_at DESC, imported_at DESC);
            CREATE INDEX IF NOT EXISTS idx_factor_versions_lookup
                ON factor_versions(dataset_id, emission_category, factor_type, attribute);
            CREATE INDEX IF NOT EXISTS idx_factor_versions_lineage
                ON factor_versions(lineage_id, dataset_id);
            CREATE INDEX IF NOT EXISTS idx_factor_versions_source_key
                ON factor_versions(source_record_key, dataset_id);
            CREATE INDEX IF NOT EXISTS idx_factor_source_docs_dataset
                ON factor_source_docs(dataset_id);
            """
        )

    def factor_repository(self, dataset_key: str | None = None) -> SQLiteFactorRepository:
        return SQLiteFactorRepository(self._db_path, dataset_key=dataset_key)

    def current_factor_dataset(
        self,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if conn is None:
            with connect_sqlite(self._db_path) as own_conn:
                return self.current_factor_dataset(conn=own_conn)
        row = conn.execute(
            """
            SELECT dataset_id, dataset_key, source_name, source_year, version_label, status,
                   imported_at, published_at, parent_dataset_id, notes
            FROM factor_datasets
            WHERE status = 'published'
            ORDER BY COALESCE(published_at, imported_at) DESC
            LIMIT 1
            """
        ).fetchone()
        return dict(row) if row is not None else None

    def import_factor_documents(
        self,
        *,
        dataset_key: str,
        source_name: str,
        version_label: str,
        docs: list[dict[str, Any]],
        publish: bool = True,
        notes: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with connect_sqlite(self._db_path) as own_conn:
                return self.import_factor_documents(
                    dataset_key=dataset_key,
                    source_name=source_name,
                    version_label=version_label,
                    docs=docs,
                    publish=publish,
                    notes=notes,
                    conn=own_conn,
                )

        existing = conn.execute(
            """
            SELECT dataset_id, dataset_key, version_label, status
            FROM factor_datasets
            WHERE dataset_key = ?
            """,
            (dataset_key,),
        ).fetchone()
        if existing is not None:
            return {
                "dataset_id": existing["dataset_id"],
                "dataset_key": existing["dataset_key"],
                "version_label": existing["version_label"],
                "status": existing["status"],
                "imported_docs": 0,
                "factor_versions": 0,
            }

        now = utc_now_iso()
        dataset_id = f"fds_{uuid4().hex[:12]}"
        source_years = [
            _get(doc, "provenance", "data_year")
            for doc in docs
            if _get(doc, "provenance", "data_year") is not None
        ]
        source_year = max(int(year) for year in source_years) if source_years else None
        parent = self.current_factor_dataset(conn=conn) if publish else None
        conn.execute(
            """
            INSERT INTO factor_datasets (
                dataset_id, dataset_key, source_name, source_year, version_label, status,
                imported_at, published_at, parent_dataset_id, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                dataset_key,
                source_name,
                source_year,
                version_label,
                "published" if publish else "staging",
                now,
                now if publish else None,
                parent["dataset_id"] if parent is not None else None,
                notes,
            ),
        )
        if publish:
            conn.execute(
                """
                UPDATE factor_datasets
                SET status = 'retired'
                WHERE status = 'published' AND dataset_id <> ?
                """,
                (dataset_id,),
            )

        imported_count = 0
        for index, doc in enumerate(docs):
            imported_count += self._insert_document(conn, dataset_id=dataset_id, doc=doc, index=index, imported_at=now)

        return {
            "dataset_id": dataset_id,
            "dataset_key": dataset_key,
            "version_label": version_label,
            "status": "published" if publish else "staging",
            "imported_docs": len(docs),
            "factor_versions": imported_count,
        }

    def import_factor_json(
        self,
        json_path: Path,
        *,
        dataset_key: str,
        source_name: str,
        version_label: str,
        publish: bool = True,
        notes: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        with open(json_path, encoding="utf-8") as handle:
            docs = json.load(handle)
        return self.import_factor_documents(
            dataset_key=dataset_key,
            source_name=source_name,
            version_label=version_label,
            docs=docs,
            publish=publish,
            notes=notes,
            conn=conn,
        )

    def _insert_document(
        self,
        conn: sqlite3.Connection,
        *,
        dataset_id: str,
        doc: dict[str, Any],
        index: int,
        imported_at: str,
    ) -> int:
        source_record_key = str(doc.get("factor_key") or doc.get("_id") or f"doc_{index + 1}")
        raw_payload = json.dumps(doc, sort_keys=True)
        raw_hash = sha1(raw_payload.encode("utf-8")).hexdigest()
        try:
            canonical, lineage = self._canonical_row(doc)
        except (TypeError, ValueError) as exc:
            conn.execute(
                """
                INSERT INTO factor_source_docs (
                    source_doc_id, dataset_id, source_record_key, source_format, raw_payload,
                    raw_hash, parsed_ok, parse_errors_json, imported_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    f"fsd_{sha1(f'{dataset_id}|{source_record_key}|{raw_hash}'.encode()).hexdigest()[:16]}",
                    dataset_id,
                    source_record_key,
                    "json",
                    raw_payload,
                    raw_hash,
                    json.dumps([str(exc)]),
                    imported_at,
                ),
            )
            return 0
        conn.execute(
            """
            INSERT OR IGNORE INTO factor_lineages (
                lineage_id, lineage_key, canonical_name, emission_category, factor_type,
                attribute, greenhouse_gas, factor_role, substance_code, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lineage["lineage_id"],
                lineage["lineage_key"],
                lineage["canonical_name"],
                lineage["emission_category"],
                lineage["factor_type"],
                lineage["attribute"],
                lineage["greenhouse_gas"],
                lineage["factor_role"],
                lineage["substance_code"],
                imported_at,
            ),
        )

        factor_version_id = f"fv_{sha1(f'{dataset_id}|{source_record_key}'.encode()).hexdigest()[:16]}"
        extra_json = json.dumps(canonical["extra_json"], sort_keys=True)
        row_json = json.dumps(canonical["row_json"], sort_keys=True)

        conn.execute(
            """
            INSERT INTO factor_versions (
                factor_version_id, dataset_id, lineage_id, source_record_key, emission_category,
                classification_class, factor_type, subtype_or_description, attribute,
                greenhouse_gas, factor_role, accounting_method, life_cycle_stage, value,
                unit_label, unit_numerator, unit_denominator, geography_global,
                geographic_specificity, region, country, state, egrid_subregion, data_year,
                valid_from, valid_to, priority, confidence, confidence_level, source_id,
                source_detail, updated_at, last_updated, substance_code, extra_json, row_json,
                created_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                factor_version_id,
                dataset_id,
                lineage["lineage_id"],
                source_record_key,
                canonical["emission_category"],
                canonical["classification_class"],
                canonical["factor_type"],
                canonical["subtype_or_description"],
                canonical["attribute"],
                canonical["greenhouse_gas"],
                canonical["factor_role"],
                canonical["accounting_method"],
                canonical["life_cycle_stage"],
                canonical["value"],
                canonical["unit_label"],
                canonical["unit_numerator"],
                canonical["unit_denominator"],
                1 if canonical["geography_global"] else 0,
                canonical["geographic_specificity"],
                canonical["region"],
                canonical["country"],
                canonical["state"],
                canonical["egrid_subregion"],
                canonical["data_year"],
                canonical["valid_from"],
                canonical["valid_to"],
                canonical["priority"],
                canonical["confidence"],
                canonical["confidence_level"],
                canonical["source_id"],
                canonical["source_detail"],
                canonical["updated_at"],
                canonical["last_updated"],
                canonical["substance_code"],
                extra_json,
                row_json,
                imported_at,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_source_docs (
                source_doc_id, dataset_id, source_record_key, source_format, raw_payload,
                raw_hash, parsed_ok, parse_errors_json, imported_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)
            """,
            (
                f"fsd_{sha1(f'{dataset_id}|{source_record_key}|{raw_hash}'.encode()).hexdigest()[:16]}",
                dataset_id,
                source_record_key,
                "json",
                raw_payload,
                raw_hash,
                imported_at,
            ),
        )
        return 1

    def _canonical_row(self, doc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        classification = doc.get("classification", {})
        geography = doc.get("geography", {})
        factor = doc.get("factor", {})
        provenance = doc.get("provenance", {})
        versioning = doc.get("versioning", {})
        description = _normalize_description(doc)
        attribute = str(factor.get("attribute", "")).translate(_ATTR_FROM_DOC)
        factor_role = "heat_content" if attribute == "heat_content" else "emission_factor"
        emission_category = str(classification.get("domain", ""))
        greenhouse_gas = factor.get("greenhouse_gas")
        substance_code = _maybe_substance_code(doc, description)
        raw_value = factor.get("value")
        unit_label = _unit_label(factor)
        if raw_value is None:
            raise ValueError("missing factor.value")
        if unit_label is None:
            raise ValueError("missing factor.unit_label")
        lineage_seed = str(
            doc.get("lineage_id")
            or "|".join(
                str(value or "")
                for value in [
                    emission_category,
                    classification.get("type"),
                    description,
                    attribute,
                    greenhouse_gas,
                ]
            )
        )
        lineage_id = str(doc.get("lineage_id") or f"lin_{sha1(lineage_seed.encode('utf-8')).hexdigest()[:16]}")
        row_json = CanonicalFactorRecord(
            factor_id=str(doc.get("factor_key") or doc.get("_id") or lineage_id),
            emission_category=emission_category,
            type=str(classification.get("type", "")),
            description=description,
            attribute=attribute,
            greenhouse_gas=greenhouse_gas,
            gas=greenhouse_gas,
            value=float(raw_value),
            unit=unit_label,
            unit_label=unit_label,
            unit_1=factor.get("unit_numerator"),
            unit_2=factor.get("unit_denominator"),
            life_cycle_stage=classification.get("life_cycle_stage"),
            geography_global=(geography.get("geographic_specificity") == "global"),
            region=geography.get("region"),
            country=geography.get("country"),
            state=geography.get("state"),
            egrid_subregion=geography.get("grid_region_code"),
            factor_source=provenance.get("source_id"),
            source_entity_short=provenance.get("source_id"),
            data_year=int(provenance["data_year"]) if provenance.get("data_year") is not None else None,
            priority=None,
            confidence=None,
            confidence_level=provenance.get("confidence_level"),
            updated_at=_parse_date(doc.get("updated_at")),
            last_updated=_parse_date(doc.get("updated_at")),
            valid_from=_parse_date(versioning.get("valid_from")),
            valid_to=_parse_date(versioning.get("valid_to")),
            accounting_method=_doc_accounting_method(doc),
            factor_role=factor_role,
        ).model_dump(mode="json")
        canonical = {
            "emission_category": emission_category,
            "classification_class": classification.get("class"),
            "factor_type": str(classification.get("type", "")),
            "subtype_or_description": description,
            "attribute": attribute,
            "greenhouse_gas": greenhouse_gas,
            "factor_role": factor_role,
            "accounting_method": _doc_accounting_method(doc),
            "life_cycle_stage": classification.get("life_cycle_stage"),
            "value": float(raw_value),
            "unit_label": unit_label,
            "unit_numerator": factor.get("unit_numerator"),
            "unit_denominator": factor.get("unit_denominator"),
            "geography_global": geography.get("geographic_specificity") == "global",
            "geographic_specificity": geography.get("geographic_specificity"),
            "region": geography.get("region"),
            "country": geography.get("country"),
            "state": geography.get("state"),
            "egrid_subregion": geography.get("grid_region_code"),
            "data_year": int(provenance["data_year"]) if provenance.get("data_year") is not None else None,
            "valid_from": versioning.get("valid_from"),
            "valid_to": versioning.get("valid_to"),
            "priority": None,
            "confidence": None,
            "confidence_level": provenance.get("confidence_level"),
            "source_id": provenance.get("source_id"),
            "source_detail": provenance.get("source_detail"),
            "updated_at": doc.get("updated_at"),
            "last_updated": doc.get("updated_at"),
            "substance_code": substance_code,
            "extra_json": {
                "versioning": versioning,
                "classification_subtype": classification.get("subtype"),
                "raw_provenance": {
                    key: value
                    for key, value in provenance.items()
                    if key not in {"source_id", "source_detail", "data_year", "confidence_level"}
                },
            },
            "row_json": row_json,
        }
        lineage = {
            "lineage_id": lineage_id,
            "lineage_key": lineage_id,
            "canonical_name": description,
            "emission_category": emission_category,
            "factor_type": str(classification.get("type", "")),
            "attribute": attribute,
            "greenhouse_gas": greenhouse_gas,
            "factor_role": factor_role,
            "substance_code": substance_code,
        }
        return canonical, lineage
