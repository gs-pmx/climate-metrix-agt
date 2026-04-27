from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_activity_catalog, get_project_store
from api.dto import (
    ProjectAnalyticsResponseDTO,
    ProjectAnalyticsRowDTO,
    ProjectDraftResponseDTO,
    ProjectDraftSaveResponseDTO,
    ProjectResponseDTO,
    ProjectSnapshotResponseDTO,
    ProjectSnapshotSaveResponseDTO,
    ProjectVersionSummaryDTO,
    project_snapshot_to_dto,
)
from api.schemas import (
    ProjectCreateRequest,
    ProjectDraftSaveRequest,
    ProjectRenameRequest,
    ProjectSnapshotSaveRequest,
    SchemaInfoResponse,
    SchemaMigrationItem,
)
from ghg_engine.activity_catalog import ActivityCatalog
from ghg_engine.services.analytics import compute_project_analytics
from project_store import ProjectStore

router = APIRouter()


@router.get("/projects", response_model=list[ProjectResponseDTO])
def list_projects(store: ProjectStore = Depends(get_project_store)):
    return [ProjectResponseDTO(**row) for row in store.list_projects()]


@router.post("/projects", response_model=ProjectResponseDTO)
def create_project(payload: ProjectCreateRequest, store: ProjectStore = Depends(get_project_store)):
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Project name must be at least 2 characters.")
    if payload.inventory_year < 1900 or payload.inventory_year > 3000:
        raise HTTPException(status_code=400, detail="Inventory year must be between 1900 and 3000.")
    try:
        row = store.create_project(
            project_id=f"prj_{uuid4().hex[:12]}",
            name=name,
            inventory_year=payload.inventory_year,
        )
    except Exception as e:
        msg = str(e).lower()
        if "unique" in msg:
            raise HTTPException(status_code=409, detail="A project with this name already exists.") from e
        raise HTTPException(status_code=500, detail=f"Failed to create project: {e}") from e
    return ProjectResponseDTO(**row)


@router.patch("/projects/{project_id}", response_model=ProjectResponseDTO)
def rename_project(project_id: str, payload: ProjectRenameRequest, store: ProjectStore = Depends(get_project_store)):
    new_name = payload.name.strip()
    if len(new_name) < 2:
        raise HTTPException(status_code=400, detail="Project name must be at least 2 characters.")
    try:
        row = store.rename_project(project_id, new_name)
        return ProjectResponseDTO(**row)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        msg = str(e).lower()
        if "unique" in msg:
            raise HTTPException(status_code=409, detail="A project with this name already exists.") from e
        raise HTTPException(status_code=500, detail=f"Failed to rename project: {e}") from e


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, store: ProjectStore = Depends(get_project_store)):
    try:
        store.delete_project(project_id)
        return {"status": "deleted", "project_id": project_id}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/projects/{project_id}/versions", response_model=list[ProjectVersionSummaryDTO])
def list_project_versions(project_id: str, store: ProjectStore = Depends(get_project_store)):
    rows = store.list_versions(project_id)
    return [
        ProjectVersionSummaryDTO(**{**row, "include_trace": bool(row["include_trace"])})
        for row in rows
    ]


@router.get("/projects/{project_id}/snapshot", response_model=ProjectSnapshotResponseDTO)
def get_project_snapshot(
    project_id: str,
    version_number: int | None = Query(default=None),
    store: ProjectStore = Depends(get_project_store),
):
    try:
        data = store.get_version_snapshot(project_id, version_number=version_number)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    snapshot_dto = project_snapshot_to_dto(data["snapshot"])
    return ProjectSnapshotResponseDTO(
        version_id=data["version_id"],
        project_id=data["project_id"],
        version_number=data["version_number"],
        created_at=data["created_at"],
        inventory_year=data["inventory_year"],
        gwp_set=data["gwp_set"],
        include_trace=bool(data["include_trace"]),
        note=data.get("note"),
        snapshot=snapshot_dto,
    )


@router.post("/projects/{project_id}/versions", response_model=ProjectSnapshotSaveResponseDTO)
def save_project_version(
    project_id: str,
    payload: ProjectSnapshotSaveRequest,
    store: ProjectStore = Depends(get_project_store),
):
    if payload.inventory_year < 1900 or payload.inventory_year > 3000:
        raise HTTPException(status_code=400, detail="Inventory year must be between 1900 and 3000.")
    try:
        saved = store.save_project_snapshot(
            project_id=project_id,
            inventory_year=payload.inventory_year,
            gwp_set=payload.gwp_set,
            include_trace=payload.include_trace,
            snapshot=payload.snapshot,
            note=payload.note.strip() if payload.note else None,
        )
        return ProjectSnapshotSaveResponseDTO(**saved)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save project version: {e}") from e


