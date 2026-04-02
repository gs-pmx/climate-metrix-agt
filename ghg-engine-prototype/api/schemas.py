from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord


class CalculationRequest(BaseModel):
    context: CalculationContext
    activities: list[ActivityRecord]


class CalculationResponse(BaseModel):
    results: list[ResultRecord]
    summary: dict[str, float]
    trace: list[TraceRecord] | None = None


class CalculationAuditRow(BaseModel):
    facility_id: str
    source_id: str | None = None
    source_type: str
    scope: str
    accounting_method: str
    metric_group: str
    metric_subgroup: str | None = None
    input_activity_value: float
    input_activity_unit: str
    eqm_method: str
    eqm_description: str
    eqm_steps: list[str]
    factor_selection_notes: list[str]
    activity_conversion_notes: list[str]
    factor_conversion_notes: list[str]
    factor_ids: list[str]
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


class CalculationAuditResponse(CalculationResponse):
    audit_rows: list[CalculationAuditRow]


class ProjectCreateRequest(BaseModel):
    name: str
    inventory_year: int


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    inventory_year: int
    created_at: str
    updated_at: str
    latest_version: int


class ProjectRenameRequest(BaseModel):
    name: str


class ProjectVersionSummary(BaseModel):
    version_id: int
    project_id: str
    version_number: int
    created_at: str
    inventory_year: int
    gwp_set: str
    include_trace: bool
    note: str | None = None


class ProjectSnapshotSaveRequest(BaseModel):
    inventory_year: int
    gwp_set: str
    include_trace: bool
    facilities: list[dict[str, Any]]
    activities: list[dict[str, Any]]
    result_rows: list[dict[str, Any]]
    summary_rows: list[dict[str, Any]]
    trace_rows: list[dict[str, Any]]
    audit_rows: list[dict[str, Any]] = []
    note: str | None = None


class ProjectSnapshotSaveResponse(BaseModel):
    project_id: str
    version_id: int
    version_number: int
    created_at: str


class ProjectSnapshotResponse(BaseModel):
    version_id: int
    project_id: str
    version_number: int
    created_at: str
    inventory_year: int
    gwp_set: str
    include_trace: bool
    note: str | None = None
    snapshot: dict[str, Any]


class SchemaMigrationItem(BaseModel):
    version: int
    description: str
    applied_at: str


class SchemaInfoResponse(BaseModel):
    current_version: int
    migrations: list[SchemaMigrationItem]
