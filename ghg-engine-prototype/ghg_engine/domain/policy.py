from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, model_validator

from .common import InventoryPeriod

GwpSetName = Literal["AR6", "AR5"]


class InventoryPolicy(BaseModel):
    inventory_year: int | None = None
    inventory_period: InventoryPeriod | None = None
    gwp_set: GwpSetName = "AR6"
    include_trace: bool = False
    scope2_reporting: Literal["dual", "location_only", "market_only"] = "dual"
    allow_proxy_factors: bool = True

    @model_validator(mode="after")
    def validate_period_or_year(self) -> InventoryPolicy:
        if self.inventory_year is None and self.inventory_period is None:
            raise ValueError("provide either inventory_year or inventory_period")
        if self.inventory_year is not None and self.inventory_period is not None:
            raise ValueError("provide inventory_year or inventory_period, not both")
        return self
