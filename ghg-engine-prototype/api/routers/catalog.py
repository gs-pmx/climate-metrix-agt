from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_activity_catalog, get_engine, get_factors, get_routing
from api.schemas import ActivitySchemaResponse, ActivityTypeResponse
from ghg_engine.activity_catalog import ActivityCatalog, ImplementationStatus
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.routing import RoutingCatalog

router = APIRouter()


@router.get("/catalog/routing")
def catalog_routing(routing: RoutingCatalog = Depends(get_routing)):
    return [r.model_dump() for r in routing.rows]


@router.get("/catalog/factors/preview")
def catalog_factors_preview(
    query: str | None = Query(default=None),
    factors: FactorRepository = Depends(get_factors),
):
    return factors.preview(query)


@router.get("/catalog/activity-types", response_model=list[ActivityTypeResponse])
def catalog_activity_types(
    status: ImplementationStatus | None = Query(default=None),
    catalog: ActivityCatalog = Depends(get_activity_catalog),
):
    return catalog.list(status=status)


@router.get("/schema/method/{method_id}")
def schema_method(method_id: str, engine: GHGEngine = Depends(get_engine)):
    try:
        return engine.method_schema(method_id).model_dump()
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/schema/activity/{activity_type_id}", response_model=ActivitySchemaResponse)
def schema_activity(activity_type_id: str, catalog: ActivityCatalog = Depends(get_activity_catalog)):
    try:
        activity = catalog.get_required(activity_type_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ActivitySchemaResponse(
        activity_type_id=activity.activity_type_id,
        source_id=activity.source_id,
        label=activity.label,
        scope=activity.scope,
        protocol_category_code=activity.protocol_category_code,
        protocol_category_label=activity.protocol_category_label,
        implementation_status=activity.implementation_status,
        method_id=activity.method_id,
        input_schema=activity.input_schema,
        accounting_metadata=activity.accounting_metadata,
        ui_metadata=activity.ui_metadata,
    )
