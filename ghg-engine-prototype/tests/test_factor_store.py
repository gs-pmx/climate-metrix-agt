from __future__ import annotations

import json
from pathlib import Path

from ghg_engine.factors import FactorQuery
from ghg_engine.models import GeoContext
from project_store import ProjectStore


def _electricity_doc(*, factor_key: str, data_year: int, value: float) -> dict:
    return {
        "factor_key": factor_key,
        "lineage_id": "lineage_nwpp_co2",
        "classification": {
            "domain": "electricity-generation",
            "class": "energy",
            "type": "electricity",
            "subtype": "NWPP",
            "life_cycle_stage": "generation",
        },
        "geography": {
            "region": "North America",
            "country": "USA",
            "state": None,
            "grid_region_code": "NWPP",
            "geographic_specificity": "subregion",
        },
        "factor": {
            "attribute": "co2-ef",
            "greenhouse_gas": "co2",
            "value": value,
            "unit_label": "kg/kwh",
            "unit_numerator": "kg",
            "unit_denominator": "kwh",
        },
        "provenance": {
            "source_id": "egrid",
            "data_year": data_year,
            "confidence_level": "high",
            "source_detail": "location-based subregion factor",
        },
        "versioning": {"is_current": True},
    }


def _combustion_doc(*, factor_key: str, source_id: str = "tcr", data_year: int = 2024) -> dict:
    return {
        "factor_key": factor_key,
        "lineage_id": f"{source_id}::natural-gas::co2-ef::us-weighted-avg",
        "classification": {
            "domain": "combustion",
            "class": "energy",
            "type": "natural-gas",
            "subtype": "us-weighted-avg",
            "life_cycle_stage": "direct",
        },
        "geography": {
            "region": "North America",
            "country": "USA",
            "geographic_specificity": "national",
        },
        "factor": {
            "attribute": "co2-ef",
            "greenhouse_gas": "co2",
            "value": 53.06,
            "unit_label": "kg/mmbtu",
            "unit_numerator": "kg",
            "unit_denominator": "mmbtu",
        },
        "provenance": {
            "source_id": source_id,
            "data_year": data_year,
            "confidence_level": "high",
            "source_detail": "test combustion factor",
        },
        "versioning": {"is_current": True},
    }


