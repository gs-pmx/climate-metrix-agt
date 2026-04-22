from __future__ import annotations

import pandas as pd

from ghg_engine.document_factors import DocumentFactorRepository
from ghg_engine.factors import FactorQuery, FactorRepository
from ghg_engine.models import GeoContext


def _csv_repo(rows: list[dict]) -> FactorRepository:
    return FactorRepository(pd.DataFrame(rows))


def _doc_repo(docs: list[dict]) -> DocumentFactorRepository:
    return DocumentFactorRepository(docs)


def test_backends_share_diesel_description_normalization_semantics():
    csv_repo = _csv_repo(
        [
            {
                "factor_id": "csv_diesel",
                "emission_category": "stationary-energy",
                "type": "diesel",
                "description": "distillate-fuel-oil-2",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "value": 10.21,
                "unit": "kg/gal",
                "country": "USA",
            }
        ]
    )
    doc_repo = _doc_repo(
        [
            {
                "factor_key": "doc_diesel",
                "classification": {
                    "domain": "combustion",
                    "type": "diesel",
                    "subtype": "distillate-fuel-oil-2-gal",
                    "life_cycle_stage": "direct",
                },
                "geography": {
                    "country": "USA",
                    "state": None,
                    "region": "North America",
                    "grid_region_code": None,
                    "geographic_specificity": "national",
                },
                "factor": {
                    "attribute": "co2-ef",
                    "greenhouse_gas": "co2",
                    "value": 10.21,
                    "unit_label": "kg/gal",
                    "unit_numerator": "kg",
                    "unit_denominator": "gal",
                },
                "provenance": {
                    "source_id": "tcr",
                    "data_year": 2024,
                    "confidence_level": "high",
                    "source_detail": "diesel combustion factor",
                },
                "versioning": {"is_current": True},
            }
        ]
    )
    query = FactorQuery(
        emission_category="stationary-energy",
        type="diesel",
        attribute="co2_ef",
        greenhouse_gas="co2",
        description="distillate-fuel-oil-2",
        inventory_year=2024,
    )

    csv_factor = csv_repo.select_best(query)
    doc_factor = doc_repo.select_best(query)

    assert csv_factor is not None
    assert doc_factor is not None
    assert csv_factor.factor_id == "csv_diesel"
    assert doc_factor.factor_id == "doc_diesel"


def test_backends_share_location_based_electricity_semantics():
    csv_repo = _csv_repo(
        [
            {
                "factor_id": "csv_loc_nwpp",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "NWPP",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "accounting_method": "location_based",
                "value": 631.735,
                "unit": "lb/MWh",
                "country": "USA",
                "egrid_subregion": "NWPP",
                "data_year": 2023,
            }
        ]
    )
    doc_repo = _doc_repo(
        [
            {
                "factor_key": "doc_loc_nwpp",
                "classification": {
                    "domain": "electricity-generation",
                    "type": "electricity",
                    "subtype": "NWPP",
                    "life_cycle_stage": "direct",
                },
                "geography": {
                    "country": "USA",
                    "state": None,
                    "region": "North America",
                    "grid_region_code": "NWPP",
                    "geographic_specificity": "subregion",
                },
                "factor": {
                    "attribute": "co2-ef",
                    "greenhouse_gas": "co2",
                    "value": 631.735,
                    "unit_label": "lb/MWh",
                    "unit_numerator": "lb",
                    "unit_denominator": "MWh",
                },
                "provenance": {
                    "source_id": "egrid",
                    "data_year": 2023,
                    "confidence_level": "high",
                    "source_detail": "location-based subregion factor",
                },
                "versioning": {"is_current": True},
            }
        ]
    )
    query = FactorQuery(
        emission_category="purchased-electricity",
        type="electricity",
        attribute="co2_ef",
        greenhouse_gas="co2",
        description="NWPP",
        accounting_method="location_based",
        inventory_year=2024,
        geo=GeoContext(country="US", egrid_subregion="NWPP"),
    )

    csv_factor = csv_repo.select_best(query)
    doc_factor = doc_repo.select_best(query)

    assert csv_factor is not None
    assert doc_factor is not None
    assert csv_factor.factor_id == "csv_loc_nwpp"
    assert doc_factor.factor_id == "doc_loc_nwpp"


def test_backends_share_market_based_filtering_when_only_location_based_factors_exist():
    csv_repo = _csv_repo(
        [
            {
                "factor_id": "csv_loc_only",
                "emission_category": "purchased-electricity",
                "type": "electricity",
                "description": "NWPP",
                "attribute": "co2_ef",
                "greenhouse_gas": "co2",
                "accounting_method": "location_based",
                "value": 631.735,
                "unit": "lb/MWh",
                "country": "USA",
                "egrid_subregion": "NWPP",
            }
        ]
    )
    doc_repo = _doc_repo(
        [
            {
                "factor_key": "doc_loc_only",
                "classification": {
                    "domain": "electricity-generation",
                    "type": "electricity",
                    "subtype": "NWPP",
                    "life_cycle_stage": "direct",
                },
                "geography": {
                    "country": "USA",
                    "state": None,
                    "region": "North America",
                    "grid_region_code": "NWPP",
                    "geographic_specificity": "subregion",
                },
                "factor": {
                    "attribute": "co2-ef",
                    "greenhouse_gas": "co2",
                    "value": 631.735,
                    "unit_label": "lb/MWh",
                    "unit_numerator": "lb",
                    "unit_denominator": "MWh",
                },
                "provenance": {
                    "source_id": "egrid",
                    "data_year": 2023,
                    "confidence_level": "high",
                    "source_detail": "location-based subregion factor",
                },
                "versioning": {"is_current": True},
            }
        ]
    )
    query = FactorQuery(
        emission_category="purchased-electricity",
        type="electricity",
        attribute="co2_ef",
        greenhouse_gas="co2",
        description="NWPP",
        accounting_method="market_based",
        inventory_year=2024,
        geo=GeoContext(country="US", egrid_subregion="NWPP"),
    )

    assert csv_repo.select_best(query) is None
    assert doc_repo.select_best(query) is None
