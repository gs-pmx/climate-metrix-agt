from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.adapters import LegacyCalculationAdapter
from ghg_engine.eqms.registry import default_plugin_registry
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ActivityRecord, CalculationContext
from ghg_engine.services import CalculationOrchestrator

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(ROOT / "data" / "activity_types.json")


class _MismatchedContextAdapter(LegacyCalculationAdapter):
    def to_plugin_inputs(self, resolved):
        activity, ctx = super().to_plugin_inputs(resolved)
        ctx.source_attributes = {
            "country": "US",
            "egrid_subregion": "WECC",
        }
        return activity, ctx


def test_resolved_locus_geography_overrides_legacy_source_attributes():
    repo = FactorRepository(
        pd.DataFrame(
            [
                {
                    "factor_id": "loc_nwpp",
                    "emission_category": "purchased-electricity",
                    "type": "electricity",
                    "description": "us-grid",
                    "attribute": "co2_ef",
                    "greenhouse_gas": "co2",
                    "life_cycle_stage": "generation",
                    "accounting_method": "location_based",
                    "value": 1.0,
                    "unit": "kg/kwh",
                    "country": "US",
                    "egrid_subregion": "NWPP",
                },
                {
                    "factor_id": "loc_wecc",
                    "emission_category": "purchased-electricity",
                    "type": "electricity",
                    "description": "us-grid",
                    "attribute": "co2_ef",
                    "greenhouse_gas": "co2",
                    "life_cycle_stage": "generation",
                    "accounting_method": "location_based",
                    "value": 2.0,
                    "unit": "kg/kwh",
                    "country": "US",
                    "egrid_subregion": "WECC",
                },
            ]
        )
    )
    orchestrator = CalculationOrchestrator(
        activity_catalog=_catalog(),
        factors=repo,
        plugins=default_plugin_registry(),
        legacy_adapter=_MismatchedContextAdapter(),
    )
    activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope2_purchased_electricity_grid_mix",
        activity={"value": 100.0, "unit": "kwh"},
    )
    legacy_ctx = CalculationContext(
        inventory_year=2026,
        source_attributes={
            "country": "US",
            "egrid_subregion": "NWPP",
        },
    )
    resolved = LegacyCalculationAdapter().resolve(activity, legacy_ctx)

    rows, _ = orchestrator.calculate_resolved(resolved)

    location_co2 = next(
        row
        for row in rows
        if row.gas == "co2" and row.accounting_method == "location_based"
    )
    assert location_co2.factor_ids == ["loc_nwpp"]
    assert location_co2.value == 100.0
