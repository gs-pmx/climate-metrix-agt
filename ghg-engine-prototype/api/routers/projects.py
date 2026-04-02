from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_project_store
from api.schemas import (
    ProjectCreateRequest,
    ProjectRenameRequest,
    ProjectResponse,
    ProjectSnapshotResponse,
    ProjectSnapshotSaveRequest,
    ProjectSnapshotSaveResponse,
    ProjectVersionSummary,
    SchemaInfoResponse,
    SchemaMigrationItem,
)
from project_store import ProjectStore

router = APIRouter()


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(store: ProjectStore = Depends(get_project_store)):
    return [ProjectResponse(**row) for row in store.list_projects()]


@router.post("/projects", response_model=ProjectResponse)
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
    return ProjectResponse(**row)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def rename_project(project_id: str, payload: ProjectRenameRequest, store: ProjectStore = Depends(get_project_store)):
    new_name = payload.name.strip()
    if len(new_name) < 2:
        raise HTTPException(status_code=400, detail="Project name must be at least 2 characters.")
    try:
        row = store.rename_project(project_id, new_name)
        return ProjectResponse(**row)
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


@router.get("/projects/{project_id}/versions", response_model=list[ProjectVersionSummary])
def list_project_versions(project_id: str, store: ProjectStore = Depends(get_project_store)):
    rows = store.list_versions(project_id)
    return [ProjectVersionSummary(**{**row, "include_trace": bool(row["include_trace"])}) for row in rows]


@router.get("/projects/{project_id}/snapshot", response_model=ProjectSnapshotResponse)
def get_project_snapshot(
    project_id: str,
    version_number: int | None = Query(default=None),
    store: ProjectStore = Depends(get_project_store),
):
    try:
        data = store.get_version_snapshot(project_id, version_number=version_number)
        return ProjectSnapshotResponse(**data)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/projects/{project_id}/versions", response_model=ProjectSnapshotSaveResponse)
def save_project_version(
    project_id: str,
    payload: ProjectSnapshotSaveRequest,
    store: ProjectStore = Depends(get_project_store),
):
    if payload.inventory_year < 1900 or payload.inventory_year > 3000:
        raise HTTPException(status_code=400, detail="Inventory year must be between 1900 and 3000.")
    snapshot = {
        "facilities": payload.facilities,
        "activities": payload.activities,
        "result_rows": payload.result_rows,
        "summary_rows": payload.summary_rows,
        "trace_rows": payload.trace_rows,
        "audit_rows": payload.audit_rows,
    }
    try:
        saved = store.save_project_snapshot(
            project_id=project_id,
            inventory_year=payload.inventory_year,
            gwp_set=payload.gwp_set,
            include_trace=payload.include_trace,
            snapshot=snapshot,
            note=payload.note.strip() if payload.note else None,
        )
        return ProjectSnapshotSaveResponse(**saved)
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
