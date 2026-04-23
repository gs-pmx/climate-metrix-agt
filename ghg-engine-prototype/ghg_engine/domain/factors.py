from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from ghg_engine.domain.common import AccountingMethod, FactorRole


class CanonicalFactorRecord(BaseModel):
    factor_id: str
    emission_category: str
    type: str
    description: str | None = None
    attribute: str
    greenhouse_gas: str | None = None
    gas: str | None = None
    value: float
    unit: str
    unit_label: str | None = None
    unit_1: str | None = None
    unit_2: str | None = None
    life_cycle_stage: str | None = None
    geography_global: bool = False
    region: str | None = None
    country: str | None = None
    state: str | None = None
    egrid_subregion: str | None = None
    factor_source: str | None = None
    source_entity_short: str | None = None
    data_year: int | None = None
    priority: float | None = None
    confidence: float | None = None
    confidence_level: str | None = None
    updated_at: date | None = None
    last_updated: date | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    accounting_method: AccountingMethod = "none"
    factor_role: FactorRole | None = None
