from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from ghg_engine.domain.common import (
    AccountingMethod,
    FactorRole,
    GwpSetName,
    Scope,
)

__all__ = [
    "AccountingMethod",
    "FactorRole",
    "GwpSetName",
    "Scope",
    "ActivityDraft",
    "ActivityRecord",
    "AuditRecord",
    "CalculationContext",
    "DraftQuantity",
    "EmissionFactorRow",
    "FacilityDraft",
    "GeoContext",
    "InventoryPeriod",
    "MethodSchema",
    "ProjectSnapshot",
    "Quantity",
    "ResultRecord",
    "SNAPSHOT_VERSION",
    "SummaryRow",
    "TraceRecord",
]

SNAPSHOT_VERSION = 2


class Quantity(BaseModel):
    value: float
    unit: str


class DraftQuantity(BaseModel):
    value: float | None = None
    unit: str = ""


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
    activity_type_id: str
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
    activity_type_id: str | None = None
    activity_label: str | None = None
    selected_method: str
    factor_matches: list[str] = Field(default_factory=list)
    conversions: list[str] = Field(default_factory=list)
    defaults_applied: list[str] = Field(default_factory=list)
    intermediate_quantities: dict[str, float] = Field(default_factory=dict)


class ResultRecord(BaseModel):
    facility_id: str
    activity_type_id: str
    activity_label: str
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    activity_group: str | None = None
    source_type: str | None = None
    accounting_method: AccountingMethod
    gas: str
    value: float
    unit: str
    is_biogenic: bool
    method_id: str
    factor_ids: list[str] = Field(default_factory=list)
    time_bucket: str | None = None


class AuditRecord(BaseModel):
    facility_id: str
    activity_type_id: str
    activity_label: str
    source_type: str | None = None
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    activity_group: str | None = None
    metric_group: str
    metric_subgroup: str | None = None
    accounting_method: AccountingMethod
    input_activity_value: float
    input_activity_unit: str
    input_params: dict[str, Any] = Field(default_factory=dict)
    eqm_method: str
    eqm_description: str
    eqm_steps: list[str] = Field(default_factory=list)
    factor_selection_notes: list[str] = Field(default_factory=list)
    activity_conversion_notes: list[str] = Field(default_factory=list)
    factor_conversion_notes: list[str] = Field(default_factory=list)
    factor_ids: list[str] = Field(default_factory=list)
    factor_co2_id: str | None = None
    factor_co2_value: float | None = None
    factor_co2_unit: str | None = None
    factor_co2_source: str | None = None
    factor_co2_valid_from: str | None = None
    factor_co2_valid_to: str | None = None
    factor_ch4_id: str | None = None
    factor_ch4_value: float | None = None
    factor_ch4_unit: str | None = None
    factor_ch4_source: str | None = None
    factor_ch4_valid_from: str | None = None
    factor_ch4_valid_to: str | None = None
    factor_n2o_id: str | None = None
    factor_n2o_value: float | None = None
    factor_n2o_unit: str | None = None
    factor_n2o_source: str | None = None
    factor_n2o_valid_from: str | None = None
    factor_n2o_valid_to: str | None = None
    co2_result_kg: float | None = None
    ch4_result_kg: float | None = None
    n2o_result_kg: float | None = None
    co2e_result_kg: float | None = None


class ReportingUnitDraft(BaseModel):
    """The aggregation entity that owns emission sources.

    Internal terminology matches the product concept of "Reporting Unit".
    The ``name`` attribute still serializes and parses under the legacy
    alias ``facility_name`` so existing SQLite snapshots (stored as JSON
    blobs) load unchanged.

    ``applicable_activity_types`` is the Phase C2 source checklist. When
    non-empty, only those ``activity_type_id`` values are considered
    applicable to this Reporting Unit — the backend canonicalization
    layer filters anything else out of the inventory and calculation
    tables. An empty list preserves legacy behavior ("show all") so
    existing snapshots load and canonicalize unchanged without a
    schema migration.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str = Field(
        default="",
        validation_alias=AliasChoices("name", "facility_name"),
        serialization_alias="facility_name",
    )
    location: str = ""
    region: str = ""
    country: str = "US"
    state: str = ""
    egrid_subregion: str = ""
    reporting_group: str = ""
    owned_leased: str = "Owned"
    applicable_activity_types: list[str] = Field(default_factory=list)


# Backward-compat alias for callers that have not migrated yet. Retained
# so external imports of ``FacilityDraft`` keep working; new code should
# use ``ReportingUnitDraft`` directly.
FacilityDraft = ReportingUnitDraft


class ActivityDraft(BaseModel):
    id: str | None = None
    facility_id: str
    activity_type_id: str
    activity: DraftQuantity = Field(default_factory=DraftQuantity)
    params: dict[str, Any] = Field(default_factory=dict)
    period_start: datetime | None = None
    period_end: datetime | None = None
    timestamp: datetime | None = None
    duration: timedelta | None = None


class SummaryRow(BaseModel):
    key: str
    value: float


class ProjectSnapshot(BaseModel):
    """Typed envelope for a saved project version.

    The ``reporting_units`` attribute uses the current product
    terminology, but serializes and parses as the legacy ``facilities``
    key so existing SQLite snapshots and request bodies continue to load
    without migration. The on-the-wire JSON shape is unchanged.
    """

    model_config = ConfigDict(populate_by_name=True)

    snapshot_version: int = SNAPSHOT_VERSION
    reporting_units: list[ReportingUnitDraft] = Field(
        default_factory=list,
        validation_alias=AliasChoices("reporting_units", "facilities"),
        serialization_alias="facilities",
    )
    activities: list[ActivityDraft] = Field(default_factory=list)
    result_rows: list[ResultRecord] = Field(default_factory=list)
    summary_rows: list[SummaryRow] = Field(default_factory=list)
    trace_rows: list[TraceRecord] = Field(default_factory=list)
    audit_rows: list[AuditRecord] = Field(default_factory=list)

    @property
    def facilities(self) -> list[ReportingUnitDraft]:
        """Deprecated attribute name retained for backward compatibility.

        New code should read ``self.reporting_units`` directly.
        """

        return self.reporting_units

    @model_validator(mode="after")
    def validate_snapshot_version(self) -> ProjectSnapshot:
        if self.snapshot_version != SNAPSHOT_VERSION:
            raise ValueError(
                f"Unsupported snapshot_version {self.snapshot_version}. "
                f"Expected {SNAPSHOT_VERSION}."
            )
        return self


class MethodSchema(BaseModel):
    method_id: str
    version: str
    required_params: dict[str, Any]
