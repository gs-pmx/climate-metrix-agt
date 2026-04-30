from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

from openpyxl import Workbook

from tools.index_ef_sources import build_index, load_manifest


def _write_manifest(path: Path) -> None:
    payload = {
        "schema_version": 1,
        "library_id": "test-efs",
        "sources": [
            {
                "source_id": "synthetic_ef_source",
                "name": "Synthetic EF Source",
                "provider": "Climate Metrix Tests",
                "release_label": "fixture",
                "source_category": "test_factors",
                "candidate_factor_kind": "physical",
                "review_status": "indexed_only",
                "license_status": "fixture",
                "home_url": "https://example.invalid/efs",
                "local_path": "synthetic",
                "file_globs": [
                    "synthetic/*.xlsx",
                    "synthetic/*.csv",
                    "synthetic/*.zip",
                    "synthetic/*.txt",
                ],
                "intended_uses": ["test fixture"],
                "active_ingest_status": "not_mapped",
                "notes": "Synthetic source-library fixture.",
            }
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_xlsx(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Factors"
    sheet.append(["Year", "Country", "CO2e factor", "Unit"])
    sheet.append([2025, "USA", 0.42, "kg/kWh"])
    workbook.save(path)


def _write_fixture_files(efs_root: Path) -> None:
    source_dir = efs_root / "synthetic"
    source_dir.mkdir(parents=True)
    _write_xlsx(source_dir / "factors.xlsx")
    (source_dir / "factors.csv").write_text(
        "Year,Region,Emission factor,Unit\n2025,US,1.25,kg/USD\n",
        encoding="utf-8",
    )
    (source_dir / "notes.txt").write_text("Synthetic factor notes\nUse for tests only\n", encoding="utf-8")
    with zipfile.ZipFile(source_dir / "archive.zip", "w") as archive:
        archive.writestr("inner/table.csv", "code,value\nA,1\n")
    (efs_root / "unmatched.csv").write_text("a,b\n1,2\n", encoding="utf-8")


def test_build_index_captures_manifest_files_tables_columns_and_fts(tmp_path: Path):
    efs_root = tmp_path / "efs"
    efs_root.mkdir()
    manifest = efs_root / "manifest.json"
    _write_manifest(manifest)
    _write_fixture_files(efs_root)
    output = efs_root / "index" / "ef_library.sqlite"

    summary = build_index(
        efs_root=efs_root,
        manifest_path=manifest,
        output_path=output,
        hash_files=True,
        include_unmatched=False,
    )

    assert summary.source_count == 1
    assert summary.file_count == 4
    assert summary.table_count == 4
    assert summary.unmatched_file_count == 0

    with sqlite3.connect(output) as conn:
        conn.row_factory = sqlite3.Row
        files = conn.execute(
            "SELECT relative_path, sha256, table_count FROM source_files ORDER BY relative_path"
        ).fetchall()
        tables = conn.execute(
            "SELECT table_name, table_kind, row_count, column_count FROM source_tables ORDER BY table_kind"
        ).fetchall()
        semantics = {
            row["inferred_semantic"]
            for row in conn.execute(
                "SELECT inferred_semantic FROM source_columns WHERE inferred_semantic IS NOT NULL"
            ).fetchall()
        }

        assert [row["relative_path"] for row in files] == [
            "synthetic/archive.zip",
            "synthetic/factors.csv",
            "synthetic/factors.xlsx",
            "synthetic/notes.txt",
        ]
        assert all(row["sha256"] for row in files)
        assert {row["table_kind"] for row in tables} == {
            "csv",
            "text_preview",
            "xlsx_sheet",
            "zip_entry",
        }
        assert "factor_value" in semantics
        assert "unit" in semantics

        if summary.fts_enabled:
            hits = conn.execute(
                "SELECT entity_type, source_id FROM search_index WHERE search_index MATCH 'co2e'"
            ).fetchall()
            assert hits
            assert {row["source_id"] for row in hits} == {"synthetic_ef_source"}


def test_build_index_records_unmatched_files_when_requested(tmp_path: Path):
    efs_root = tmp_path / "efs"
    efs_root.mkdir()
    manifest = efs_root / "manifest.json"
    _write_manifest(manifest)
    _write_fixture_files(efs_root)
    output = efs_root / "index.sqlite"

    summary = build_index(
        efs_root=efs_root,
        manifest_path=manifest,
        output_path=output,
        hash_files=False,
        include_unmatched=True,
    )

    assert summary.file_count == 5
    assert summary.unmatched_file_count == 1
    with sqlite3.connect(output) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT source_id, relative_path FROM source_files WHERE source_id = '_unmatched'"
        ).fetchone()
    assert dict(row) == {"source_id": "_unmatched", "relative_path": "unmatched.csv"}


def test_manifest_requires_unique_source_ids(tmp_path: Path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "sources": [
                    {"source_id": "dupe", "name": "One", "file_globs": ["one/*"]},
                    {"source_id": "dupe", "name": "Two", "file_globs": ["two/*"]},
                ]
            }
        ),
        encoding="utf-8",
    )

    try:
        load_manifest(manifest)
    except ValueError as exc:
        assert "duplicate source_id" in str(exc)
    else:
        raise AssertionError("expected duplicate source_id validation failure")
