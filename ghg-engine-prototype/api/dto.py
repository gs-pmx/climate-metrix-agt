"""Transport DTOs for the GHG Engine public HTTP surface.

This module defines the explicit wire shape of every API response. Unlike
``ghg_engine.models`` (which holds domain/internal Pydantic types), the
DTOs here are intentionally decoupled from internal schemas: a change to
an internal field must be ported through a mapper before it reaches the
frontend. That is the point of the DTO layer — it prevents accidental
wire-format regressions when internal types evolve.

Terminology note: the product concept is ``Reporting Unit``. The
internal Pydantic class is ``ReportingUnitDraft`` (a legacy alias
``FacilityDraft`` is retained in :mod:`ghg_engine.models` for any
caller that has not migrated yet). The on-the-wire JSON key for
backward compatibility with existing SQLite snapshots remains
``"facilities"``.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from ghg_engine.activity_catalog import (
    ActivityInputField,
    ActivityInputSchema,
    ActivityTypeDefinition,
    FactorQueryTemplate,
    ImplementationStatus,
    InputKind,
)
from ghg_engine.models import (
    AccountingMethod,
    ActivityDraft,
    AuditRecord,
    DraftQuantity,
    MethodSchema,
    ProjectSnapshot,
    ReportingUnitDraft,
    ResultRecord,
    Scope,
    SummaryRow,
    TraceRecord,
)


# ---------------------------------------------------------------------------
# Catalog / activity-type DTOs
# ---------------------------------------------------------------------------


class ActivityInputFieldDTO(BaseModel):
    field_id: str
    label: str
    kind: InputKind
    required: bool = True
    is_primary: bool = False
    default_unit: str | None = None
    allowed_units: list[str] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    param_key: str | None = None
    help_text: str | None = None


class ActivityInputSchemaDTO(BaseModel):
    fields: list[ActivityInputFieldDTO] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class FactorQueryTemplateDTO(BaseModel):
    domain: str
    type: str | None = None
    attributes: list[str] = Field(default_factory=list)
    description: str | None = None
    life_cycle_stage: str | None = None
    accounting_method: AccountingMethod | None = None
    geography_preference: str | None = None


class ActivityTypeDTO(BaseModel):
    activity_type_id: str
    workbook_aliases: list[str] = Field(default_factory=list)
    label: str
    description: str
    category: str
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    source_type: str | None = None
    metric_group: str
    metric_subgroup: str | None = None
    is_biogenic_default: bool = False
    default_unit: str
    allowed_units: list[str] = Field(default_factory=list)
    method_id: str
    emission_category: str | None = None
    factor_description: str | None = None
    implementation_status: ImplementationStatus
    input_schema: ActivityInputSchemaDTO
    factor_query_templates: list[FactorQueryTemplateDTO] = Field(default_factory=list)
    accounting_metadata: dict[str, Any] = Field(default_factory=dict)
    ui_metadata: dict[str, Any] = Field(default_factory=dict)
    audit_metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Result / trace / audit DTOs
# ---------------------------------------------------------------------------


class ResultRecordDTO(BaseModel):
    facility_id: str
    activity_type_id: str
    activity_label: str
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    activity_group: str | None = None
    source_type: str | None = None
    accounting_method: AccountingMethod
    gas: str
    value: float
    unit: str
    is_biogenic: bool
    method_id: str
    factor_ids: list[str] = Field(default_factory=list)
    time_bucket: str | None = None


class TraceRecordDTO(BaseModel):
    activity_type_id: str | None = None
    activity_label: str | None = None
    selected_method: str
    factor_matches: list[str] = Field(default_factory=list)
    conversions: list[str] = Field(default_factory=list)
    defaults_applied: list[str] = Field(default_factory=list)
    intermediate_quantities: dict[str, float] = Field(default_factory=dict)


class AuditRecordDTO(BaseModel):
    facility_id: str
    activity_type_id: str
    activity_label: str
    source_type: str | None = None
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    activity_group: str | None = None
    metric_group: str
    metric_subgroup: str | None = None
    accounting_method: AccountingMethod
    input_activity_value: float
    input_activity_unit: str
    input_params: dict[str, Any] = Field(default_factory=dict)
    eqm_method: str
    eqm_description: str
    eqm_steps: list[str] = Field(default_factory=list)
    factor_selection_notes: list[str] = Field(default_factory=list)
    activity_conversion_notes: list[str] = Field(default_factory=list)
    factor_conversion_notes: list[str] = Field(default_factory=list)
    factor_ids: list[str] = Field(default_factory=list)
    factor_co2_id: str | None = None
    factor_co2_value: float | None = None
    factor_co2_unit: str | None = None
    factor_co2_source: str | None = None
    factor_co2_valid_from: str | None = None
    factor_co2_valid_to: str | None = None
    factor_ch4_id: str | None = None
    factor_ch4_value: float | None = None
    factor_ch4_unit: str | None = None
    factor_ch4_source: str | None = None
    factor_ch4_valid_from: str | None = None
    factor_ch4_valid_to: str | None = None
    factor_n2o_id: str | None = None
    factor_n2o_value: float | None = None
    factor_n2o_unit: str | None = None
    factor_n2o_source: str | None = None
    factor_n2o_valid_from: str | None = None
    factor_n2o_valid_to: str | None = None
    co2_result_kg: float | None = None
    ch4_result_kg: float | None = None
    n2o_result_kg: float | None = None
    co2e_result_kg: float | None = None


class ActivityCalculationErrorDTO(BaseModel):
    """Per-activity calculation error surfaced through the calculate APIs.

    This DTO is the canonical definition for the error envelope used by
    :mod:`api.routers.calculation` when a single activity fails but the
    batch should still return partial results. Tests that imported the
    equivalent ``ActivityCalculationError`` from ``api.schemas`` continue
    to work via a re-export in that module.
    """

    activity_index: int
    activity_type_id: str | None = None
    facility_id: str | None = None
    error_code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Draft / snapshot DTOs
# ---------------------------------------------------------------------------


class DraftQuantityDTO(BaseModel):
    value: float | None = None
    unit: str = ""


class ReportingUnitDraftDTO(BaseModel):
    """Public wire shape of what is internally called ``ReportingUnitDraft``.

    ``applicable_activity_types`` is the Phase C2 source checklist. When
    non-empty, only those ``activity_type_id`` values are treated as
    applicable to this Reporting Unit; the canonical inventory and
    calculation tables are filtered accordingly. An empty list preserves
    legacy "show all" behavior so snapshots saved before the feature
    shipped continue to canonicalize unchanged.

    The ``name`` attribute serializes under the legacy ``facility_name``
    key so the JSON shape returned to the frontend matches what the
    frontend sends on save. Before Phase C3 the DTO serialized as
    ``"name"`` while the frontend expected ``"facility_name"``; that
    mismatch dropped every Reporting Unit's display name on checkpoint
    load.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str = Field(
        default="",
        validation_alias=AliasChoices("name", "facility_name"),
        serialization_alias="facility_name",
    )
    location: str = ""
    region: str = ""
    country: str = "US"
    state: str = ""
    egrid_subregion: str = ""
    reporting_group: str = ""
    owned_leased: str = "Owned"
    applicable_activity_types: list[str] = Field(default_factory=list)


