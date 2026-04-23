from __future__ import annotations

from ghg_engine.adapters import LegacyCalculationAdapter
from ghg_engine.domain import ActivityObservation, OperationalLocus
from ghg_engine.models import ActivityRecord, CalculationContext
from ghg_engine.services import LocusResolver


def test_legacy_adapter_projects_context_into_locus_and_policy():
    adapter = LegacyCalculationAdapter()
    activity = ActivityRecord(
        facility_id="F1",
        activity_type_id="scope1_mobile_gasoline",
        activity={"value": 10.0, "unit": "gallon"},
    )
    ctx = CalculationContext(
        inventory_year=2026,
        gwp_set="AR6",
        include_trace=True,
        source_attributes={
            "country": "US",
            "state": "OR",
            "egrid_subregion": "NWPP",
            "reporting_group": "Operations",
            "owned_leased": "Owned",
            "custom_tag": "west-coast",
        },
    )

    resolved = adapter.resolve(activity, ctx)

    assert resolved.observation.locus_id == "F1"
    assert resolved.observation.activity_type_id == "scope1_mobile_gasoline"
    assert resolved.observation.quantity.value == 10.0
    assert resolved.observation.quantity.unit == "gallon"
    assert resolved.locus.geography.country == "US"
    assert resolved.locus.geography.state == "OR"
    assert resolved.locus.geography.grid_region == "NWPP"
    assert resolved.locus.reporting_group == "Operations"
    assert resolved.locus.ownership_mode == "Owned"
    assert resolved.locus.attributes["custom_tag"] == "west-coast"
    assert resolved.policy.inventory_year == 2026
    assert resolved.policy.gwp_set == "AR6"
    assert resolved.policy.include_trace is True


def test_locus_resolver_rejects_mismatched_locus_ids():
    resolver = LocusResolver()
    observation = ActivityObservation(
        activity_id="a1",
        locus_id="F1",
        activity_type_id="scope1_mobile_gasoline",
        quantity={"value": 1.0, "unit": "gallon"},
    )
    locus = OperationalLocus(locus_id="F2", name="Facility 2")

    try:
        resolver.resolve(observation, locus)
    except ValueError as exc:
        assert "attached to locus" in str(exc)
    else:
        raise AssertionError("Expected mismatched locus ids to raise ValueError")
