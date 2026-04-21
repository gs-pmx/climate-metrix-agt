from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from .models import AccountingMethod, Scope

ImplementationStatus = Literal["implemented", "partial", "planned", "deferred"]
InputKind = Literal["quantity", "number", "enum", "string", "boolean"]


class ActivityInputField(BaseModel):
    field_id: str
    label: str
    kind: InputKind
    required: bool = True
    is_primary: bool = False
    default_unit: str | None = None
    allowed_units: list[str] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    param_key: str | None = None
    help_text: str | None = None

    @model_validator(mode="after")
    def validate_definition(self) -> ActivityInputField:
        if self.default_unit is not None and self.allowed_units and self.default_unit not in self.allowed_units:
            raise ValueError(f"default_unit '{self.default_unit}' must exist in allowed_units")
        if self.kind == "quantity" and not self.allowed_units and self.default_unit is None:
            raise ValueError("quantity inputs must declare default_unit or allowed_units")
        if self.kind != "quantity" and self.allowed_units:
            raise ValueError("only quantity inputs may declare allowed_units")
        if self.kind != "enum" and self.options:
            raise ValueError("only enum inputs may declare options")
        if self.is_primary and self.kind != "quantity":
            raise ValueError("primary input must be quantity-based")
        return self


class ActivityInputSchema(BaseModel):
    fields: list[ActivityInputField] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_primary_fields(self) -> ActivityInputSchema:
        primary_count = sum(1 for field in self.fields if field.is_primary)
        if self.fields and primary_count != 1:
            raise ValueError("activity input schema must define exactly one primary field")
        return self


class FactorQueryTemplate(BaseModel):
    domain: str
    type: str | None = None
    attributes: list[str] = Field(default_factory=list)
    description: str | None = None
    life_cycle_stage: str | None = None
    accounting_method: AccountingMethod | None = None
    geography_preference: str | None = None


class ActivityTypeDefinition(BaseModel):
    activity_type_id: str
    source_id: str
    legacy_source_ids: list[str] = Field(default_factory=list)
    workbook_aliases: list[str] = Field(default_factory=list)
    label: str
    description: str
    category: str
    scope: Scope
    protocol_category_code: str | None = None
    protocol_category_label: str | None = None
    source_type: str | None = None
    metric_group: str
    metric_subgroup: str | None = None
    is_biogenic_default: bool = False
    default_unit: str
    allowed_units: list[str] = Field(default_factory=list)
    method_id: str
    emission_category: str | None = None
    factor_description: str | None = None
    implementation_status: ImplementationStatus
    input_schema: ActivityInputSchema
    factor_query_templates: list[FactorQueryTemplate] = Field(default_factory=list)
    accounting_metadata: dict[str, Any] = Field(default_factory=dict)
    ui_metadata: dict[str, Any] = Field(default_factory=dict)
    audit_metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_units(self) -> ActivityTypeDefinition:
        if self.allowed_units and self.default_unit not in self.allowed_units:
            raise ValueError(f"default_unit '{self.default_unit}' must exist in allowed_units")
        return self


class ActivityCatalog:
    def __init__(self, rows: list[ActivityTypeDefinition]):
        self.rows = rows
        self._by_activity_type_id: dict[str, ActivityTypeDefinition] = {}
        self._by_source_id: dict[str, ActivityTypeDefinition] = {}
        for row in rows:
            if row.activity_type_id in self._by_activity_type_id:
                raise ValueError(f"duplicate activity_type_id '{row.activity_type_id}'")
            if row.source_id in self._by_source_id:
                raise ValueError(f"duplicate source_id '{row.source_id}'")
            self._by_activity_type_id[row.activity_type_id] = row
            self._by_source_id[row.source_id] = row

    @classmethod
    def from_json(cls, path: str | Path) -> ActivityCatalog:
        payload = Path(path).read_text(encoding="utf-8")
        rows = TypeAdapter(list[ActivityTypeDefinition]).validate_json(payload)
        return cls(rows)

    def list(self, *, status: ImplementationStatus | None = None) -> list[ActivityTypeDefinition]:
        if status is None:
            return list(self.rows)
        return [row for row in self.rows if row.implementation_status == status]

    def get(self, activity_type_id: str) -> ActivityTypeDefinition | None:
        return self._by_activity_type_id.get(activity_type_id)

    def get_required(self, activity_type_id: str) -> ActivityTypeDefinition:
        row = self.get(activity_type_id)
        if row is None:
            raise KeyError(f"unknown activity_type_id {activity_type_id}")
        return row

    def get_by_source_id(self, source_id: str) -> ActivityTypeDefinition | None:
        return self._by_source_id.get(source_id)