class ActivityDraftDTO(BaseModel):
    id: str | None = None
    facility_id: str
    activity_type_id: str
    activity: DraftQuantityDTO = Field(default_factory=DraftQuantityDTO)
    params: dict[str, Any] = Field(default_factory=dict)
    period_start: datetime | None = None
    period_end: datetime | None = None
    timestamp: datetime | None = None
    duration: timedelta | None = None


class SummaryRowDTO(BaseModel):
    key: str
    value: float


class ProjectSnapshotDTO(BaseModel):
    """Public shape of a stored project snapshot.

    On the wire the reporting-unit list is keyed ``facilities`` for
    backward compatibility with existing SQLite snapshots. The DTO
    attribute is ``reporting_units`` so client code written against the
    new terminology can read it without string-key lookups.
    """

    model_config = ConfigDict(populate_by_name=True)

    snapshot_version: int
    reporting_units: list[ReportingUnitDraftDTO] = Field(
        default_factory=list,
        alias="facilities",
        serialization_alias="facilities",
    )
    activities: list[ActivityDraftDTO] = Field(default_factory=list)
    result_rows: list[ResultRecordDTO] = Field(default_factory=list)
    summary_rows: list[SummaryRowDTO] = Field(default_factory=list)
    trace_rows: list[TraceRecordDTO] = Field(default_factory=list)
    audit_rows: list[AuditRecordDTO] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Calculation response envelopes