def test_factor_store_imports_documents_into_canonical_tables_and_selects_latest_dataset(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    first = store.import_factor_documents(
        dataset_key="egrid_2024",
        source_name="egrid",
        version_label="2024",
        docs=[_electricity_doc(factor_key="nwpp_2024", data_year=2024, value=1.0)],
        publish=True,
    )
    repo = store.factor_repository()
    query = FactorQuery(
        emission_category="purchased-electricity",
        type="electricity",
        attribute="co2_ef",
        greenhouse_gas="co2",
        accounting_method="location_based",
        inventory_year=2024,
        geo=GeoContext(country="US", egrid_subregion="NWPP"),
    )
    chosen = repo.select_best(query)

    assert first["factor_versions"] == 1
    assert chosen is not None
    assert chosen.factor_id == "nwpp_2024"
    assert chosen.value == 1.0

    second = store.import_factor_documents(
        dataset_key="egrid_2025",
        source_name="egrid",
        version_label="2025",
        docs=[_electricity_doc(factor_key="nwpp_2025", data_year=2025, value=2.0)],
        publish=True,
    )
    latest = repo.select_best(
        query.model_copy(update={"inventory_year": 2025})
    )

    assert second["factor_versions"] == 1
    assert latest is not None
    assert latest.factor_id == "nwpp_2025"
    assert latest.value == 2.0
    current = store.current_factor_dataset()
    assert current is not None
    assert current["dataset_key"] == "egrid_2025"

    with store._connect() as conn:  # noqa: SLF001 - verifying canonical factor warehouse tables
        dataset_statuses = {
            row["dataset_key"]: row["status"]
            for row in conn.execute(
                "SELECT dataset_key, status FROM factor_datasets ORDER BY dataset_key"
            ).fetchall()
        }
        source_doc_count = conn.execute(
            "SELECT COUNT(*) AS c FROM factor_source_docs"
        ).fetchone()["c"]
        factor_version_count = conn.execute(
            "SELECT COUNT(*) AS c FROM factor_versions"
        ).fetchone()["c"]
    assert dataset_statuses == {"egrid_2024": "retired", "egrid_2025": "published"}
    assert source_doc_count == 2
    assert factor_version_count == 2


def test_publishing_new_physical_source_does_not_retire_existing_published_sources(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    store.import_factor_documents(
        dataset_key="tcr_2024",
        source_name="tcr",
        version_label="TCR 2024",
        docs=[_combustion_doc(factor_key="tcr_natural_gas_2024")],
        publish=True,
    )
    store.import_factor_documents(
        dataset_key="egrid_2024",
        source_name="egrid",
        version_label="eGRID 2024",
        docs=[_electricity_doc(factor_key="nwpp_2024", data_year=2024, value=1.0)],
        publish=True,
    )

    with store._connect() as conn:  # noqa: SLF001 - verifying factor dataset publication scope
        dataset_statuses = {
            row["dataset_key"]: row["status"]
            for row in conn.execute(
                "SELECT dataset_key, status FROM factor_datasets ORDER BY dataset_key"
            ).fetchall()
        }

    assert dataset_statuses == {"egrid_2024": "published", "tcr_2024": "published"}


def test_document_import_preserves_tags_and_maintenance_metadata(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects.sqlite")
    doc = _electricity_doc(factor_key="nwpp_2024", data_year=2024, value=1.0)
    doc["tags"] = ["ops_inventory", "annual_refresh"]
    doc["maintenance"] = {
        "status": "needs-review",
        "review_cycle": "annual",
        "next_review_date": "2026-01-15",
    }

    store.import_factor_documents(
        dataset_key="egrid_2024",
        source_name="egrid",
        version_label="eGRID 2024",
        docs=[doc],
        publish=True,
    )

    with store._connect() as conn:  # noqa: SLF001 - verifying canonical metadata preservation
        row = conn.execute("SELECT extra_json FROM factor_versions").fetchone()
    extra = json.loads(row["extra_json"])

    assert extra["tags"] == ["ops_inventory", "annual_refresh"]
    assert extra["maintenance"]["review_cycle"] == "annual"
    assert extra["maintenance"]["next_review_date"] == "2026-01-15"


def test_physical_factor_lookup_still_works_when_a_spend_dataset_is_published_later(
    tmp_path: Path,
):
    """Regression: Phase E1 introduced a separately-published spend
    dataset (USEEIO) that became the most-recently-published row in
    ``factor_datasets``. The original ``_coarse_records`` query scoped
    to that single dataset and silently masked every physical factor
    in older datasets — every direct_factor / refrigerant /
    scope2_energy / passenger_distance lookup started returning
    nothing once a USEEIO ingestion ran on a live DB.
    """
    store = ProjectStore(tmp_path / "projects.sqlite")
    store.import_factor_documents(
        dataset_key="egrid_2024",
        source_name="egrid",
        version_label="2024",
        docs=[_electricity_doc(factor_key="nwpp_2024", data_year=2024, value=1.5)],
        publish=True,
    )

    # Publish a spend dataset AFTER the physical seed. ``published_at``
    # is set to "now" inside ``import_spend_factors`` so this dataset
    # naturally becomes the most-recent row — the exact condition that
    # broke physical-factor lookups in production.
    store.factors.import_spend_factors(
        dataset_key="useeio_v1_4_0",
        source_name="USEEIO",
        version_label="USEEIO v1.4.0 test",
        factors=[
            {
                "source_record_key": "useeio:541110",
                "factor_type": "541110",
                "description": "Legal services",
                "value": 0.12,
                "unit_label": "kg/USD",
                "unit_numerator": "kg",
                "unit_denominator": "USD",
                "data_year": 2022,
                "region": "US",
                "country": "USA",
                "source_id": "USEEIO",
            },
        ],
        publish=True,
    )

    # The physical-factor query must still find the egrid factor even
    # though USEEIO is now the most-recently-published dataset.
    repo = store.factor_repository()
    chosen = repo.select_best(
        FactorQuery(
            emission_category="purchased-electricity",
            type="electricity",
            attribute="co2_ef",
            greenhouse_gas="co2",
            accounting_method="location_based",
            inventory_year=2024,
            geo=GeoContext(country="US", egrid_subregion="NWPP"),
        )
    )
    assert chosen is not None, "physical factor was masked by the spend dataset"
    assert chosen.factor_id == "nwpp_2024"
    assert chosen.value == 1.5

    # ``count`` and ``preview`` should also reflect just the physical
    # set, not bleed into spend factors.
    assert repo.count() == 1
    preview = repo.preview()
    assert len(preview) == 1
    assert preview[0]["type"] == "electricity"


def test_migration_strips_ar6_footnote_markers_from_refrigerant_subtypes(
    tmp_path: Path,
):
    """Regression: the seed JSON imported refrigerant rows whose subtypes
    incorporate AR6 Annex VII footnote markers (``"HFO-1234yf a"`` instead
    of ``"HFO-1234yf"``). The matcher queries by the clean catalog label
    so any such refrigerant becomes unresolvable. Migration 11 strips the
    trailing single-letter marker and idempotently leaves clean subtypes
    alone.
    """
    store = ProjectStore(tmp_path / "projects.sqlite")
    # Seed a published dataset so the rows have a valid dataset_id to
    # attach to. Any electricity doc works; we'll mutate it post-import.
    store.import_factor_documents(
        dataset_key="seed",
        source_name="seed",
        version_label="seed",
        docs=[_electricity_doc(factor_key="dummy_2024", data_year=2024, value=1.0)],
        publish=True,
    )

    affected_rows = [
        ("fv_hfo_1234yf", "hfo", "HFO-1234yf a"),
        ("fv_hfo_1234ze", "hfo", "HFO-1234ze(E) a"),
        ("fv_pfc_31_10", "pfc", "PFC-31-10 c"),
        ("fv_pfc_51_14", "pfc", "PFC-51-14 c"),
    ]
    untouched_row = ("fv_hfc_134a", "hfc", "HFC-134a")

    with store._connect() as conn:  # noqa: SLF001
        dataset_id = conn.execute(
            "SELECT dataset_id FROM factor_datasets WHERE dataset_key='seed'"
        ).fetchone()["dataset_id"]
        for fv_id, factor_type, subtype in [*affected_rows, untouched_row]:
            conn.execute(
                """
                INSERT INTO factor_lineages (
                    lineage_id, lineage_key, emission_category, factor_type,
                    attribute, factor_role, created_at
                )
                VALUES (?, ?, 'refrigerant-release', ?,
                        'gwp_100_ar6', 'emission_factor', '2026-04-29T00:00:00Z')
                """,
                (fv_id, fv_id, factor_type),
            )
            conn.execute(
                """
                INSERT INTO factor_versions (
                    factor_version_id, dataset_id, lineage_id, source_record_key,
                    emission_category, factor_type, factor_kind, subtype_or_description,
                    attribute, factor_role, accounting_method, value, unit_label,
                    geography_global, created_at, row_json
                )
                VALUES (?, ?, ?, ?, 'refrigerant-release', ?, 'physical', ?,
                        'gwp_100_ar6', 'emission_factor', 'none', 1.0, 'gwp-100',
                        1, '2026-04-29T00:00:00Z', '{}')
                """,
                (fv_id, dataset_id, fv_id, fv_id, factor_type, subtype),
            )

        # Run the migration directly (it has already run as part of
        # ``ensure_schema``, but we want to exercise it on the rows we
        # just inserted).
        store._migration_11_strip_refrigerant_footnote_markers(conn)  # noqa: SLF001

        cleaned = {
            row["factor_version_id"]: row["subtype_or_description"]
            for row in conn.execute(
                "SELECT factor_version_id, subtype_or_description FROM factor_versions "
                "WHERE factor_version_id IN ('fv_hfo_1234yf','fv_hfo_1234ze',"
                "'fv_pfc_31_10','fv_pfc_51_14','fv_hfc_134a')"
            ).fetchall()
        }
    assert cleaned["fv_hfo_1234yf"] == "HFO-1234yf"
    assert cleaned["fv_hfo_1234ze"] == "HFO-1234ze(E)"
    assert cleaned["fv_pfc_31_10"] == "PFC-31-10"
    assert cleaned["fv_pfc_51_14"] == "PFC-51-14"
    # Untouched: HFC-134a never had a marker, must not be modified.
    assert cleaned["fv_hfc_134a"] == "HFC-134a"


def test_migration_strip_refrigerant_footnotes_is_idempotent(tmp_path: Path):
    """Re-running the migration on already-clean rows is a no-op."""
    store = ProjectStore(tmp_path / "projects.sqlite")
    store.import_factor_documents(
        dataset_key="seed",
        source_name="seed",
        version_label="seed",
        docs=[_electricity_doc(factor_key="dummy_2024", data_year=2024, value=1.0)],
        publish=True,
    )
    with store._connect() as conn:  # noqa: SLF001
        dataset_id = conn.execute(
            "SELECT dataset_id FROM factor_datasets WHERE dataset_key='seed'"
        ).fetchone()["dataset_id"]
        conn.execute(
            """
            INSERT INTO factor_lineages (
                lineage_id, lineage_key, emission_category, factor_type,
                attribute, factor_role, created_at
            )
            VALUES ('fv_clean', 'fv_clean', 'refrigerant-release', 'hfc',
                    'gwp_100_ar6', 'emission_factor', '2026-04-29T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO factor_versions (
                factor_version_id, dataset_id, lineage_id, source_record_key,
                emission_category, factor_type, factor_kind, subtype_or_description,
                attribute, factor_role, accounting_method, value, unit_label,
                geography_global, created_at, row_json
            )
            VALUES ('fv_clean', ?, 'fv_clean', 'fv_clean',
                    'refrigerant-release', 'hfc', 'physical', 'HFC-134a',
                    'gwp_100_ar6', 'emission_factor', 'none', 1530.0, 'gwp-100',
                    1, '2026-04-29T00:00:00Z', '{}')
            """,
            (dataset_id,),
        )
        # Two calls; second must not corrupt the value.
        store._migration_11_strip_refrigerant_footnote_markers(conn)  # noqa: SLF001
        store._migration_11_strip_refrigerant_footnote_markers(conn)  # noqa: SLF001
        row = conn.execute(
            "SELECT subtype_or_description FROM factor_versions "
            "WHERE factor_version_id='fv_clean'"
        ).fetchone()
    assert row["subtype_or_description"] == "HFC-134a"
