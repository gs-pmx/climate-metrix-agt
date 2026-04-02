from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import get_settings
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from ghg_engine.routing import RoutingCatalog
from project_store import ProjectStore

settings = get_settings()

app = FastAPI(title="GHG Prototype API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTING = RoutingCatalog.from_csv(str(settings.data_dir / "routing.csv"))
FACTORS = FactorRepository.from_csv(str(settings.data_dir / "factors.csv"))
ENGINE = GHGEngine(ROUTING, FACTORS)
PROJECT_STORE = ProjectStore(settings.db_path)


@app.get("/catalog/routing")
def catalog_routing():
    return [r.model_dump() for r in ROUTING.rows]


class CalculationRequest(BaseModel):
    context: CalculationContext
    activities: list[ActivityRecord]


class CalculationResponse(BaseModel):
    results: list[ResultRecord]
    summary: dict[str, float]
    trace: list[TraceRecord] | None = None


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


@app.post("/calculate", response_model=CalculationResponse)
def calculate(payload: CalculationRequest):
    try:
        rows, summary, trace = ENGINE.calculate(payload.activities, payload.context)
        return CalculationResponse(
            results=rows,
            summary=summary,
            trace=trace if payload.context.include_trace else None,
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _eqm_description(method_id: str) -> str:
    descriptions = {
        "direct_factor": "Applies gas-specific emission factors to activity, normalizes to kg, and computes CO2e.",
        "miles_to_fuel": "Converts miles to gallons with MPG, then applies direct gas-specific emission factors.",
    }
    return descriptions.get(method_id, "No method description available.")


def _factor_detail(factor_id: str | None) -> dict[str, Any] | None:
    if not factor_id:
        return None
    factor = FACTORS.get_by_factor_id(factor_id)
    if factor is None:
        return None
    return {
        "factor_id": factor.factor_id,
        "value": factor.value,
        "unit": factor.unit,
        "source": factor.factor_source or factor.source_entity_short,
        "valid_from": str(factor.valid_from) if factor.valid_from else None,
        "valid_to": str(factor.valid_to) if factor.valid_to else None,
    }


def _conversion_notes(activity_unit: str, factor_unit: str | None) -> tuple[str | None, str | None]:
    if not factor_unit or "/" not in factor_unit:
        return None, None
    numerator, denominator = [s.strip() for s in factor_unit.split("/", 1)]
    activity_note = None
    factor_note = None
    if denominator.lower() != str(activity_unit).lower():
        activity_note = f"activity converted from {activity_unit} to {denominator}"
    if numerator.lower() not in {"kg", "kilogram", "kilograms"}:
        factor_note = f"factor converted from {numerator} to kg"
    return activity_note, factor_note


def _build_audit_rows(
    activity: ActivityRecord,
    rows: list[ResultRecord],
    trace: TraceRecord,
) -> list[CalculationAuditRow]:
    def _factor_for_gas(gas_name: str) -> dict[str, Any] | None:
        row = gas_rows.get(gas_name)
        if row is None or not row.factor_ids:
            return None
        return _factor_detail(row.factor_ids[0])

    by_method: dict[str, list[ResultRecord]] = defaultdict(list)
    for row in rows:
        by_method[row.accounting_method].append(row)

    out: list[CalculationAuditRow] = []
    for accounting_method, method_rows in by_method.items():
        gas_rows = {r.gas: r for r in method_rows}
        factor_ids: list[str] = []
        for r in method_rows:
            for fid in r.factor_ids:
                if fid not in factor_ids:
                    factor_ids.append(fid)

        f_co2 = _factor_for_gas("co2")
        f_ch4 = _factor_for_gas("ch4")
        f_n2o = _factor_for_gas("n2o")

        activity_notes: list[str] = []
        factor_notes: list[str] = []
        for factor in [f_co2, f_ch4, f_n2o]:
            if not factor:
                continue
            activity_note, factor_note = _conversion_notes(activity.activity.unit, factor.get("unit"))
            if activity_note and activity_note not in activity_notes:
                activity_notes.append(activity_note)
            if factor_note and factor_note not in factor_notes:
                factor_notes.append(factor_note)

        for step in trace.conversions:
            if step not in activity_notes:
                activity_notes.append(step)

        out.append(
            CalculationAuditRow(
                facility_id=activity.facility_id,
                source_id=activity.source_id,
                source_type=activity.source_type,
                scope=activity.scope,
                accounting_method=accounting_method,
                metric_group=activity.metric_group,
                metric_subgroup=activity.metric_subgroup,
                input_activity_value=float(activity.activity.value),
                input_activity_unit=activity.activity.unit,
                eqm_method=trace.selected_method,
                eqm_description=_eqm_description(trace.selected_method),
                eqm_steps=trace.conversions,
                factor_selection_notes=trace.defaults_applied,
                activity_conversion_notes=activity_notes,
                factor_conversion_notes=factor_notes,
                factor_ids=factor_ids,
                factor_co2_id=f_co2["factor_id"] if f_co2 else None,
                factor_co2_value=f_co2["value"] if f_co2 else None,
                factor_co2_unit=f_co2["unit"] if f_co2 else None,
                factor_co2_source=f_co2["source"] if f_co2 else None,
                factor_co2_valid_from=f_co2["valid_from"] if f_co2 else None,
                factor_co2_valid_to=f_co2["valid_to"] if f_co2 else None,
                factor_ch4_id=f_ch4["factor_id"] if f_ch4 else None,
                factor_ch4_value=f_ch4["value"] if f_ch4 else None,
                factor_ch4_unit=f_ch4["unit"] if f_ch4 else None,
                factor_ch4_source=f_ch4["source"] if f_ch4 else None,
                factor_ch4_valid_from=f_ch4["valid_from"] if f_ch4 else None,
                factor_ch4_valid_to=f_ch4["valid_to"] if f_ch4 else None,
                factor_n2o_id=f_n2o["factor_id"] if f_n2o else None,
                factor_n2o_value=f_n2o["value"] if f_n2o else None,
                factor_n2o_unit=f_n2o["unit"] if f_n2o else None,
                factor_n2o_source=f_n2o["source"] if f_n2o else None,
                factor_n2o_valid_from=f_n2o["valid_from"] if f_n2o else None,
                factor_n2o_valid_to=f_n2o["valid_to"] if f_n2o else None,
                co2_result_kg=gas_rows["co2"].value if gas_rows.get("co2") else None,
                ch4_result_kg=gas_rows["ch4"].value if gas_rows.get("ch4") else None,
                n2o_result_kg=gas_rows["n2o"].value if gas_rows.get("n2o") else None,
                co2e_result_kg=gas_rows["co2e"].value if gas_rows.get("co2e") else None,
            )
        )
    return out


@app.post("/calculate/audit", response_model=CalculationAuditResponse)
def calculate_with_audit(payload: CalculationRequest):
    try:
        all_rows: list[ResultRecord] = []
        traces: list[TraceRecord] = []
        audit_rows: list[CalculationAuditRow] = []
        summary: dict[str, float] = defaultdict(float)
        for activity in payload.activities:
            rows, trace = ENGINE.calculate_one(activity, payload.context)
            all_rows.extend(rows)
            traces.append(trace)
            for row in rows:
                key = f"{row.facility_id}|{row.scope}|{row.accounting_method}|{row.gas}|{row.unit}"
                summary[key] = float(summary.get(key, 0.0) + row.value)
            audit_rows.extend(_build_audit_rows(activity, rows, trace))
        return CalculationAuditResponse(
            results=all_rows,
            summary=dict(summary),
            trace=traces if payload.context.include_trace else None,
            audit_rows=audit_rows,
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/projects", response_model=list[ProjectResponse])
def list_projects():
    return [ProjectResponse(**row) for row in PROJECT_STORE.list_projects()]


@app.post("/projects", response_model=ProjectResponse)
def create_project(payload: ProjectCreateRequest):
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Project name must be at least 2 characters.")
    if payload.inventory_year < 1900 or payload.inventory_year > 3000:
        raise HTTPException(status_code=400, detail="Inventory year must be between 1900 and 3000.")
    try:
        row = PROJECT_STORE.create_project(
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


@app.patch("/projects/{project_id}", response_model=ProjectResponse)
def rename_project(project_id: str, payload: ProjectRenameRequest):
    new_name = payload.name.strip()
    if len(new_name) < 2:
        raise HTTPException(status_code=400, detail="Project name must be at least 2 characters.")
    try:
        row = PROJECT_STORE.rename_project(project_id, new_name)
        return ProjectResponse(**row)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        msg = str(e).lower()
        if "unique" in msg:
            raise HTTPException(status_code=409, detail="A project with this name already exists.") from e
        raise HTTPException(status_code=500, detail=f"Failed to rename project: {e}") from e


@app.delete("/projects/{project_id}")
def delete_project(project_id: str):
    try:
        PROJECT_STORE.delete_project(project_id)
        return {"status": "deleted", "project_id": project_id}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/projects/{project_id}/versions", response_model=list[ProjectVersionSummary])
def list_project_versions(project_id: str):
    rows = PROJECT_STORE.list_versions(project_id)
    return [ProjectVersionSummary(**{**row, "include_trace": bool(row["include_trace"])}) for row in rows]


@app.get("/projects/{project_id}/snapshot", response_model=ProjectSnapshotResponse)
def get_project_snapshot(project_id: str, version_number: int | None = Query(default=None)):
    try:
        data = PROJECT_STORE.get_version_snapshot(project_id, version_number=version_number)
        return ProjectSnapshotResponse(**data)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/projects/{project_id}/versions", response_model=ProjectSnapshotSaveResponse)
def save_project_version(project_id: str, payload: ProjectSnapshotSaveRequest):
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
        saved = PROJECT_STORE.save_project_snapshot(
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


@app.get("/schema/migrations", response_model=SchemaInfoResponse)
def schema_migrations():
    info = PROJECT_STORE.schema_info()
    return SchemaInfoResponse(
        current_version=info["current_version"],
        migrations=[SchemaMigrationItem(**r) for r in info["migrations"]],
    )


@app.get("/catalog/factors/preview")
def catalog_factors_preview(query: str | None = Query(default=None)):
    return FACTORS.preview(query)


@app.get("/schema/method/{method_id}")
def schema_method(method_id: str):
    try:
        return ENGINE.method_schema(method_id).model_dump()
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
