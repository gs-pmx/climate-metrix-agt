from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, model_validator


class Quantity(BaseModel):
    value: float
    unit: str


class InventoryPeriod(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_bounds(self) -> InventoryPeriod:
        if self.end < self.start:
            raise ValueError("inventory period end must be >= start")
        return self
