from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_activity_catalog, get_project_store
from api.dto import (
    ProjectResponseDTO,
    ProjectSnapshotResponseDTO,
    ProjectSnapshotSaveResponseDTO,
    ProjectVersionSummaryDTO,
    project_snapshot_to_dto,
)
from api.schemas import (
    ProjectCreateRequest,
    ProjectRenameRequest,
    ProjectSnapshotSaveRequest,
    SchemaInfoResponse,
    SchemaMigrationItem,
)
from ghg_engine.activity_catalog import ActivityCatalog
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
    activity_catalog: ActivityCatalog = Depends(get_activity_catalog),
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
            activity_catalog=activity_catalog,
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
