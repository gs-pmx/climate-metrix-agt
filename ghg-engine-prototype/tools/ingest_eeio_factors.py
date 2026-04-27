"""Ingest USEEIO + EXIOBASE spend-based factors into the SQLite factor warehouse.

Run after migration 9 has applied. The script is idempotent — running
twice does not duplicate factors. Each dataset is keyed by
``factor_dataset_id``; re-runs replace the dataset's factor rows.

Inputs the user is expected to have on disk (relative to the
``climate-metrix`` repo root):

* ``eeio/USEEIO/SupplyChainGHGEmissionFactorsv1.4.0.xlsx``
* ``eeio/EXIOBASE/3.8.2/IOT_2022_pxp.zip``

Run::

    cd ghg-engine-prototype
    uv run python tools/ingest_eeio_factors.py \
        --useeio ../eeio/USEEIO/SupplyChainGHGEmissionFactorsv1.4.0.xlsx \
        --exiobase ../eeio/EXIOBASE/3.8.2/IOT_2022_pxp.zip \
        --db state/projects.sqlite

Pass ``--useeio-only`` or ``--exiobase-only`` to limit the run.
``--exiobase-region GLOBAL`` collapses the multi-region table to a
production-weighted global average (the default for v1).

The EXIOBASE branch requires ``pymrio``, which currently pins
``openpyxl<3.1.1`` and conflicts with this project's pinned
``openpyxl>=3.1.5``. ``pymrio`` is therefore NOT in pyproject.toml.
To run EXIOBASE ingestion, install it ad-hoc into the active venv:

    uv pip install pymrio

Then run the ingestion command above. Reverting to the lockfile-
governed environment after ingestion is a ``uv sync`` away.
"""

from __future__ import annotations

import argparse
import logging
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Iterable

from project_store import ProjectStore

logger = logging.getLogger("ingest_eeio_factors")


USEEIO_DATASET_KEY = "useeio_v1_4_0"
USEEIO_DATASET_LABEL = "USEEIO Supply Chain GHG Emission Factors v1.4.0"
USEEIO_DATA_YEAR = 2022  # Verified from the v1.4.0 release page.

