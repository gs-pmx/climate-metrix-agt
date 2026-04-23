from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ghg_engine.activity_catalog import ActivityTypeDefinition
from ghg_engine.models import (
    ActivityRecord,
    AuditRecord,
    CalculationContext,
    ProjectSnapshot,
    ResultRecord,
    TraceRecord,
)


class CalculationRequest(BaseModel):
    context: CalculationContext
    activities: list[ActivityRecord]


class ActivityCalculationError(BaseModel):
    activity_index: int
    activity_type_id: str | None = None
    facility_id: str | None = None
    error_code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class CalculationResponse(BaseModel):
    results: list[ResultRecord] = Field(default_factory=list)
    summary: dict[str, float] = Field(default_factory=dict)
    trace: list[TraceRecord] | None = None
    errors: list[ActivityCalculationError] = Field(default_factory=list)
    partial_success: bool = False


class CalculationAuditRow(AuditRecord):
    pass


class CalculationAuditResponse(CalculationResponse):
    audit_rows: list[CalculationAuditRow] = Field(default_factory=list)


class ActivityTypeResponse(ActivityTypeDefinition):
    pass


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
    snapshot: ProjectSnapshot
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
    snapshot: ProjectSnapshot


class SchemaMigrationItem(BaseModel):
    version: int
    description: str
    applied_at: str


class SchemaInfoResponse(BaseModel):
    current_version: int
    migrations: list[SchemaMigrationItem]
