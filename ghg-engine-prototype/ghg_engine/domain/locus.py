from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Geography(BaseModel):
    region: str | None = None
    country: str | None = None
    state: str | None = None
    grid_region: str | None = None


class OperationalLocus(BaseModel):
    locus_id: str
    kind: Literal["facility", "asset"] = "facility"
    parent_locus_id: str | None = None
    name: str
    geography: Geography = Field(default_factory=Geography)
    ownership_mode: str | None = None
    reporting_group: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
