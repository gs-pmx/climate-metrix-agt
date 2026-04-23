from __future__ import annotations

from collections import defaultdict
from typing import Literal

from .domain import ActivityObservation
from .models import ResultRecord

Bucket = Literal["hour", "day", "month", "year"]


def observation_bucket(
    observation: ActivityObservation,
    default_year: int | None,
    bucket: Bucket = "year",
) -> str | None:
    if observation.period is not None:
        dt = observation.period.start
    else:
        dt = observation.timestamp
    if dt is None:
        return str(default_year) if default_year is not None else None
    if bucket == "hour":
        return dt.strftime("%Y-%m-%dT%H:00")
    if bucket == "day":
        return dt.strftime("%Y-%m-%d")
    if bucket == "month":
        return dt.strftime("%Y-%m")
    return dt.strftime("%Y")


def aggregate_results(records: list[ResultRecord], bucket: Bucket = "year") -> list[ResultRecord]:
    def rebucket(label: str) -> str:
        if not label:
            return ""
        if bucket == "year":
            return label[:4]
        if bucket == "month":
            return label[:7]
        if bucket == "day":
            return label[:10]
        return label[:13] + ":00"

    grouped: dict[tuple[str, str, str, str, str, str, str], float] = defaultdict(float)
    prototypes: dict[tuple[str, str, str, str, str, str, str], ResultRecord] = {}
    for row in records:
        bucket_key = rebucket(row.time_bucket or "")
        key = (
            row.facility_id,
            row.activity_type_id,
            row.scope,
            row.accounting_method,
            row.gas,
            row.unit,
            bucket_key,
        )
        grouped[key] += row.value
        prototypes[key] = row.model_copy(update={"time_bucket": bucket_key or None})
    out: list[ResultRecord] = []
    for key, value in grouped.items():
        proto = prototypes[key]
        out.append(proto.model_copy(update={"value": value}))
    return out