# ---------------------------------------------------------------------------


class CalculationResponseDTO(BaseModel):
    results: list[ResultRecordDTO] = Field(default_factory=list)
    summary: dict[str, float] = Field(default_factory=dict)
    trace: list[TraceRecordDTO] | None = None
    errors: list[ActivityCalculationErrorDTO] = Field(default_factory=list)
    partial_success: bool = False


class CalculationAuditResponseDTO(CalculationResponseDTO):
    audit_rows: list[AuditRecordDTO] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Factor preview DTO
# ---------------------------------------------------------------------------


class FactorPreviewDTO(BaseModel):
    """Typed shape of a single row in ``/catalog/factors/preview``.

    Replaces the previous free-form ``dict`` response. The column set
    mirrors :py:meth:`ghg_engine.factors.FactorRepository.preview`.
    """

    factor_id: str
    emission_category: str
    type: str
    description: str
    attribute: str
    gas: str
    unit: str
    factor_source: str


# ---------------------------------------------------------------------------
# Method schema envelope
# ---------------------------------------------------------------------------


class MethodSchemaDTO(BaseModel):
    """Stable envelope around plugin-declared required params.

    ``required_params`` stays plugin-shaped for now — the contract that
    matters to the frontend is the envelope fields (``method_id``,
    ``version``). A future pass can formalize the inner shape.
    """

    method_id: str
    version: str
    required_params: dict[str, Any]


# ---------------------------------------------------------------------------
# Project / version DTOs
# ---------------------------------------------------------------------------


class ProjectResponseDTO(BaseModel):
    project_id: str
    name: str
    inventory_year: int
    created_at: str
    updated_at: str
    latest_version: int


class ProjectVersionSummaryDTO(BaseModel):
    version_id: int
    project_id: str
    version_number: int
    created_at: str
    inventory_year: int
    gwp_set: str
    include_trace: bool
    note: str | None = None


class ProjectSnapshotResponseDTO(BaseModel):
    version_id: int
    project_id: str
    version_number: int
    created_at: str
    inventory_year: int
    gwp_set: str
    include_trace: bool
    note: str | None = None
    snapshot: ProjectSnapshotDTO


class ProjectSnapshotSaveResponseDTO(BaseModel):
    project_id: str
    version_id: int
    version_number: int
    created_at: str


# ---------------------------------------------------------------------------
# Phase D1 — autosave draft DTOs
# ---------------------------------------------------------------------------


class ProjectDraftResponseDTO(BaseModel):
    """Wire shape returned from ``GET /projects/{id}/draft``.

    ``updated_at`` is the autosave timestamp; ``snapshot`` is the same
    shape the explicit-version endpoint emits so the frontend can apply
    a draft using the existing snapshot-application code path.
    """

    project_id: str
    updated_at: str
    inventory_year: int
    gwp_set: str
    include_trace: bool
    snapshot: ProjectSnapshotDTO


class ProjectDraftSaveResponseDTO(BaseModel):
    """Wire shape returned from ``POST /projects/{id}/draft``."""

    project_id: str
    updated_at: str


# ---------------------------------------------------------------------------
# Phase D3 — analytics DTOs (dashboard endpoint)
# ---------------------------------------------------------------------------


class ProjectAnalyticsRowDTO(BaseModel):
    """One pre-aggregated cell powering the dashboard.

    The grain is ``(facility_id, activity_type_id, scope)`` with
    ``co2e_kg`` summed at the SQL level. ``category`` and
    ``subcategory`` come from the in-memory activity catalog so the
    frontend can group/filter without re-walking the catalog itself.

    The frontend re-aggregates a list of these rows under arbitrary
    filter combinations (scope chips, RU dropdown, category dropdown);
    keeping the wire grain at this level means a single fetch powers
    every visualization on the dashboard.
    """

    facility_id: str
    facility_name: str
    activity_type_id: str
    activity_label: str
    scope: str
    category: str
    subcategory: str | None = None
    co2e_kg: float


