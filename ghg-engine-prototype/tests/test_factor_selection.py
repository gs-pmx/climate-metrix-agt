from __future__ import annotations

from datetime import date

import pandas as pd

from ghg_engine.factors import FactorQuery, FactorRepository
from ghg_engine.models import GeoContext


def _repo(rows: list[dict]) -> FactorRepository:
    return FactorRepository(pd.DataFrame(rows))


def _base_query(**kwargs) -> FactorQuery:
    defaults = {
        "emission_category": "mobile-combustion",
        "type": "gasoline",
        "attribute": "co2_ef",
        "greenhouse_gas": "co2",
        "description": "default",
    }
    defaults.update(kwargs)
    return FactorQuery(**defaults)


def test_validity_prefers_active_factor():
    repo = _repo(
        [
            {
                "factor_id": "A",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/gal",
                "valid_to": "2023-12-31",
            },
            {
                "factor_id": "B",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 2.0,
                "unit": "kg/gal",
            },
        ]
    )
    chosen = repo.select_best(_base_query(inventory_year=2024))
    assert chosen is not None
    assert chosen.factor_id == "B"


def test_geography_precedence_prefers_egrid():
    repo = _repo(
        [
            {
                "factor_id": "global",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/kwh",
                "geography_global": True,
            },
            {
                "factor_id": "country",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/kwh",
                "country": "US",
            },
            {
                "factor_id": "state",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/kwh",
                "state": "OR",
            },
            {
                "factor_id": "egrid",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/kwh",
                "egrid_subregion": "WECC",
            },
        ]
    )
    chosen = repo.select_best(
        FactorQuery(
            emission_category="purchased-electricity",
            type="electricity",
            attribute="co2_ef",
            greenhouse_gas="co2",
            description="grid",
            geo=GeoContext(country="US", state="OR", egrid_subregion="WECC"),
            inventory_year=2024,
        )
    )
    assert chosen is not None
    assert chosen.factor_id == "egrid"


def test_accounting_method_exact_match():
    repo = _repo(
        [
            {
                "factor_id": "loc",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "accounting_method": "location_based",
                "value": 1.0,
                "unit": "kg/kwh",
            },
            {
                "factor_id": "mkt",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "grid",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "accounting_method": "market_based",
                "value": 1.0,
                "unit": "kg/kwh",
            },
        ]
    )
    chosen = repo.select_best(
        FactorQuery(
            emission_category="purchased-electricity",
            type="electricity",
            attribute="co2_ef",
            greenhouse_gas="co2",
            description="grid",
            accounting_method="market_based",
            inventory_year=2024,
        )
    )
    assert chosen is not None
    assert chosen.factor_id == "mkt"


def test_unit_preference_prefers_denominator():
    repo = _repo(
        [
            {
                "factor_id": "gal",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/gal",
            },
            {
                "factor_id": "mmbtu",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/mmbtu",
            },
        ]
    )
    chosen = repo.select_best(_base_query(preferred_denominator_units=("gal",), inventory_year=2024))
    assert chosen is not None
    assert chosen.factor_id == "gal"


def test_user_factor_override():
    repo = _repo(
        [
            {
                "factor_id": "std",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/gal",
                "source_entity_short": "EPA",
            },
            {
                "factor_id": "usr",
                "emission_category": "mobile-combustion",
                "type": "gasoline",
                "description": "default",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 1.0,
                "unit": "kg/gal",
                "source_entity_short": "USER",
            },
        ]
    )
    chosen = repo.select_best(_base_query(inventory_year=2024, allow_user_factors=True))
    assert chosen is not None
    assert chosen.factor_id == "usr"


def test_resolved_period_inventory_year():
    q = _base_query(inventory_year=2024)
    start, end = q.resolved_period()
    assert start == date(2024, 1, 1)
    assert end == date(2024, 12, 31)
