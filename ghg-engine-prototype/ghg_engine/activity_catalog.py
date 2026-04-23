from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from .domain import ActivityObservation
from .models import AccountingMethod, Scope

ImplementationStatus = Literal["implemented", "partial", "planned", "deferred"]
InputKind = Literal["quantity", "number", "enum", "string", "boolean"]
RUNTIME_METHODS = {
    "direct_factor",
    "scope2_energy",
    "distance_plus_efficiency",
    "freight_ton_mile",
    "passenger_distance",
    "refrigerant_mass_to_gwp",
    "waste_mass",
}


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

    def primary_field(self) -> ActivityInputField:
        for field in self.input_schema.fields:
            if field.is_primary:
                return field
        raise ValueError(f"activity_type_id '{self.activity_type_id}' is missing a primary input field")

    def allowed_primary_units(self) -> list[str]:
        primary = self.primary_field()
        units = primary.allowed_units or ([primary.default_unit] if primary.default_unit else [])
        return [unit for unit in units if unit]


class ActivityCatalog:
    def __init__(self, rows: list[ActivityTypeDefinition]):
        self.rows = rows
        self._by_activity_type_id: dict[str, ActivityTypeDefinition] = {}
        for row in rows:
            if row.activity_type_id in self._by_activity_type_id:
                raise ValueError(f"duplicate activity_type_id '{row.activity_type_id}'")
            self._by_activity_type_id[row.activity_type_id] = row
        self._validate_runtime_rows()

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

    def validate_activity(self, activity_def: ActivityTypeDefinition, observation: ActivityObservation) -> None:
        allowed_units = set(activity_def.allowed_primary_units())
        if allowed_units and observation.quantity.unit not in allowed_units:
            raise ValueError(
                f"{activity_def.activity_type_id} activity unit '{observation.quantity.unit}' "
                f"is not one of {sorted(allowed_units)}"
            )
        for field in activity_def.input_schema.fields:
            if field.is_primary:
                continue
            key = field.param_key or field.field_id
            value = observation.params.get(key)
            if field.required and value in (None, ""):
                raise ValueError(f"{activity_def.activity_type_id} requires params.{key}")
            if value in (None, ""):
                continue
            self._validate_field_value(activity_def, field, key, value)

    def _validate_runtime_rows(self) -> None:
        for row in self.rows:
            if row.implementation_status not in {"implemented", "partial"}:
                continue
            errors: list[str] = []
            if not row.source_type:
                errors.append("source_type")
            if row.method_id in RUNTIME_METHODS and not row.emission_category:
                errors.append("emission_category")
            if row.method_id in {
                "direct_factor",
                "scope2_energy",
                "freight_ton_mile",
                "passenger_distance",
                "waste_mass",
                "refrigerant_mass_to_gwp",
            } and not row.factor_query_templates:
                errors.append("factor_query_templates")
            if row.method_id == "distance_plus_efficiency":
                param_keys = {field.param_key or field.field_id for field in row.input_schema.fields}
                if "mpg" not in param_keys:
                    errors.append("input_schema.params.mpg")
            if row.method_id == "waste_mass":
                param_keys = {field.param_key or field.field_id for field in row.input_schema.fields}
                if "disposal_method" not in param_keys:
                    errors.append("input_schema.params.disposal_method")
            if row.method_id == "refrigerant_mass_to_gwp":
                param_keys = {field.param_key or field.field_id for field in row.input_schema.fields}
                if "refrigerant_type" not in param_keys:
                    errors.append("input_schema.params.refrigerant_type")
            if row.implementation_status == "partial" and not row.accounting_metadata.get("partial_reason"):
                errors.append("accounting_metadata.partial_reason")
            row.primary_field()
            if errors:
                raise ValueError(
                    f"activity_type_id '{row.activity_type_id}' is {row.implementation_status} "
                    f"but missing runtime fields: {', '.join(errors)}"
                )

    def _validate_field_value(
        self,
        activity_def: ActivityTypeDefinition,
        field: ActivityInputField,
        key: str,
        value: Any,
    ) -> None:
        prefix = f"{activity_def.activity_type_id} params.{key}"
        if field.kind == "number":
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{prefix} must be numeric") from exc
            if number <= 0:
                raise ValueError(f"{prefix} must be > 0")
            return
        if field.kind == "enum":
            if str(value) not in field.options:
                raise ValueError(f"{prefix} must be one of {field.options}")
            return
        if field.kind == "boolean":
            if not isinstance(value, bool):
                raise ValueError(f"{prefix} must be boolean")
            return
        if field.kind == "string":
            if not isinstance(value, str):
                raise ValueError(f"{prefix} must be a string")
            return
        if field.kind == "quantity":
            if not isinstance(value, dict):
                raise ValueError(f"{prefix} must be an object with value and unit")
            qty = value.get("value")
            unit = value.get("unit")
            try:
                float(qty)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{prefix}.value must be numeric") from exc
            if field.allowed_units and unit not in field.allowed_units:
                raise ValueError(f"{prefix}.unit must be one of {field.allowed_units}")