class ProjectAnalyticsResponseDTO(BaseModel):
    """Wire shape returned from ``GET /projects/{id}/analytics``.

    ``total_co2e_kg`` and ``facility_count`` are surfaced at the top
    level so the headline KPI tile renders without a client-side
    reduce. The client still sums ``rows`` for filtered views — the
    precomputed totals are only authoritative for the unfiltered case.
    """

    version_id: int
    inventory_year: int
    rows: list[ProjectAnalyticsRowDTO] = Field(default_factory=list)
    total_co2e_kg: float
    facility_count: int


# ---------------------------------------------------------------------------
# Phase E1 — spend-based emissions DTOs
# ---------------------------------------------------------------------------


class GLMappingDTO(BaseModel):
    """A single GL-code -> factor_id mapping for a project.

    ``reporting_unit_id`` is ``None`` for the project-wide default
    fallback. When a per-RU mapping exists for the same gl_code, the
    per-RU mapping wins at calculation time.
    """

    mapping_id: int | None = None
    project_id: str
    reporting_unit_id: str | None = None
    gl_code: str
    factor_id: str
    created_at: str | None = None
    updated_at: str | None = None


class GLMappingInputDTO(BaseModel):
    """Body shape used inside ``GLMappingsRequestDTO``.

    Identifier fields (``mapping_id``, timestamps) are server-managed and
    omitted from the input — the PUT endpoint replaces the whole list
    atomically and re-issues primary keys.
    """

    reporting_unit_id: str | None = None
    gl_code: str
    factor_id: str


class GLMappingsRequestDTO(BaseModel):
    """Body of ``PUT /projects/{id}/gl-mappings``.

    The list is the project's full GL-mapping table after the request
    completes — server replaces atomically, no incremental upsert.
    """

    mappings: list[GLMappingInputDTO] = Field(default_factory=list)


class SpendFactorDTO(BaseModel):
    """Wire shape of a spend-based factor row from ``GET /catalog/spend-factors``."""

    factor_version_id: str
    source_record_key: str
    dataset_id: str
    factor_kind: str
    factor_type: str | None = None
    description: str | None = None
    attribute: str | None = None
    value: float
    unit_label: str
    region: str | None = None
    country: str | None = None
    data_year: int | None = None
    source_id: str | None = None


# ---------------------------------------------------------------------------
# Mapper functions (domain / internal -> DTO)
# ---------------------------------------------------------------------------


def activity_input_field_to_dto(field: ActivityInputField) -> ActivityInputFieldDTO:
    return ActivityInputFieldDTO.model_validate(field.model_dump())


def activity_input_schema_to_dto(schema: ActivityInputSchema) -> ActivityInputSchemaDTO:
    return ActivityInputSchemaDTO(
        fields=[activity_input_field_to_dto(f) for f in schema.fields],
        notes=list(schema.notes),
    )


def factor_query_template_to_dto(template: FactorQueryTemplate) -> FactorQueryTemplateDTO:
    return FactorQueryTemplateDTO.model_validate(template.model_dump())


def activity_type_to_dto(definition: ActivityTypeDefinition) -> ActivityTypeDTO:
    return ActivityTypeDTO(
        activity_type_id=definition.activity_type_id,
        workbook_aliases=list(definition.workbook_aliases),
        label=definition.label,
        description=definition.description,
        category=definition.category,
        scope=definition.scope,
        protocol_category_code=definition.protocol_category_code,
        protocol_category_label=definition.protocol_category_label,
        source_type=definition.source_type,
        metric_group=definition.metric_group,
        metric_subgroup=definition.metric_subgroup,
        is_biogenic_default=definition.is_biogenic_default,
        default_unit=definition.default_unit,
        allowed_units=list(definition.allowed_units),
        method_id=definition.method_id,
        emission_category=definition.emission_category,
        factor_description=definition.factor_description,
        implementation_status=definition.implementation_status,
        input_schema=activity_input_schema_to_dto(definition.input_schema),
        factor_query_templates=[
            factor_query_template_to_dto(t) for t in definition.factor_query_templates
        ],
        accounting_metadata=dict(definition.accounting_metadata),
        ui_metadata=dict(definition.ui_metadata),
        audit_metadata=dict(definition.audit_metadata),
    )


