from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException

from api.dependencies import get_engine, get_factors
from api.schemas import (
    CalculationAuditResponse,
    CalculationAuditRow,
    CalculationRequest,
    CalculationResponse,
)
from ghg_engine.audit import build_audit_rows
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ResultRecord, TraceRecord

router = APIRouter()


@router.post("/calculate", response_model=CalculationResponse)
def calculate(
    payload: CalculationRequest,
    engine: GHGEngine = Depends(get_engine),
):
    try:
        rows, summary, trace = engine.calculate(payload.activities, payload.context)
        return CalculationResponse(
            results=rows,
            summary=summary,
            trace=trace if payload.context.include_trace else None,
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/calculate/audit", response_model=CalculationAuditResponse)
def calculate_with_audit(
    payload: CalculationRequest,
    engine: GHGEngine = Depends(get_engine),
    factors: FactorRepository = Depends(get_factors),
):
    try:
        all_rows: list[ResultRecord] = []
        traces: list[TraceRecord] = []
        audit_rows: list[CalculationAuditRow] = []
        summary: dict[str, float] = defaultdict(float)
        for activity in payload.activities:
            rows, trace = engine.calculate_one(activity, payload.context)
            all_rows.extend(rows)
            traces.append(trace)
            for row in rows:
                key = f"{row.facility_id}|{row.scope}|{row.accounting_method}|{row.gas}|{row.unit}"
                summary[key] = float(summary.get(key, 0.0) + row.value)
            audit_rows.extend(
                CalculationAuditRow(**r) for r in build_audit_rows(activity, rows, trace, factors)
            )
        return CalculationAuditResponse(
            results=all_rows,
            summary=dict(summary),
            trace=traces if payload.context.include_trace else None,
            audit_rows=audit_rows,
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
