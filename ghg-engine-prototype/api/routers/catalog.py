from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import (
    get_activity_catalog,
    get_engine,
    get_factors,
    get_project_store,
)
from api.dto import (
    ActivityTypeDTO,
    FactorPreviewDTO,
    FactorSourceCoverageDTO,
    MethodSchemaDTO,
    SpendFactorDTO,
    activity_type_to_dto,
    factor_preview_to_dto,
    factor_source_coverage_to_dto,
    method_schema_to_dto,
    spend_factor_to_dto,
)
from ghg_engine.activity_catalog import ActivityCatalog, ImplementationStatus
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from project_store import ProjectStore

router = APIRouter()


@router.get("/catalog/factors/preview", response_model=list[FactorPreviewDTO])
def catalog_factors_preview(
    query: str | None = Query(default=None),
    factors: FactorRepository = Depends(get_factors),
) -> list[FactorPreviewDTO]:
    rows = factors.preview(query)
    return [factor_preview_to_dto(row) for row in rows]


@router.get("/catalog/factor-source-coverage", response_model=list[FactorSourceCoverageDTO])
def catalog_factor_source_coverage(
    catalog: ActivityCatalog = Depends(get_activity_catalog),
    store: ProjectStore = Depends(get_project_store),
) -> list[FactorSourceCoverageDTO]:
    rows = store.factor_source_coverage(catalog.list())
    return [factor_source_coverage_to_dto(row) for row in rows]


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


@router.get("/catalog/spend-factors", response_model=list[SpendFactorDTO])
def catalog_spend_factors(
    dataset_id: str | None = Query(default=None),
    query: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    store: ProjectStore = Depends(get_project_store),
) -> list[SpendFactorDTO]:
    """Browse spend-based factors for the GL-mapping editor.

    Filter by ``dataset_id`` (e.g. ``useeio_v1_4_0`` or
    ``exiobase_3_8_2_pxp_2022``) to scope results to a single EEIO
    dataset; ``query`` is a substring-match against record key,
    description, region/country, and source. Defaults to the first 200
    rows of the active spend dataset(s).
    """

    rows = store.list_spend_factors(dataset_id=dataset_id, query=query, limit=limit)
    return [spend_factor_to_dto(row) for row in rows]