EXIOBASE_DATASET_KEY = "exiobase_3_8_2_pxp_2022"
EXIOBASE_DATASET_LABEL = "EXIOBASE 3.8.2 product-by-product, year 2022"
EXIOBASE_DATA_YEAR = 2022


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--useeio",
        type=Path,
        default=Path("../eeio/USEEIO/SupplyChainGHGEmissionFactorsv1.4.0.xlsx"),
        help="Path to the USEEIO Supply Chain GHG Emission Factors xlsx.",
    )
    parser.add_argument(
        "--exiobase",
        type=Path,
        default=Path("../eeio/EXIOBASE/3.8.2/IOT_2022_pxp.zip"),
        help="Path to the EXIOBASE IOT_2022_pxp.zip bundle.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("state/projects.sqlite"),
        help="Path to the SQLite project store DB. Defaults to state/projects.sqlite.",
    )
    parser.add_argument(
        "--useeio-only",
        action="store_true",
        help="Only ingest USEEIO; skip EXIOBASE.",
    )
    parser.add_argument(
        "--exiobase-only",
        action="store_true",
        help="Only ingest EXIOBASE; skip USEEIO.",
    )
    parser.add_argument(
        "--exiobase-region",
        choices=("GLOBAL", "PER_REGION"),
        default="GLOBAL",
        help=(
            "How to handle EXIOBASE's multi-region structure. "
            "GLOBAL collapses to a production-weighted global average per product (v1 default). "
            "PER_REGION emits one factor per (region, product) pair."
        ),
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    store = ProjectStore(args.db)

    summary: dict[str, Any] = {}
    if not args.exiobase_only:
        summary["useeio"] = ingest_useeio(args.useeio, store)
    if not args.useeio_only:
        summary["exiobase"] = ingest_exiobase(args.exiobase, store, region=args.exiobase_region)

    logger.info("Ingestion summary: %s", summary)
    return 0


# ---------------------------------------------------------------------------
# USEEIO loader
# ---------------------------------------------------------------------------


def ingest_useeio(xlsx_path: Path, store: ProjectStore) -> dict[str, Any]:
    """Parse the USEEIO Supply Chain GHG xlsx and load the factors.

    The v1.4.0 workbook has a single tabular sheet keyed on a BEA detail-
    level commodity code, with separate columns for ``Supply Chain
    Emission Factors with Margins`` (kg CO2e/USD) and a category label.
    The schema is stable across the 1.x line so the script tolerates
    minor sheet-name differences by picking the first sheet that has a
    ``Code`` and ``Supply Chain Emission Factors`` column.
    """

    if not xlsx_path.is_file():
        logger.warning("USEEIO file not found at %s — skipping.", xlsx_path)
        return {"status": "skipped", "reason": "file_not_found", "path": str(xlsx_path)}

    import pandas as pd  # local import: lets the script be importable without xlsx tooling

    workbook = pd.read_excel(xlsx_path, sheet_name=None, dtype=str)
    sheet_name, df = _pick_useeio_sheet(workbook)
    logger.info("USEEIO: parsing sheet '%s' with %d rows.", sheet_name, len(df))

    factors = list(_useeio_rows_to_factors(df))
    logger.info("USEEIO: prepared %d factor rows for ingestion.", len(factors))

    result = store.factors.import_spend_factors(
        dataset_key=USEEIO_DATASET_KEY,
        source_name="USEEIO",
        version_label=USEEIO_DATASET_LABEL,
        factors=factors,
        publish=True,
        notes=(
            f"Imported from {xlsx_path.name}. "
            f"Reference year {USEEIO_DATA_YEAR} (USEEIO v1.4.0). "
            "Margins-included EFs in kg CO2e/USD."
        ),
    )
    return {
        "status": "ok",
        "dataset_key": result["dataset_key"],
        "factor_versions": result["factor_versions"],
    }


def _pick_useeio_sheet(workbook: dict[str, "pandas.DataFrame"]) -> tuple[str, "pandas.DataFrame"]:  # noqa: F821
    for name, df in workbook.items():
        cols = {str(c).strip().lower() for c in df.columns}
        has_code = "code" in cols or "naics" in cols or "bea code" in cols
        has_factor = any("supply chain emission" in c.lower() for c in df.columns)
        if has_code and has_factor:
            return name, df
    # Fall back to the first sheet — the test fixture uses this path.
    name, df = next(iter(workbook.items()))
    return name, df


def _useeio_rows_to_factors(df) -> Iterable[dict[str, Any]]:
    columns = {str(c).strip(): c for c in df.columns}

    def _match(*needles: str) -> str | None:
        for col in columns:
            lowered = col.lower()
            if all(needle in lowered for needle in needles):
                return columns[col]
        return None

    code_col = _match("code") or _match("bea") or _match("naics")
    label_col = _match("name") or _match("commodity") or _match("description")
    factor_col = (
        _match("supply chain", "with margins")
        or _match("supply chain emission", "with")
        or _match("supply chain emission")
        or _match("emission")
    )
    if not code_col or not factor_col:
        raise ValueError(
            "USEEIO sheet missing required columns. Expected a code column and "
            "a 'Supply Chain Emission Factors with Margins' column."
        )

    for _, row in df.iterrows():
        code_raw = row.get(code_col)
        factor_raw = row.get(factor_col)
        if code_raw is None or factor_raw is None:
            continue
        code = str(code_raw).strip()
        if not code or code.lower() == "nan":
            continue
        try:
            factor_value = float(factor_raw)
        except (TypeError, ValueError):
            continue
        label = str(row.get(label_col, "")).strip() if label_col else ""
        yield {
            "source_record_key": f"useeio:{code}",
            "factor_type": code,
            "description": label or code,
            "value": factor_value,
            "unit_label": "kg/USD",
            "unit_numerator": "kg",
            "unit_denominator": "USD",
            "data_year": USEEIO_DATA_YEAR,
            "region": "US",
            "country": "USA",
            "source_id": "USEEIO",
            "source_detail": USEEIO_DATASET_LABEL,
            "emission_category": "spend-based",
            "attribute": "co2e_ef",
            "bea_code": code,
            "label": label,
        }


# ---------------------------------------------------------------------------
# EXIOBASE loader
# ---------------------------------------------------------------------------


def ingest_exiobase(
    zip_path: Path,
    store: ProjectStore,
    *,
    region: str = "GLOBAL",
) -> dict[str, Any]:
    """Parse EXIOBASE IOT_2022_pxp via pymrio and load the GHG factors.

    pymrio reads the zipped IOT bundle directly (no manual extraction
    needed). We pull the GHG satellite account, sum CO2-equivalent
    emissions per (region, product), and divide by output to derive
    kg CO2e per EUR.

    For ``region=GLOBAL`` (the v1 default), we further sum emissions and
    output across regions per product, yielding one production-weighted
    global EF per product. For ``region=PER_REGION`` we emit one factor
    per (region, product) — useful once the spend tab UI lets users pick
    a supplier country.
    """

    if not zip_path.is_file():
        logger.warning("EXIOBASE file not found at %s — skipping.", zip_path)
        return {"status": "skipped", "reason": "file_not_found", "path": str(zip_path)}

    try:
        import pymrio  # type: ignore[import-not-found]
    except ImportError:
        logger.error(
            "pymrio is not installed; add 'pymrio' to dependencies and run uv sync."
        )
        return {"status": "skipped", "reason": "pymrio_missing"}

    with TemporaryDirectory(prefix="exio_") as tmp:
        # pymrio.parse_exiobase3 is happy with either the raw zip path
        # or an extracted directory; we extract to the tmp dir to keep
        # behaviour identical across pymrio releases that have changed
        # their zip-handling story.
        extract_dir = Path(tmp) / "exiobase"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)
        logger.info("EXIOBASE: extracted bundle to %s.", extract_dir)
        exio = pymrio.parse_exiobase3(path=str(extract_dir))
        logger.info("EXIOBASE: parsed system; calculating intensities.")
        ghg_accounts = _exiobase_ghg_satellite(exio)
        if ghg_accounts is None:
            return {"status": "skipped", "reason": "no_ghg_satellite"}
        ghg_emissions, output = ghg_accounts
        factors = list(_exiobase_rows_to_factors(ghg_emissions, output, region=region))
        logger.info("EXIOBASE: prepared %d factor rows for ingestion.", len(factors))

    result = store.factors.import_spend_factors(
        dataset_key=EXIOBASE_DATASET_KEY,
        source_name="EXIOBASE",
        version_label=EXIOBASE_DATASET_LABEL,
        factors=factors,
        publish=True,
        notes=(
            f"Imported from {zip_path.name}. "
            f"Reference year {EXIOBASE_DATA_YEAR}. "
            f"Region handling: {region}. "
            "EFs in kg CO2e/EUR."
        ),
    )
    return {
        "status": "ok",
        "dataset_key": result["dataset_key"],
        "factor_versions": result["factor_versions"],
    }


