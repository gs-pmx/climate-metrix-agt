from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from api.dependencies import get_engine, get_factors
from api.schemas import (
    ActivityCalculationError,
    CalculationAuditResponse,
    CalculationAuditRow,
    CalculationRequest,
    CalculationResponse,
)
from ghg_engine.audit import build_audit_rows
from ghg_engine.engine import GHGEngine
from ghg_engine.factors import FactorRepository
from ghg_engine.models import ActivityRecord, ResultRecord, TraceRecord

router = APIRouter()


def _classify_exception(exc: Exception, activity: ActivityRecord) -> tuple[str, dict]:
    """Map an engine exception to an error_code and structured details.

    Returns (error_code, details). Keep classification conservative — fall back
    to validation_error when ambiguous and expose the original exception type
    in details for debuggability.
    """
    message = str(exc)
    details: dict = {"exception_type": type(exc).__name__}

    if isinstance(exc, KeyError):
        if "unknown activity_type_id" in message:
            return "unknown_activity_type", details
        return "validation_error", details

    if isinstance(exc, ValueError):
        # Unit validation messages from ActivityCatalog.validate_activity
        if "activity unit" in message and "is not one of" in message:
            return "invalid_unit", details
        if "requires params." in message:
            return "missing_required_param", details
        if (
            "must be numeric" in message
            or "must be > 0" in message
            or "must be one of" in message
            or "must be boolean" in message
            or "must be a string" in message
            or "must be an object with value and unit" in message
        ):
            return "invalid_param_value", details
        if "no factor" in message.lower() or "no heat-content factor matched" in message:
            return "factor_not_found", details
        if "no plugin registered" in message.lower() or "is not applicable" in message:
            return "calculation_error", details
        return "validation_error", details

    return "calculation_error", details


def _build_activity_error(
    index: int,
    activity: ActivityRecord | None,
    raw_payload: dict | None,
    exc: Exception,
) -> ActivityCalculationError:
    if activity is not None:
        activity_type_id = activity.activity_type_id
        facility_id = activity.facility_id
    else:
        activity_type_id = None
        facility_id = None
        if isinstance(raw_payload, dict):
            raw_type = raw_payload.get("activity_type_id")
            raw_facility = raw_payload.get("facility_id")
            activity_type_id = raw_type if isinstance(raw_type, str) else None
            facility_id = raw_facility if isinstance(raw_facility, str) else None

    if activity is not None:
        error_code, details = _classify_exception(exc, activity)
    else:
        error_code = "validation_error"
        details = {"exception_type": type(exc).__name__}

    return ActivityCalculationError(
        activity_index=index,
        activity_type_id=activity_type_id,
        facility_id=facility_id,
        error_code=error_code,
        message=str(exc),
        details=details,
    )


def _summary_key(row: ResultRecord) -> str:
    biogenic = "biogenic" if row.is_biogenic else "non_biogenic"
    return (
        f"{row.facility_id}|{row.scope}|{row.accounting_method}|{row.gas}|"
        f"{row.unit}|{biogenic}"
    )


def _total_failure_response(
    payload: dict,
    status_code: int = 400,
) -> JSONResponse:
    errors = payload.get("errors") or []
    detail_message = errors[0]["message"] if errors else "calculation failed"
    body = dict(payload)
    body["detail"] = detail_message
    return JSONResponse(status_code=status_code, content=body)


@router.post("/calculate", response_model=CalculationResponse)
def calculate(
    payload: CalculationRequest,
    engine: GHGEngine = Depends(get_engine),
):
    results: list[ResultRecord] = []
    traces: list[TraceRecord] = []
    errors: list[ActivityCalculationError] = []

    for index, activity in enumerate(payload.activities):
        try:
            rows, trace = engine.calculate_one(activity, payload.context)
        except Exception as exc:  # noqa: BLE001 - we classify and surface
            errors.append(_build_activity_error(index, activity, None, exc))
            continue
        results.extend(rows)
        traces.append(trace)

    summary: dict[str, float] = defaultdict(float)
    for row in results:
        summary[_summary_key(row)] = float(summary.get(_summary_key(row), 0.0) + row.value)

    partial_success = bool(errors) and bool(results)
    response = CalculationResponse(
        results=results,
        summary=dict(summary),
        trace=traces if payload.context.include_trace else None,
        errors=errors,
        partial_success=partial_success,
    )

    if errors and not results:
        return _total_failure_response(response.model_dump(mode="json"))
    return response


@router.post("/calculate/audit", response_model=CalculationAuditResponse)
def calculate_with_audit(
    payload: CalculationRequest,
    engine: GHGEngine = Depends(get_engine),
    factors: FactorRepository = Depends(get_factors),
):
    all_rows: list[ResultRecord] = []
    traces: list[TraceRecord] = []
    audit_rows: list[CalculationAuditRow] = []
    errors: list[ActivityCalculationError] = []
    summary: dict[str, float] = defaultdict(float)

    for index, activity in enumerate(payload.activities):
        try:
            rows, trace = engine.calculate_one(activity, payload.context)
            activity_def = engine.activity_catalog.get_required(activity.activity_type_id)
            activity_audit_rows = [
                CalculationAuditRow(**r)
                for r in build_audit_rows(activity, activity_def, rows, trace, factors)
            ]
        except Exception as exc:  # noqa: BLE001
            errors.append(_build_activity_error(index, activity, None, exc))
            continue

        all_rows.extend(rows)
        traces.append(trace)
        audit_rows.extend(activity_audit_rows)
        for row in rows:
            summary[_summary_key(row)] = float(
                summary.get(_summary_key(row), 0.0) + row.value
            )

    partial_success = bool(errors) and bool(all_rows)
    response = CalculationAuditResponse(
        results=all_rows,
        summary=dict(summary),
        trace=traces if payload.context.include_trace else None,
        errors=errors,
        partial_success=partial_success,
        audit_rows=audit_rows,
    )

    if errors and not all_rows:
        return _total_failure_response(response.model_dump(mode="json"))
    return response