def result_record_to_dto(rec: ResultRecord) -> ResultRecordDTO:
    return ResultRecordDTO.model_validate(rec.model_dump())


def trace_record_to_dto(rec: TraceRecord) -> TraceRecordDTO:
    return TraceRecordDTO.model_validate(rec.model_dump())


def audit_record_to_dto(rec: AuditRecord) -> AuditRecordDTO:
    return AuditRecordDTO.model_validate(rec.model_dump())


def summary_row_to_dto(row: SummaryRow) -> SummaryRowDTO:
    return SummaryRowDTO.model_validate(row.model_dump())


def draft_quantity_to_dto(qty: DraftQuantity) -> DraftQuantityDTO:
    return DraftQuantityDTO.model_validate(qty.model_dump())


def reporting_unit_draft_to_dto(draft: ReportingUnitDraft) -> ReportingUnitDraftDTO:
    """Map a ``ReportingUnitDraft`` to its public DTO."""

    return ReportingUnitDraftDTO(
        id=draft.id,
        name=draft.name,
        location=draft.location,
        region=draft.region,
        country=draft.country,
        state=draft.state,
        egrid_subregion=draft.egrid_subregion,
        reporting_group=draft.reporting_group,
        owned_leased=draft.owned_leased,
        applicable_activity_types=list(draft.applicable_activity_types),
    )


# Deprecated alias kept so any caller that imported ``facility_draft_to_dto``
# during the DTO layer commit keeps working. Prefer the new name above.
facility_draft_to_dto = reporting_unit_draft_to_dto


def activity_draft_to_dto(draft: ActivityDraft) -> ActivityDraftDTO:
    return ActivityDraftDTO(
        id=draft.id,
        facility_id=draft.facility_id,
        activity_type_id=draft.activity_type_id,
        activity=draft_quantity_to_dto(draft.activity),
        params=dict(draft.params),
        period_start=draft.period_start,
        period_end=draft.period_end,
        timestamp=draft.timestamp,
        duration=draft.duration,
    )


def project_snapshot_to_dto(snap: ProjectSnapshot) -> ProjectSnapshotDTO:
    return ProjectSnapshotDTO(
        snapshot_version=snap.snapshot_version,
        reporting_units=[reporting_unit_draft_to_dto(r) for r in snap.reporting_units],
        activities=[activity_draft_to_dto(a) for a in snap.activities],
        result_rows=[result_record_to_dto(r) for r in snap.result_rows],
        summary_rows=[summary_row_to_dto(s) for s in snap.summary_rows],
        trace_rows=[trace_record_to_dto(t) for t in snap.trace_rows],
        audit_rows=[audit_record_to_dto(a) for a in snap.audit_rows],
    )


def calculation_response_to_dto(
    *,
    results: list[ResultRecord],
    summary: dict[str, float],
    trace: list[TraceRecord] | None,
    errors: list[ActivityCalculationErrorDTO] | None = None,
    partial_success: bool = False,
) -> CalculationResponseDTO:
    return CalculationResponseDTO(
        results=[result_record_to_dto(r) for r in results],
        summary=dict(summary),
        trace=[trace_record_to_dto(t) for t in trace] if trace is not None else None,
        errors=list(errors) if errors else [],
        partial_success=partial_success,
    )


def calculation_audit_response_to_dto(
    *,
    results: list[ResultRecord],
    summary: dict[str, float],
    trace: list[TraceRecord] | None,
    audit_rows: list[AuditRecord],
    errors: list[ActivityCalculationErrorDTO] | None = None,
    partial_success: bool = False,
) -> CalculationAuditResponseDTO:
    return CalculationAuditResponseDTO(
        results=[result_record_to_dto(r) for r in results],
        summary=dict(summary),
        trace=[trace_record_to_dto(t) for t in trace] if trace is not None else None,
        audit_rows=[audit_record_to_dto(a) for a in audit_rows],
        errors=list(errors) if errors else [],
        partial_success=partial_success,
    )