def _exiobase_ghg_satellite(exio) -> tuple[Any, Any] | None:  # noqa: ANN001
    """Pull the GHG satellite (rows of CO2/CH4/N2O accounts) and product output.

    EXIOBASE 3.x exposes its GHG accounts under ``exio.satellite`` with
    canonical row keys for CO2, CH4, N2O. We sum to CO2-equivalent
    using AR5 GWP100 (the same convention pymrio uses by default in its
    'characterization' helper).
    """

    if not hasattr(exio, "satellite"):
        return None
    satellite = exio.satellite
    F = getattr(satellite, "F", None)
    if F is None:
        return None
    ghg_rows = [
        idx
        for idx in F.index
        if any(token in str(idx).lower() for token in ("co2", "ch4", "n2o"))
    ]
    if not ghg_rows:
        return None
    ghg_emissions = F.loc[ghg_rows].copy()
    # Apply AR5 GWP100 weights — the EXIOBASE rows are usually in
    # native units (kg CO2 for CO2; kg CH4 for CH4; etc.). pymrio
    # bundles a characterization helper but for v1 we apply a flat
    # weighting matrix here so the script doesn't depend on
    # ``pymrio.tools.iomath`` version drift.
    ar5_gwp = {"co2": 1.0, "ch4": 28.0, "n2o": 265.0}
    weighted = []
    for idx, row in ghg_emissions.iterrows():
        label = str(idx).lower()
        weight = 1.0
        for gas, value in ar5_gwp.items():
            if gas in label:
                weight = value
                break
        weighted.append(row * weight)

    import pandas as pd  # local import keeps script importable when pandas is missing

    co2e_total = pd.concat(weighted, axis=1).T.sum(axis=0)
    output = exio.x.iloc[:, 0] if hasattr(exio, "x") else None
    if output is None:
        return None
    return co2e_total, output


def _exiobase_rows_to_factors(
    co2e_total,
    output,
    *,
    region: str,
) -> Iterable[dict[str, Any]]:
    import pandas as pd

    df = pd.DataFrame({"co2e_kg": co2e_total, "output_meur": output})
    if region.upper() == "GLOBAL":
        # Index is ``(region, sector)``; collapse on sector.
        if hasattr(df.index, "names") and "sector" in (df.index.names or []):
            grouped = df.groupby(level="sector").sum()
        else:
            grouped = df.groupby(level=-1).sum()
        for sector, row in grouped.iterrows():
            output_eur = float(row["output_meur"]) * 1_000_000.0  # M EUR -> EUR
            if output_eur <= 0:
                continue
            kg_co2e_per_eur = float(row["co2e_kg"]) / output_eur
            yield _exiobase_factor_dict(
                product_code=str(sector),
                product_label=str(sector),
                value=kg_co2e_per_eur,
                region="GLOBAL",
                country=None,
            )
    else:
        for (region_code, sector), row in df.iterrows():
            output_eur = float(row["output_meur"]) * 1_000_000.0
            if output_eur <= 0:
                continue
            kg_co2e_per_eur = float(row["co2e_kg"]) / output_eur
            yield _exiobase_factor_dict(
                product_code=str(sector),
                product_label=str(sector),
                value=kg_co2e_per_eur,
                region=str(region_code),
                country=str(region_code),
            )


def _exiobase_factor_dict(
    *,
    product_code: str,
    product_label: str,
    value: float,
    region: str,
    country: str | None,
) -> dict[str, Any]:
    suffix = region.upper() if region else "GLOBAL"
    return {
        "source_record_key": f"exiobase:{suffix}:{product_code}",
        "factor_type": product_code,
        "description": product_label,
        "value": value,
        "unit_label": "kg/EUR",
        "unit_numerator": "kg",
        "unit_denominator": "EUR",
        "data_year": EXIOBASE_DATA_YEAR,
        "region": region,
        "country": country,
        "source_id": "EXIOBASE",
        "source_detail": EXIOBASE_DATASET_LABEL,
        "emission_category": "spend-based",
        "attribute": "co2e_ef",
        "exiobase_product_code": product_code,
        "exiobase_label": product_label,
    }


if __name__ == "__main__":
    sys.exit(main())
