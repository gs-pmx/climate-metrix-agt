import json
from pathlib import Path

from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ActivityRecord, CalculationContext
from ghg_engine.routing import RoutingCatalog
from ghg_engine.time_utils import aggregate_results


def _engine() -> GHGEngine:
    routing = RoutingCatalog.from_csv("data/routing.csv")
    factors = FactorRepository.from_csv("data/factors.csv")
    return GHGEngine(routing, factors)


def _load_fixture(name: str) -> dict:
    return json.loads(Path("tests/fixtures", name).read_text(encoding="utf-8"))


def _assert_expected(expected: list[dict], actual: list[dict], tol: float = 1e-6):
    for exp in expected:
        matches = [a for a in actual if all(a.get(k) == v for k, v in exp.items() if k != "value")]
        assert matches, f"No row matched expected selectors: {exp}"
        assert abs(matches[0]["value"] - exp["value"]) <= tol


def _run_golden(name: str, tol: float = 1e-3):
    fixture = _load_fixture(name)
    eng = _engine()
    ctx = CalculationContext(**fixture["context"])
    acts = [ActivityRecord(**a) for a in fixture["activities"]]
    results, _, _ = eng.calculate(acts, ctx)
    rows = [r.model_dump() for r in results]
    _assert_expected(fixture["expected"], rows, tol=tol)
    return rows


def test_golden_parity_electricity_dual_accounting():
    rows = _run_golden("parity_electricity.json")
    methods = {r["accounting_method"] for r in rows if r["gas"] == "co2"}
    assert methods == {"location_based", "market_based"}
    ids = {f for r in rows for f in r["factor_ids"]}
    assert "f_elec_loc_wecc_co2" in ids
    assert "f_elec_mb_co2" in ids


def test_golden_parity_miles_to_fuel():
    _run_golden("parity_miles_to_fuel.json", tol=1e-2)


def test_miles_to_fuel_eqm():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    act = ActivityRecord(
        facility_id="F1",
        source_id="travel_miles_s3",
        source_type="gasoline",
        scope="Scope 3",
        metric_group="travel",
        metric_subgroup="3.6_business_travel",
        activity={"value": 100.0, "unit": "mile"},
        params={"mpg": 25, "fuel_type": "gasoline"},
    )
    rows, _, trace = eng.calculate([act], ctx)
    co2 = [r for r in rows if r.gas == "co2"]
    assert co2 and co2[0].value > 0
    assert any("miles" in t.conversions[0] for t in trace if t.conversions)


def test_gwp_ar6_co2e():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024, gwp_set="AR6")
    act = ActivityRecord(
        facility_id="F1",
        source_id="fuel_gasoline_s1",
        source_type="gasoline",
        scope="Scope 1",
        metric_group="fuel",
        metric_subgroup="fossil_fuel",
        activity={"value": 1.0, "unit": "gallon"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    by_gas = {r.gas: r.value for r in rows if r.accounting_method == "none"}
    assert by_gas["co2e"] > by_gas["co2"]


def test_factor_precedence_validity_and_geography():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024, source_attributes={"country": "US", "egrid_subregion": "WECC"})
    act = ActivityRecord(
        facility_id="F1",
        source_id="electricity_s2",
        source_type="electricity",
        scope="Scope 2",
        metric_group="grid_energy",
        metric_subgroup="electricity_mix",
        activity={"value": 1.0, "unit": "kwh"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    co2_loc = [r for r in rows if r.gas == "co2" and r.accounting_method == "location_based"][0]
    assert co2_loc.factor_ids == ["f_elec_loc_wecc_co2"]


def test_co2e_only_factor_supported():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    act = ActivityRecord(
        facility_id="F1",
        source_id="steam_s2",
        source_type="district-steam",
        scope="Scope 2",
        metric_group="grid_energy",
        metric_subgroup="district_steam",
        activity={"value": 10.0, "unit": "mmbtu"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    gases = {r.gas for r in rows}
    assert "co2e" in gases
    assert "co2" not in gases


def test_time_aggregation_invariant():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    activities = [
        ActivityRecord(
            facility_id="F1",
            source_id="fuel_gasoline_s1",
            source_type="gasoline",
            scope="Scope 1",
            metric_group="fuel",
            metric_subgroup="fossil_fuel",
            activity={"value": 10.0, "unit": "gallon"},
            period_start=f"2024-{month:02d}-01T00:00:00",
            period_end=f"2024-{month:02d}-28T00:00:00",
        )
        for month in (1, 2, 3)
    ]
    rows, _, _ = eng.calculate(activities, ctx)
    co2e_rows = [r for r in rows if r.gas == "co2e"]
    monthly_total = sum(r.value for r in co2e_rows)
    aggregated = aggregate_results(co2e_rows, bucket="year")
    annual_total = sum(r.value for r in aggregated)
    assert abs(monthly_total - annual_total) <= 1e-6
