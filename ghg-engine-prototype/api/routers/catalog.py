from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_activity_catalog, get_engine, get_factors
from api.schemas import ActivityTypeResponse
from ghg_engine.activity_catalog import ActivityCatalog, ImplementationStatus
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository

router = APIRouter()


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