@router.get("/schema/migrations", response_model=SchemaInfoResponse)
def schema_migrations(store: ProjectStore = Depends(get_project_store)):
    info = store.schema_info()
    return SchemaInfoResponse(
        current_version=info["current_version"],
        migrations=[SchemaMigrationItem(**r) for r in info["migrations"]],
    )


# ---------------------------------------------------------------------------
# Phase D1 — autosave draft endpoints
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/draft", response_model=ProjectDraftResponseDTO)
def get_project_draft(
    project_id: str,
    store: ProjectStore = Depends(get_project_store),
):
    draft = store.load_project_draft(project_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="No draft found for project.")
    snapshot_dto = project_snapshot_to_dto(draft["snapshot"])
    return ProjectDraftResponseDTO(
        project_id=draft["project_id"],
        updated_at=draft["updated_at"],
        inventory_year=draft["inventory_year"],
        gwp_set=draft["gwp_set"],
        include_trace=bool(draft["include_trace"]),
        snapshot=snapshot_dto,
    )


@router.post("/projects/{project_id}/draft", response_model=ProjectDraftSaveResponseDTO)
def save_project_draft(
    project_id: str,
    payload: ProjectDraftSaveRequest,
    store: ProjectStore = Depends(get_project_store),
):
    if payload.inventory_year < 1900 or payload.inventory_year > 3000:
        raise HTTPException(status_code=400, detail="Inventory year must be between 1900 and 3000.")
    try:
        saved = store.save_project_draft(
            project_id=project_id,
            inventory_year=payload.inventory_year,
            gwp_set=payload.gwp_set,
            include_trace=payload.include_trace,
            snapshot=payload.snapshot,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save draft: {e}") from e
    return ProjectDraftSaveResponseDTO(**saved)


@router.delete("/projects/{project_id}/draft")
def delete_project_draft(
    project_id: str,
    store: ProjectStore = Depends(get_project_store),
):
    # Idempotent: a missing draft is still a "deleted" outcome from the
    # caller's perspective (matches the user-discard intent on the
    # restore banner).
    store.delete_project_draft(project_id)
    return {"status": "deleted", "project_id": project_id}


# ---------------------------------------------------------------------------
# Phase D3 — analytics endpoint (dashboard)
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/analytics",
    response_model=ProjectAnalyticsResponseDTO,
)
def get_project_analytics(
    project_id: str,
    version_id: int | None = Query(default=None),
    store: ProjectStore = Depends(get_project_store),
    activity_catalog: ActivityCatalog = Depends(get_activity_catalog),
):
    """Aggregated CO2e analytics for the dashboard.

    When ``version_id`` is omitted, the latest inventory version for the
    project is used. A 404 is returned if the project has no versions or
    if the supplied ``version_id`` doesn't belong to the project. Both
    paths fold into the same "version not found for project" error so an
    unknown-project case (no versions) and an unknown-version case
    return identically — the frontend only needs to know there's
    nothing to render.

    The response shape is documented on
    :class:`ProjectAnalyticsResponseDTO`. Pre-aggregated rows are at
    ``(facility, activity_type, scope, category)`` grain; the frontend
    re-filters and re-aggregates client-side under arbitrary scope/RU
    /category filter combinations.
    """

    result = compute_project_analytics(
        db_path=store._db_path,  # noqa: SLF001 - analytics is co-located with the store layer
        project_id=project_id,
        version_id=version_id,
        activity_catalog=activity_catalog,
    )
    if result is None:
        # Both "unknown project" and "version_id not in this project"
        # collapse here. The frontend only needs a 404 to know there's
        # nothing to render; the precise message is for debuggability.
        raise HTTPException(
            status_code=404,
            detail="No inventory version found for this project.",
        )
    return ProjectAnalyticsResponseDTO(
        version_id=result.version_id,
        inventory_year=result.inventory_year,
        rows=[
            ProjectAnalyticsRowDTO(
                facility_id=row.facility_id,
                facility_name=row.facility_name,
                activity_type_id=row.activity_type_id,
                activity_label=row.activity_label,
                scope=row.scope,
                category=row.category,
                subcategory=row.subcategory,
                co2e_kg=row.co2e_kg,
            )
            for row in result.rows
        ],
        total_co2e_kg=result.total_co2e_kg,
        facility_count=result.facility_count,
    )
