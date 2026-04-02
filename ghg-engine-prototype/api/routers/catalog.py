from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import get_engine, get_factors, get_routing
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


@router.get("/schema/method/{method_id}")
def schema_method(method_id: str, engine: GHGEngine = Depends(get_engine)):
    try:
        return engine.method_schema(method_id).model_dump()
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
