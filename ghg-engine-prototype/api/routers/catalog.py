from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_activity_catalog, get_engine, get_factors
from api.dto import (
    ActivityTypeDTO,
    FactorPreviewDTO,
    MethodSchemaDTO,
    activity_type_to_dto,
    factor_preview_to_dto,
    method_schema_to_dto,
)
from ghg_engine.activity_catalog import ActivityCatalog, ImplementationStatus
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository

router = APIRouter()


@router.get("/catalog/factors/preview", response_model=list[FactorPreviewDTO])
def catalog_factors_preview(
    query: str | None = Query(default=None),
    factors: FactorRepository = Depends(get_factors),
) -> list[FactorPreviewDTO]:
    rows = factors.preview(query)
    return [factor_preview_to_dto(row) for row in rows]


@router.get("/catalog/activity-types", response_model=list[ActivityTypeDTO])
def catalog_activity_types(
    status: ImplementationStatus | None = Query(default=None),
    catalog: ActivityCatalog = Depends(get_activity_catalog),
) -> list[ActivityTypeDTO]:
    return [activity_type_to_dto(row) for row in catalog.list(status=status)]


@router.get("/schema/method/{method_id}", response_model=MethodSchemaDTO)
def schema_method(method_id: str, engine: GHGEngine = Depends(get_engine)) -> MethodSchemaDTO:
    try:
        return method_schema_to_dto(engine.method_schema(method_id))
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
