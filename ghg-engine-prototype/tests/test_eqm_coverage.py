from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pytest

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.document_factors import DocumentFactorRepository
from ghg_engine.engine import GHGEngine
from ghg_engine.models import ActivityRecord, CalculationContext


ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(ROOT / "data" / "activity_types.json")


@lru_cache(maxsize=1)
def _document_factors() -> DocumentFactorRepository:
    return DocumentFactorRepository.from_json(ROOT / "data" / "emission_factors.json")


def _engine() -> GHGEngine:
    return GHGEngine(_catalog(), _document_factors())


def test_direct_factor_uses_heat_content_for_natural_gas_scf():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2026)
    scf_activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope1_stationary_natural_gas",
        activity={"value": 1000.0, "unit": "scf"},
    )
    energy_activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope1_stationary_natural_gas",
        activity={"value": 1.026, "unit": "mmbtu"},
    )

    scf_rows, scf_trace = eng.calculate_one(scf_activity, ctx)
    energy_rows, _ = eng.calculate_one(energy_activity, ctx)

    scf_co2 = next(row for row in scf_rows if row.gas == "co2" and row.accounting_method == "none")
    energy_co2 = next(row for row in energy_rows if row.gas == "co2" and row.accounting_method == "none")

    assert scf_co2.value == pytest.approx(energy_co2.value, rel=1e-5)
    assert any("heat-content factor" in note for note in scf_trace.conversions)


def test_direct_factor_supports_district_steam_mmbtu_and_klbs():
    eng = _engine()
    ctx = CalculationContext(inventory_year=2026)

    for value, unit in [(10.0, "mmbtu"), (10.0, "klbs")]:
        rows, _ = eng.calculate_one(
            ActivityRecord(
                facility_id="F1",
                activity_type_id="scope2_purchased_district_steam",
                activity={"value": value, "unit": unit},
            ),
            ctx,
        )
        assert {row.gas for row in rows} == {"co2e"}
        assert rows[0].value > 0


@pytest.mark.parametrize(
    ("activity_type_id", "unit"),
    [
        ("scope3_upstream_transport_truck_freight", "ton-miles"),
        ("scope3_upstream_transport_rail_freight", "ton-miles"),
        ("scope3_upstream_transport_ocean_freight", "ton-miles"),
        ("scope3_upstream_transport_air_freight", "ton-miles"),
    ],
)
def test_freight_ton_mile_modes_are_calculable(activity_type_id: str, unit: str):
    eng = _engine()
    rows, _ = eng.calculate_one(
        ActivityRecord(
            facility_id="F1",
            activity_type_id=activity_type_id,
            activity={"value": 500.0, "unit": unit},
        ),
        CalculationContext(inventory_year=2026),
    )

    assert {row.gas for row in rows} == {"co2", "ch4", "n2o", "co2e"}
    assert all(row.value >= 0 for row in rows)


@pytest.mark.parametrize(
    "activity_type_id",
    [
        "scope3_business_travel_air",
        "scope3_employee_commuting_bus",
        "scope3_business_travel_intercity_rail",
        "scope3_employee_commuting_transit_rail",
    ],
)
def test_passenger_distance_modes_are_calculable(activity_type_id: str):
    eng = _engine()
    rows, _ = eng.calculate_one(
        ActivityRecord(
            facility_id="F1",
            activity_type_id=activity_type_id,
            activity={"value": 250.0, "unit": "passenger miles"},
        ),
        CalculationContext(inventory_year=2026),
    )

    assert {row.gas for row in rows} == {"co2", "ch4", "n2o", "co2e"}
    assert all(row.value >= 0 for row in rows)


@pytest.mark.parametrize(
    ("disposal_method", "expected_gases"),
    [
        ("landfill_no_recovery", {"ch4", "co2e"}),
        ("landfill_flaring", {"ch4", "co2e"}),
        ("landfill_electricity_recovery", {"ch4", "co2e"}),
        ("incineration", {"co2e"}),
    ],
)
def test_waste_mass_supports_each_disposal_method(disposal_method: str, expected_gases: set[str]):
    eng = _engine()
    rows, _ = eng.calculate_one(
        ActivityRecord(
            facility_id="F1",
            activity_type_id="scope3_waste_generated_in_operations",
            activity={"value": 2.0, "unit": "tons"},
            params={"disposal_method": disposal_method},
        ),
        CalculationContext(inventory_year=2026),
    )

    assert {row.gas for row in rows} == expected_gases


def test_refrigerant_mass_to_gwp_supports_ar6_only():
    eng = _engine()
    activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope1_fugitive_refrigerant_release",
        activity={"value": 10.0, "unit": "pounds"},
        params={"refrigerant_type": "hfc-134a"},
    )

    rows, trace = eng.calculate_one(activity, CalculationContext(inventory_year=2026, gwp_set="AR6"))
    assert len(rows) == 1
    assert rows[0].gas == "co2e"
    assert rows[0].value > 0
    assert any("AR6 refrigerant GWP factor" in note for note in trace.defaults_applied)

    with pytest.raises(ValueError, match="AR6 only"):
        eng.calculate_one(activity, CalculationContext(inventory_year=2026, gwp_set="AR5"))


def test_renewable_fuels_keep_biogenic_co2_separate_from_scope_total_co2e():
    eng = _engine()
    results, summary, _ = eng.calculate(
        [
            ActivityRecord(
                facility_id="F1",
                activity_type_id="scope1_mobile_renewable_diesel",
                activity={"value": 1.0, "unit": "gallon"},
            )
        ],
        CalculationContext(inventory_year=2026),
    )

    co2_row = next(row for row in results if row.gas == "co2")
    co2e_row = next(row for row in results if row.gas == "co2e")

    assert co2_row.is_biogenic is True
    assert co2e_row.is_biogenic is False
    assert co2e_row.value < co2_row.value
    assert any(key.endswith("|co2|kg|biogenic") for key in summary)
    assert any(key.endswith("|co2e|kg|non_biogenic") for key in summary)


def test_scope2_market_based_proxy_is_traced_when_residual_mix_is_unavailable():
    eng = _engine()
    activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope2_purchased_electricity_renewable_purchase",
        activity={"value": 1000.0, "unit": "kwh"},
        params={"procurement_instrument": "Supplier Specific Tariff"},
    )
    rows, trace = eng.calculate_one(
        activity,
        CalculationContext(
            inventory_year=2026,
            source_attributes={"country": "USA", "egrid_subregion": "NWPP"},
        ),
    )

    assert {row.accounting_method for row in rows} == {"location_based", "market_based"}
    assert any("location-based proxy" in note for note in trace.defaults_applied)
