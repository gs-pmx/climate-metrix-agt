from __future__ import annotations

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
