"""Boundary tests for the API transport DTOs.

These tests are the regression guard that lets us evolve internal Pydantic
types without silently changing the wire format. A mapper translates a
domain object into a DTO, and the DTO's JSON serialization must match the
shape the API used to return for the same input.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from api.dto import (
    ActivityTypeDTO,
    CalculationResponseDTO,
    FactorPreviewDTO,
    MethodSchemaDTO,
    ProjectSnapshotDTO,
    ReportingUnitDraftDTO,
    activity_type_to_dto,
    audit_record_to_dto,
    calculation_response_to_dto,
    factor_preview_to_dto,
    method_schema_to_dto,
    project_snapshot_to_dto,
    reporting_unit_draft_to_dto,
    result_record_to_dto,
    trace_record_to_dto,
)
from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.models import (
    ActivityDraft,
    AuditRecord,
    MethodSchema,
    ProjectSnapshot,
    ReportingUnitDraft,
    ResultRecord,
    SummaryRow,
    TraceRecord,
)


def _data_path(*parts: str) -> Path:
    return Path(__file__).resolve().parents[1].joinpath(*parts)


# ---------------------------------------------------------------------------
# Activity-type DTO round-trip
# ---------------------------------------------------------------------------


def _catalog() -> ActivityCatalog:
    return ActivityCatalog.from_json(_data_path("data", "activity_types.json"))


def test_activity_type_to_dto_preserves_public_shape():
    catalog = _catalog()
    definition = catalog.get_required("scope2_purchased_electricity_grid_mix")

    dto = activity_type_to_dto(definition)

    assert isinstance(dto, ActivityTypeDTO)
    assert dto.activity_type_id == definition.activity_type_id
    assert dto.label == definition.label
    assert dto.default_unit == definition.default_unit
    assert dto.allowed_units == definition.allowed_units
    assert dto.implementation_status == definition.implementation_status
    # Every input field survives the mapping.
    assert [f.field_id for f in dto.input_schema.fields] == [
        f.field_id for f in definition.input_schema.fields
    ]
    # Metadata dicts are preserved wholesale.
    assert dto.ui_metadata == definition.ui_metadata
    assert dto.accounting_metadata == definition.accounting_metadata


def test_activity_type_dto_json_matches_legacy_response():
    catalog = _catalog()
    definition = catalog.get_required("scope3_business_travel_rental_vehicle")

    dto_json = activity_type_to_dto(definition).model_dump(mode="json")
    legacy_json = definition.model_dump(mode="json")

    # Every field emitted by the legacy response must still appear.
    assert set(dto_json.keys()) == set(legacy_json.keys())
    for key in legacy_json:
        assert dto_json[key] == legacy_json[key], f"mismatch on field {key!r}"


# ---------------------------------------------------------------------------
# Result / trace / audit mapper equivalence
# ---------------------------------------------------------------------------


def _sample_result() -> ResultRecord:
    return ResultRecord(
        facility_id="F1",
        activity_type_id="scope1_mobile_gasoline",
        activity_label="Owned Vehicle Gasoline",
        scope="Scope 1",
        protocol_category_code=None,
        protocol_category_label=None,
        activity_group="Mobile Combustion",
        source_type="gasoline",
        accounting_method="none",
        gas="co2e",
        value=88.0,
        unit="kg",
        is_biogenic=False,
        method_id="direct_factor",
        factor_ids=["factor_1"],
    )


def _sample_trace() -> TraceRecord:
    return TraceRecord(
        activity_type_id="scope1_mobile_gasoline",
        activity_label="Owned Vehicle Gasoline",
        selected_method="direct_factor",
        factor_matches=["factor_1"],
    )


def _sample_audit() -> AuditRecord:
    return AuditRecord(
        facility_id="F1",
        activity_type_id="scope1_mobile_gasoline",
        activity_label="Owned Vehicle Gasoline",
        source_type="gasoline",
        scope="Scope 1",
        metric_group="mobile_combustion",
        accounting_method="none",
        input_activity_value=10.0,
        input_activity_unit="gallon",
        eqm_method="direct_factor",
        eqm_description="Multiply gallons by factor",
    )


def test_result_record_dto_matches_internal_model_json():
    internal = _sample_result()

    dto = result_record_to_dto(internal)

    assert dto.model_dump(mode="json") == internal.model_dump(mode="json")


def test_trace_record_dto_matches_internal_model_json():
    internal = _sample_trace()
    dto = trace_record_to_dto(internal)
    assert dto.model_dump(mode="json") == internal.model_dump(mode="json")


def test_audit_record_dto_matches_internal_model_json():
    internal = _sample_audit()
    dto = audit_record_to_dto(internal)
    assert dto.model_dump(mode="json") == internal.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Snapshot mapper: facilities <-> reporting_units
# ---------------------------------------------------------------------------


def test_project_snapshot_dto_serializes_reporting_units_under_facilities_key():
    snap = ProjectSnapshot(
        facilities=[{"id": "F1", "facility_name": "Facility 1"}],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 10.0, "unit": "gallon"},
                params={},
            )
        ],
        summary_rows=[SummaryRow(key="k", value=1.0)],
        result_rows=[_sample_result()],
        trace_rows=[_sample_trace()],
        audit_rows=[_sample_audit()],
    )

    dto = project_snapshot_to_dto(snap)

    assert isinstance(dto, ProjectSnapshotDTO)
    assert len(dto.reporting_units) == 1
    ru = dto.reporting_units[0]
    assert isinstance(ru, ReportingUnitDraftDTO)
    assert ru.id == "F1"
    assert ru.name == "Facility 1"
    # Reserved C2 stub field: present but empty.
    assert ru.applicable_activity_types == []

    # JSON output must use the legacy ``facilities`` key (serialization alias).
    dumped = dto.model_dump(mode="json", by_alias=True)
    assert "facilities" in dumped
    assert "reporting_units" not in dumped
    assert dumped["facilities"][0]["id"] == "F1"
    assert dumped["facilities"][0]["name"] == "Facility 1"


def test_project_snapshot_dto_parses_legacy_facilities_json():
    legacy = {
        "snapshot_version": 2,
        "facilities": [
            {
                "id": "F1",
                "name": "Facility 1",
                "location": "",
                "region": "",
                "country": "US",
                "state": "",
                "egrid_subregion": "",
                "reporting_group": "",
                "owned_leased": "Owned",
            }
        ],
        "activities": [],
        "result_rows": [],
        "summary_rows": [],
        "trace_rows": [],
        "audit_rows": [],
    }
    dto = ProjectSnapshotDTO.model_validate(legacy)
    assert len(dto.reporting_units) == 1
    assert dto.reporting_units[0].id == "F1"


def test_reporting_unit_draft_to_dto_preserves_name_and_location():
    draft = ReportingUnitDraft(id="F2", name="Facility Two", location="Bend, OR")

    dto = reporting_unit_draft_to_dto(draft)

    assert dto.name == "Facility Two"
    assert dto.location == "Bend, OR"


def test_reporting_unit_draft_parses_legacy_facility_name_alias():
    # Existing SQLite snapshots serialize the field as ``facility_name``.
    # Construction via the legacy kwarg must continue to work.
    draft = ReportingUnitDraft.model_validate({"id": "F3", "facility_name": "Legacy"})

    assert draft.name == "Legacy"
    dumped = draft.model_dump(by_alias=True)
    assert dumped["facility_name"] == "Legacy"


# ---------------------------------------------------------------------------
# Calculation response envelope
# ---------------------------------------------------------------------------


def test_calculation_response_dto_matches_legacy_envelope_json():
    results = [_sample_result()]
    trace = [_sample_trace()]
    summary = {"F1|Scope 1|none|co2e|kg|non_biogenic": 88.0}

    dto = calculation_response_to_dto(results=results, summary=summary, trace=trace)

    assert isinstance(dto, CalculationResponseDTO)
    dumped = dto.model_dump(mode="json")
    assert dumped["results"][0]["value"] == 88.0
    assert dumped["summary"] == summary
    assert dumped["trace"][0]["selected_method"] == "direct_factor"


# ---------------------------------------------------------------------------
# Factor preview DTO
# ---------------------------------------------------------------------------


def test_factor_preview_dto_parses_typical_row():
    row = {
        "factor_id": "f_elec_loc_wecc_co2",
        "emission_category": "electricity",
        "type": "grid_mix",
        "description": "WECC location-based CO2",
        "attribute": "egrid_subregion:WECC",
        "gas": "co2",
        "unit": "kg/kwh",
        "factor_source": "eGRID 2022",
    }

    dto = factor_preview_to_dto(row)

    assert isinstance(dto, FactorPreviewDTO)
    assert dto.factor_id == "f_elec_loc_wecc_co2"
    assert dto.gas == "co2"
    assert dto.factor_source == "eGRID 2022"


def test_factor_preview_dto_coerces_missing_columns_to_empty_string():
    # Missing optional columns should be normalized to "" rather than blowing up.
    dto = factor_preview_to_dto({"factor_id": "only_id"})

    assert dto.factor_id == "only_id"
    assert dto.description == ""
    assert dto.factor_source == ""


def test_factor_preview_dto_rejects_non_string_types_when_validated_directly():
    with pytest.raises(ValidationError):
        FactorPreviewDTO.model_validate(
            {
                "factor_id": "x",
                "emission_category": "y",
                "type": "z",
                "description": "d",
                "attribute": "a",
                "gas": "co2",
                "unit": "kg",
                # factor_source missing entirely -> required field fails.
            }
        )


# ---------------------------------------------------------------------------
# Method schema envelope stability
# ---------------------------------------------------------------------------


def test_method_schema_dto_is_stable_across_plugin_required_param_shapes():
    plugin_a = MethodSchema(
        method_id="direct_factor",
        version="1.0",
        required_params={"emission_category": "str"},
    )
    plugin_b = MethodSchema(
        method_id="distance_plus_efficiency",
        version="1.0",
        required_params={
            "mpg": {"kind": "number", "required": True},
            "fuel_type": {"kind": "enum", "required": True, "options": ["gasoline", "diesel"]},
        },
    )

    dto_a = method_schema_to_dto(plugin_a)
    dto_b = method_schema_to_dto(plugin_b)

    # Envelope fields stay identical across plugin shapes.
    for dto in (dto_a, dto_b):
        assert set(dto.model_dump().keys()) == {"method_id", "version", "required_params"}
    assert dto_a.required_params == {"emission_category": "str"}
    assert dto_b.required_params["mpg"] == {"kind": "number", "required": True}
