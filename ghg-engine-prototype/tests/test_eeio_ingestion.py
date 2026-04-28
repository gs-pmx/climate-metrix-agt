"""Phase E1 — verify the EEIO ingestion script populates factors correctly.

Uses a tiny synthetic xlsx generated on the fly. The full USEEIO and
EXIOBASE files are not bundled in the test fixture — the production
ingestion is a one-shot script run, not a test target.
"""

from __future__ import annotations

from pathlib import Path

import pytest


pytest.importorskip("openpyxl")

from openpyxl import Workbook  # noqa: E402

from project_store import ProjectStore  # noqa: E402
from tools.ingest_eeio_factors import ingest_useeio  # noqa: E402


def _build_synthetic_useeio_xlsx(path: Path) -> None:
    """Write a 3-row USEEIO-shaped xlsx for ingestion testing."""

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Supply Chain Emissions"
    sheet.append(["Code", "Name", "Supply Chain Emission Factors with Margins"])
    sheet.append(["541110", "Legal services", 0.123])
    sheet.append(["541200", "Accounting services", 0.087])
    sheet.append(["311920", "Coffee and tea manufacturing", 1.45])
    wb.save(path)


def test_ingest_useeio_populates_factor_versions(tmp_path: Path):
    db_path = tmp_path / "projects.sqlite"
    xlsx_path = tmp_path / "useeio_synth.xlsx"
    _build_synthetic_useeio_xlsx(xlsx_path)

    store = ProjectStore(db_path)
    result = ingest_useeio(xlsx_path, store)
    assert result["status"] == "ok"
    assert result["factor_versions"] == 3

    rows = store.list_spend_factors(query="Legal")
    assert any("Legal" in (row.get("subtype_or_description") or "") for row in rows)
    legal = next(row for row in rows if row["source_record_key"] == "useeio:541110")
    assert legal["factor_kind"] == "spend"
    assert legal["unit_label"] == "kg/USD"
    assert legal["data_year"] == 2022
    assert legal["value"] == pytest.approx(0.123)


def test_ingest_useeio_is_idempotent(tmp_path: Path):
    db_path = tmp_path / "projects.sqlite"
    xlsx_path = tmp_path / "useeio_synth.xlsx"
    _build_synthetic_useeio_xlsx(xlsx_path)

    store = ProjectStore(db_path)
    ingest_useeio(xlsx_path, store)
    second = ingest_useeio(xlsx_path, store)
    assert second["factor_versions"] == 3

    rows = store.list_spend_factors(limit=100)
    keys = [row["source_record_key"] for row in rows]
    # No duplicates after a re-run.
    assert len(keys) == len(set(keys))


def test_ingest_useeio_skips_when_file_missing(tmp_path: Path):
    db_path = tmp_path / "projects.sqlite"
    store = ProjectStore(db_path)
    result = ingest_useeio(tmp_path / "nonexistent.xlsx", store)
    assert result["status"] == "skipped"
    assert result["reason"] == "file_not_found"