def factor_preview_to_dto(row: dict[str, Any]) -> FactorPreviewDTO:
    """Coerce a preview row (from pandas ``to_dict(orient='records')``) into a DTO.

    Missing or ``None`` values are normalized to empty strings so the DTO
    schema stays tight without forcing the repository to populate every
    column for every row.
    """

    def _str(key: str) -> str:
        value = row.get(key)
        if value is None:
            return ""
        return str(value)

    return FactorPreviewDTO(
        factor_id=_str("factor_id"),
        emission_category=_str("emission_category"),
        type=_str("type"),
        description=_str("description"),
        attribute=_str("attribute"),
        gas=_str("gas"),
        unit=_str("unit"),
        factor_source=_str("factor_source"),
    )


def method_schema_to_dto(ms: MethodSchema) -> MethodSchemaDTO:
    return MethodSchemaDTO(
        method_id=ms.method_id,
        version=ms.version,
        required_params=dict(ms.required_params),
    )


def gl_mapping_to_dto(row: dict[str, Any]) -> GLMappingDTO:
    """Coerce a ``ProjectStore.list_gl_mappings`` row into a DTO."""

    return GLMappingDTO(
        mapping_id=row.get("mapping_id"),
        project_id=str(row.get("project_id") or ""),
        reporting_unit_id=row.get("reporting_unit_id") or None,
        gl_code=str(row.get("gl_code") or ""),
        factor_id=str(row.get("factor_id") or ""),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def spend_factor_to_dto(row: dict[str, Any]) -> SpendFactorDTO:
    """Coerce a ``ProjectStore.list_spend_factors`` row into a DTO."""

    return SpendFactorDTO(
        factor_version_id=str(row.get("factor_version_id") or ""),
        source_record_key=str(row.get("source_record_key") or ""),
        dataset_id=str(row.get("dataset_id") or ""),
        factor_kind=str(row.get("factor_kind") or "spend"),
        factor_type=row.get("factor_type"),
        description=row.get("subtype_or_description") or row.get("description"),
        attribute=row.get("attribute"),
        value=float(row.get("value") or 0.0),
        unit_label=str(row.get("unit_label") or ""),
        region=row.get("region"),
        country=row.get("country"),
        data_year=int(row["data_year"]) if row.get("data_year") is not None else None,
        source_id=row.get("source_id"),
    )


__all__ = [
    "ActivityInputFieldDTO",
    "ActivityInputSchemaDTO",
    "FactorQueryTemplateDTO",
    "ActivityTypeDTO",
    "ResultRecordDTO",
    "TraceRecordDTO",
    "AuditRecordDTO",
    "ActivityCalculationErrorDTO",
    "DraftQuantityDTO",
    "ReportingUnitDraftDTO",
    "ActivityDraftDTO",
    "SummaryRowDTO",
    "ProjectSnapshotDTO",
    "CalculationResponseDTO",
    "CalculationAuditResponseDTO",
    "FactorPreviewDTO",
    "MethodSchemaDTO",
    "ProjectResponseDTO",
    "ProjectVersionSummaryDTO",
    "ProjectSnapshotResponseDTO",
    "ProjectSnapshotSaveResponseDTO",
    "ProjectDraftResponseDTO",
    "ProjectDraftSaveResponseDTO",
    "ProjectAnalyticsRowDTO",
    "ProjectAnalyticsResponseDTO",
    "GLMappingDTO",
    "GLMappingInputDTO",
    "GLMappingsRequestDTO",
    "SpendFactorDTO",
    "activity_input_field_to_dto",
    "activity_input_schema_to_dto",
    "factor_query_template_to_dto",
    "activity_type_to_dto",
    "result_record_to_dto",
    "trace_record_to_dto",
    "audit_record_to_dto",
    "summary_row_to_dto",
    "draft_quantity_to_dto",
    "facility_draft_to_dto",
    "reporting_unit_draft_to_dto",
    "activity_draft_to_dto",
    "project_snapshot_to_dto",
    "calculation_response_to_dto",
    "calculation_audit_response_to_dto",
    "factor_preview_to_dto",
    "method_schema_to_dto",
    "gl_mapping_to_dto",
    "spend_factor_to_dto",
]
