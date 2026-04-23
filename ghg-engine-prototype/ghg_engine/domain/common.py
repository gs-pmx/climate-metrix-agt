from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, model_validator

Scope = Literal["Scope 1", "Scope 2", "Scope 3"]
AccountingMethod = Literal["location_based", "market_based", "none"]
FactorRole = Literal["emission_factor", "heat_content", "other"]
GwpSetName = Literal["AR6", "AR5"]


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
