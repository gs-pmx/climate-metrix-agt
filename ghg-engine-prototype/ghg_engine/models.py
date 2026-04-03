from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

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


class ActivityRecord(BaseModel):
    facility_id: str
    source_id: str | None = None
    source_type: str
    scope: Scope
    metric_group: str
    metric_subgroup: str | None = None
    is_biogenic: bool = False
    activity: Quantity
    params: dict[str, Any] = Field(default_factory=dict)
    period_start: datetime | None = None
    period_end: datetime | None = None
    timestamp: datetime | None = None
    duration: timedelta | None = None

    @model_validator(mode="after")
    def validate_time_inputs(self) -> ActivityRecord:
        has_period = self.period_start is not None or self.period_end is not None
        has_timestamp = self.timestamp is not None
        if has_period and has_timestamp:
            raise ValueError("use either period_start/period_end or timestamp/duration")
        if self.period_start and self.period_end and self.period_end < self.period_start:
            raise ValueError("period_end must be >= period_start")
        if self.timestamp and self.duration and self.duration.total_seconds() <= 0:
            raise ValueError("duration must be positive")
        return self


class CalculationContext(BaseModel):
    inventory_year: int | None = None
    inventory_period: InventoryPeriod | None = None
    gwp_set: GwpSetName = "AR6"
    include_trace: bool = False
    source_attributes: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_period_or_year(self) -> CalculationContext:
        if self.inventory_year is None and self.inventory_period is None:
            raise ValueError("provide either inventory_year or inventory_period")
        if self.inventory_year is not None and self.inventory_period is not None:
            raise ValueError("provide inventory_year or inventory_period, not both")
        return self


class RoutingRow(BaseModel):
    source_id: str
    label: str
    source_type: str
    scope: Scope
    metric_group: str
    metric_subgroup: str | None = None
    is_biogenic: bool = False
    default_unit: str
    method_id: str
    emission_category: str
    factor_description: str | None = None


class GeoContext(BaseModel):
    region: str | None = None
    country: str | None = None
    state: str | None = None
    egrid_subregion: str | None = None


class EmissionFactorRow(BaseModel):
    factor_id: str | None = None
    emission_category: str
    type: str
    life_cycle_stage: str | None = None
    description: str
    attribute: str
    gas: str | None = None
    greenhouse_gas: str | None = None
    value: float
    unit: str
    unit_label: str | None = None
    unit_1: str | None = None
    unit_2: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    geography_global: bool = False
    region: str | None = None
    country: str | None = None
    state: str | None = None
    egrid_subregion: str | None = None
    source_entity_short: str | None = None
    factor_source: str | None = None
    data_year: int | None = None
    confidence: float | None = None
    confidence_level: str | None = None
    priority: int | None = None
    updated_at: datetime | None = None
    last_updated: date | None = None
    accounting_method: AccountingMethod = "none"


class TraceRecord(BaseModel):
    selected_method: str
    factor_matches: list[str] = Field(default_factory=list)
    conversions: list[str] = Field(default_factory=list)
    defaults_applied: list[str] = Field(default_factory=list)
    intermediate_quantities: dict[str, float] = Field(default_factory=dict)


class ResultRecord(BaseModel):
    facility_id: str
    source_id: str | None = None
    scope: Scope
    accounting_method: AccountingMethod
    gas: str
    value: float
    unit: str
    is_biogenic: bool
    method_id: str
    factor_ids: list[str] = Field(default_factory=list)
    time_bucket: str | None = None


class MethodSchema(BaseModel):
    method_id: str
    version: str
    required_params: dict[str, Any]
