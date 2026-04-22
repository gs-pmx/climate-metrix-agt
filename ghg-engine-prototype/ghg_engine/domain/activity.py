from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .common import InventoryPeriod, Quantity


class ActivityObservation(BaseModel):
    activity_id: str
    locus_id: str
    activity_type_id: str
    quantity: Quantity
    params: dict[str, Any] = Field(default_factory=dict)
    period: InventoryPeriod | None = None
    timestamp: datetime | None = None
    duration_seconds: float | None = None
    source_kind: Literal["measured", "estimated", "manual", "imported"] = "manual"

    @model_validator(mode="after")
    def validate_time_inputs(self) -> ActivityObservation:
        if self.period is not None and self.timestamp is not None:
            raise ValueError("use either period or timestamp/duration")
        if self.duration_seconds is not None and self.duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")
        return self
