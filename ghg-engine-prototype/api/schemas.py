"""Legacy import surface for API schemas.

Historically this module held both request models (input validation)
and response aliases that were transparent passthroughs to internal
types. The canonical home for response DTOs is now :mod:`api.dto`.

This module keeps:

* The **input** schemas — ``CalculationRequest``, ``ProjectCreateRequest``,
  ``ProjectRenameRequest``, ``ProjectSnapshotSaveRequest``,
  ``SchemaMigrationItem``, ``SchemaInfoResponse`` — these are request
  shapes or simple info envelopes that have never been a wire-format
  stability concern.
* Re-exports of a few DTO symbols under their historical names so
  existing tests and any downstream importers do not break.

New code should import response types from :mod:`api.dto` directly.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from api.dto import (
    ActivityCalculationErrorDTO,
    ActivityTypeDTO,
    CalculationAuditResponseDTO,
    CalculationResponseDTO,
    ProjectResponseDTO,
    ProjectSnapshotResponseDTO,
    ProjectSnapshotSaveResponseDTO,
    ProjectVersionSummaryDTO,
)
from ghg_engine.models import (
    ActivityRecord,
    CalculationContext,
    ProjectSnapshot,
)


class CalculationRequest(BaseModel):
    context: CalculationContext
    activities: list[ActivityRecord]


class ProjectCreateRequest(BaseModel):
    name: str
    inventory_year: int


class ProjectRenameRequest(BaseModel):
    name: str


class ProjectSnapshotSaveRequest(BaseModel):
    inventory_year: int
    gwp_set: str
    include_trace: bool
    snapshot: ProjectSnapshot
    note: str | None = None


class SchemaMigrationItem(BaseModel):
    version: int
    description: str
    applied_at: str


class SchemaInfoResponse(BaseModel):
    current_version: int
    migrations: list[SchemaMigrationItem]


# ---------------------------------------------------------------------------
# Backward-compatible re-exports. Prefer importing from ``api.dto`` directly.
# ---------------------------------------------------------------------------

# B3 shipped ``ActivityCalculationError`` on this module. The canonical
# definition now lives in ``api.dto`` as ``ActivityCalculationErrorDTO``;
# this alias preserves the historical import path.
ActivityCalculationError = ActivityCalculationErrorDTO

# Response types keep their historical names as aliases into ``api.dto``.
CalculationResponse = CalculationResponseDTO
CalculationAuditResponse = CalculationAuditResponseDTO

# ``CalculationAuditRow`` used to be a class that extended ``AuditRecord``.
# It is kept as an alias of ``AuditRecordDTO`` so existing call sites that
# constructed ``CalculationAuditRow(**dict)`` still work.
from api.dto import AuditRecordDTO as CalculationAuditRow  # noqa: E402

# The catalog activity-type response used to be a transparent subclass of
# ``ActivityTypeDefinition``. It is now a DTO.
ActivityTypeResponse = ActivityTypeDTO

ProjectResponse = ProjectResponseDTO
ProjectVersionSummary = ProjectVersionSummaryDTO
ProjectSnapshotResponse = ProjectSnapshotResponseDTO
ProjectSnapshotSaveResponse = ProjectSnapshotSaveResponseDTO


__all__ = [
    "CalculationRequest",
    "ProjectCreateRequest",
    "ProjectRenameRequest",
    "ProjectSnapshotSaveRequest",
    "SchemaMigrationItem",
    "SchemaInfoResponse",
    "ActivityCalculationError",
    "CalculationResponse",
    "CalculationAuditResponse",
    "CalculationAuditRow",
    "ActivityTypeResponse",
    "ProjectResponse",
    "ProjectVersionSummary",
    "ProjectSnapshotResponse",
    "ProjectSnapshotSaveResponse",
]
