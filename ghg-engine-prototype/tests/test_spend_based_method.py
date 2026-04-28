"""Phase E1 — SpendBasedMethod plugin math.

Tests cover happy-path emissions calculation, FX/inflation correction,
the per-RU mapping override, and structured error paths."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.adapters import LegacyCalculationAdapter
from ghg_engine.eqms.base import EQMContext
from ghg_engine.eqms.spend_based import (
    MissingFxRateError,
    SpendBasedContext,
    SpendBasedMethod,
    StaticGLMappingResolver,
    UnmappedGLCodeError,
)
from ghg_engine.models import ActivityRecord, CalculationContext, EmissionFactorRow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _activity_def():
    catalog = ActivityCatalog.from_json("data/activity_types.json")
    return catalog.get_required("scope3_spend_based")


def _resolved(
    *,
    facility_id: str = "ru_corp",
    spend: float,
    currency: str,
    gl_code: str,
    transaction_year: int,
    supplier: str | None = None,
):
    record = ActivityRecord(
        facility_id=facility_id,
        activity_type_id="scope3_spend_based",
        activity={"value": spend, "unit": currency},
        params={
            "gl_code": gl_code,
            "transaction_year": transaction_year,
            **({"supplier": supplier} if supplier else {}),
        },
        timestamp=datetime(transaction_year, 6, 30),
    )
    ctx = CalculationContext(inventory_year=transaction_year)
    return LegacyCalculationAdapter().resolve(record, ctx)


def _factor(value: float, *, factor_id: str = "useeio:541110", year: int = 2022, unit: str = "kg/USD"):
    return EmissionFactorRow(
        factor_id=factor_id,
        emission_category="spend-based",
        type=factor_id.split(":", 1)[-1],
        description=f"factor {factor_id}",
        attribute="co2e_ef",
        gas="co2e",
        greenhouse_gas="co2e",
        value=value,
        unit=unit,
        unit_label=unit,
        unit_1=unit.split("/", 1)[0],
        unit_2=unit.split("/", 1)[-1],
        data_year=year,
    )


def _build_context(
    *,
    factor_value: float = 0.5,
    fx_rates: dict[tuple[str, int], float] | None = None,
    cpi: dict[int, float] | None = None,
    factor_year: int = 2022,
    mappings: list[dict[str, Any]] | None = None,
) -> EQMContext:
    if fx_rates is None:
        # Provide an identity USD rate for the typical test years so the
        # plugin's identity-shortcut for USD also passes the explicit lookup.
        # The plugin already short-circuits ``rate_to_usd=1.0`` for USD,
        # but the explicit path is exercised when ``fx_provider`` is
        # invoked for non-2022 USD spend in the inflation tests.
        fx_rates = {
            ("USD", 2018): 1.0,
            ("USD", 2020): 1.0,
            ("USD", 2022): 1.0,
            ("USD", 2024): 1.0,
        }
    cpi = cpi or {2022: 292.655, 2020: 258.811, 2024: 313.689}
    mappings = mappings or [
        {"reporting_unit_id": None, "gl_code": "G123", "factor_id": "useeio:541110"},
    ]

    def fx(currency: str, year: int):
        rate = fx_rates.get((currency.upper(), int(year)))
        if rate is None:
            return None
        return {"currency": currency.upper(), "year": year, "rate_to_usd": rate, "source": "test"}

    def inflation(name: str, year: int):
        if name != "us_cpi_u":
            return None
        value = cpi.get(int(year))
        if value is None:
            return None
        return {"index_name": name, "year": year, "index_value": value, "source": "test"}

    factor = _factor(factor_value, year=factor_year)

    def factor_provider(factor_id: str):
        # Single-factor stub. Tests that need richer routing override
        # this provider on the SpendBasedContext directly.
        return factor

    spend_ctx = SpendBasedContext(
        gl_resolver=StaticGLMappingResolver.from_rows(mappings),
        factor_provider=factor_provider,
        fx_provider=fx,
        inflation_provider=inflation,
    )
    return EQMContext(spend_based=spend_ctx)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_happy_path_usd_in_ef_year():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=1000.0, currency="USD", gl_code="G123", transaction_year=2022)
    ctx = _build_context(factor_value=0.5, factor_year=2022)
    rows, trace = plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)

    assert len(rows) == 1
    row = rows[0]
    assert row.gas == "co2e"
    assert row.accounting_method == "none"
    # 1000 USD * 0.5 kg CO2e/USD = 500 kg
    assert row.value == pytest.approx(500.0)
    assert "useeio:541110" in row.factor_ids
    assert trace.factor_matches == ["useeio:541110"]


def test_fx_correction_eur_to_usd():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=1000.0, currency="EUR", gl_code="G123", transaction_year=2022)
    # EUR/USD 1.0537 in 2022 -> 1053.7 USD; factor 1 kg/USD -> 1053.7 kg
    ctx = _build_context(
        factor_value=1.0,
        fx_rates={("USD", 2022): 1.0, ("EUR", 2022): 1.0537},
    )
    rows, _ = plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    assert rows[0].value == pytest.approx(1053.7, abs=0.01)


def test_inflation_correction_2020_spend_to_2022_ef():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    # 100 USD spent in 2020. EF reference year 2022.
    # Adjusted = 100 * (CPI_2022 / CPI_2020) = 100 * (292.655 / 258.811)
    resolved = _resolved(spend=100.0, currency="USD", gl_code="G123", transaction_year=2020)
    ctx = _build_context(factor_value=2.0, factor_year=2022)
    rows, _ = plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    expected_usd_in_ef_year = 100.0 * (292.655 / 258.811)
    expected_emissions = expected_usd_in_ef_year * 2.0
    assert rows[0].value == pytest.approx(expected_emissions, rel=1e-6)


def test_inflation_skipped_when_indices_missing():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=100.0, currency="USD", gl_code="G123", transaction_year=2018)
    # CPI dict only has 2022 and 2020 — 2018 is missing, so inflation is
    # skipped and we report raw USD 2018 * factor.
    ctx = _build_context(
        factor_value=1.0,
        cpi={2022: 292.655, 2020: 258.811},
        factor_year=2022,
    )
    rows, trace = plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    assert rows[0].value == pytest.approx(100.0)
    assert any("inflation index missing" in note for note in trace.defaults_applied)


# ---------------------------------------------------------------------------
# Mapping precedence
# ---------------------------------------------------------------------------


def test_per_ru_mapping_overrides_project_default():
    """When both a per-RU mapping and a project-wide default exist for
    the same gl_code, the per-RU mapping wins."""

    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(
        facility_id="ru_branch_1",
        spend=1000.0,
        currency="USD",
        gl_code="G123",
        transaction_year=2022,
    )

    fx = lambda c, y: {"rate_to_usd": 1.0, "currency": c, "year": y, "source": "test"}
    cpi = lambda n, y: {"index_name": n, "year": y, "index_value": 292.655, "source": "test"}

    ru_factor = _factor(0.5, factor_id="useeio:branch_factor")
    project_factor = _factor(0.1, factor_id="useeio:project_default")

    by_id = {
        "useeio:branch_factor": ru_factor,
        "useeio:project_default": project_factor,
    }

    spend_ctx = SpendBasedContext(
        gl_resolver=StaticGLMappingResolver.from_rows(
            [
                {"reporting_unit_id": None, "gl_code": "G123", "factor_id": "useeio:project_default"},
                {"reporting_unit_id": "ru_branch_1", "gl_code": "G123", "factor_id": "useeio:branch_factor"},
            ]
        ),
        factor_provider=by_id.get,
        fx_provider=fx,
        inflation_provider=cpi,
    )
    rows, _ = plugin.compute(resolved, activity_def, factors=None, eqm_context=EQMContext(spend_based=spend_ctx))
    # 1000 * 0.5 = 500 (RU mapping wins; project default would give 100)
    assert rows[0].value == pytest.approx(500.0)
    assert "useeio:branch_factor" in rows[0].factor_ids


def test_project_default_used_when_no_ru_specific_mapping():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(
        facility_id="ru_branch_2",
        spend=200.0,
        currency="USD",
        gl_code="G123",
        transaction_year=2022,
    )
    ctx = _build_context(
        factor_value=0.25,
        mappings=[
            {"reporting_unit_id": None, "gl_code": "G123", "factor_id": "useeio:541110"},
        ],
    )
    rows, _ = plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    assert rows[0].value == pytest.approx(50.0)


# ---------------------------------------------------------------------------
# Structured errors
# ---------------------------------------------------------------------------


def test_unmapped_gl_code_raises_typed_error():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=100.0, currency="USD", gl_code="G_UNKNOWN", transaction_year=2022)
    ctx = _build_context(
        mappings=[{"reporting_unit_id": None, "gl_code": "G123", "factor_id": "useeio:541110"}],
    )
    with pytest.raises(UnmappedGLCodeError) as excinfo:
        plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    assert excinfo.value.gl_code == "G_UNKNOWN"


def test_missing_fx_rate_raises_typed_error():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=100.0, currency="EUR", gl_code="G123", transaction_year=2030)
    ctx = _build_context(
        fx_rates={("USD", 2030): 1.0},  # EUR for 2030 deliberately missing
    )
    with pytest.raises(MissingFxRateError) as excinfo:
        plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
    assert excinfo.value.currency == "EUR"
    assert excinfo.value.year == 2030


def test_compute_without_context_raises_value_error():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=100.0, currency="USD", gl_code="G123", transaction_year=2022)
    with pytest.raises(ValueError, match="EQMContext"):
        plugin.compute(resolved, activity_def, factors=None, eqm_context=None)


def test_factor_provider_returning_none_is_treated_as_unmapped():
    plugin = SpendBasedMethod()
    activity_def = _activity_def()
    resolved = _resolved(spend=100.0, currency="USD", gl_code="G123", transaction_year=2022)
    ctx = _build_context()
    # Replace factor_provider with one that returns None to simulate a
    # mapping pointing to a deleted factor.
    ctx.spend_based.factor_provider = lambda fid: None
    with pytest.raises(UnmappedGLCodeError):
        plugin.compute(resolved, activity_def, factors=None, eqm_context=ctx)
