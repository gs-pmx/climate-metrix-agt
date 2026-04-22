import json
from pathlib import Path

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ActivityRecord, CalculationContext
from ghg_engine.time_utils import aggregate_results


def _engine() -> GHGEngine:
    activity_catalog = ActivityCatalog.from_json("data/activity_types.json")
    factors = FactorRepository.from_csv("data/factors.csv")
    return GHGEngine(activity_catalog, factors)


def _load_fixture(name: str) -> dict:
    return json.loads(Path("tests/fixtures", name).read_text(encoding="utf-8"))


def _assert_expected(expected: list[dict], actual: list[dict], tol: float = 1e-6):
    for exp in expected:
        matches = [row for row in actual if all(row.get(k) == v for k, v in exp.items() if k != "value")]
        assert matches, f"No row matched expected selectors: {exp}"
        assert abs(matches[0]["value"] - exp["value"]) <= tol


def _run_golden(name: str, tol: float = 1e-3):
    fixture = _load_fixture(name)
    eng = _engine()
    ctx = CalculationContext(**fixture["context"])
    acts = [ActivityRecord(**activity) for activity in fixture["activities"]]
    results, _, _ = eng.calculate(acts, ctx)
    rows = [row.model_dump() for row in results]
    _assert_expected(fixture["expected"], rows, tol=tol)
    return rows


def test_golden_parity_electricity_dual_accounting():
    rows = _run_golden("parity_electricity.json")
    methods = {row["accounting_method"] for row in rows if row["gas"] == "co2"}
    assert methods == {"location_based", "market_based"}
    ids = {factor_id for row in rows for factor_id in row["factor_ids"]}
    assert "f_elec_loc_wecc_co2" in ids
    assert "f_elec_mb_co2" in ids


def test_golden_parity_distance_plus_efficiency():
    _run_golden("parity_miles_to_fuel.json", tol=1e-2)


def test_distance_plus_efficiency_eqm():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    act = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope3_business_travel_rental_vehicle",
        activity={"value": 100.0, "unit": "mile"},
        params={"mpg": 25, "fuel_type": "gasoline"},
    )
    rows, _, trace = eng.calculate([act], ctx)
    co2 = [row for row in rows if row.gas == "co2"]
    assert co2 and co2[0].value > 0
    assert any("miles" in item for record in trace for item in record.conversions)


def test_gwp_ar6_co2e():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024, gwp_set="AR6")
    act = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope1_mobile_gasoline",
        activity={"value": 1.0, "unit": "gallon"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    by_gas = {row.gas: row.value for row in rows if row.accounting_method == "none"}
    assert by_gas["co2e"] > by_gas["co2"]


def test_factor_precedence_validity_and_geography():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024, source_attributes={"country": "US", "egrid_subregion": "WECC"})
    act = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope2_purchased_electricity_grid_mix",
        activity={"value": 1.0, "unit": "kwh"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    co2_loc = [row for row in rows if row.gas == "co2" and row.accounting_method == "location_based"][0]
    assert co2_loc.factor_ids == ["f_elec_loc_wecc_co2"]


def test_co2e_only_factor_supported():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    act = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope2_purchased_district_steam",
        activity={"value": 10.0, "unit": "mmbtu"},
    )
    rows, _, _ = eng.calculate([act], ctx)
    gases = {row.gas for row in rows}
    assert "co2e" in gases
    assert "co2" not in gases


def test_time_aggregation_invariant():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2024)
    activities = [
        ActivityRecord(
            facility_id="F1",
            activity_type_id="scope1_mobile_gasoline",
            activity={"value": 10.0, "unit": "gallon"},
            period_start=f"2024-{month:02d}-01T00:00:00",
            period_end=f"2024-{month:02d}-28T00:00:00",
        )
        for month in (1, 2, 3)
    ]
    rows, _, _ = eng.calculate(activities, ctx)
    co2e_rows = [row for row in rows if row.gas == "co2e"]
    monthly_total = sum(row.value for row in co2e_rows)
    aggregated = aggregate_results(co2e_rows, bucket="year")
    annual_total = sum(row.value for row in aggregated)
    assert abs(monthly_total - annual_total) <= 1e-6
