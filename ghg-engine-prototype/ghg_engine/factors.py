from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from hashlib import sha1

import pandas as pd
from pydantic import BaseModel, Field

from .domain import CanonicalFactorRecord
from .models import AccountingMethod, EmissionFactorRow, FactorRole, GeoContext
from .services import FactorSelectionService


class FactorQuery(BaseModel):
    role: FactorRole = "emission_factor"
    emission_category: str
    type: str
    attribute: str
    greenhouse_gas: str | None = None
    description: str | None = None
    life_cycle_stage: str | None = None
    accounting_method: AccountingMethod = "none"
    geo: GeoContext = Field(default_factory=GeoContext)
    inventory_year: int | None = None
    period_start: date | None = None
    period_end: date | None = None
    preferred_denominator_units: Sequence[str] = ()
    allow_user_factors: bool = True
    allow_fallback_geography: bool = True

    def resolved_period(self) -> tuple[date | None, date | None]:
        if self.period_start is not None or self.period_end is not None:
            return self.period_start, self.period_end
        if self.inventory_year is not None:
            return date(self.inventory_year, 1, 1), date(self.inventory_year, 12, 31)
        return None, None


class FactorRepository:
    def __init__(self, df: pd.DataFrame):
        self.df = self._normalize_df(df)
        self._selector = FactorSelectionService()
        self._index: dict[tuple[str, str, str], list[int]] = {}
        self._by_factor_id: dict[str, int] = {}
        for i, row in self.df.iterrows():
            key = (
                str(row.get("emission_category", "")),
                str(row.get("type", "")),
                str(row.get("attribute", "")),
            )
            self._index.setdefault(key, []).append(i)
            factor_id = self._derive_factor_id(row.to_dict())
            self._by_factor_id[factor_id] = i

    @classmethod
    def from_csv(cls, path: str) -> FactorRepository:
        return cls(pd.read_csv(path))

    def _normalize_df(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out.columns = [str(c).strip().lower().replace("-", "_") for c in out.columns]
        rename_map = {
            "emissioncategory": "emission_category",
            "life_cycle-stage": "life_cycle_stage",
            "greenhousegas": "greenhouse_gas",
        }
        for src, dst in rename_map.items():
            if src in out.columns and dst not in out.columns:
                out = out.rename(columns={src: dst})
        if "gas" not in out.columns and "greenhouse_gas" in out.columns:
            out["gas"] = out["greenhouse_gas"]
        if "greenhouse_gas" not in out.columns and "gas" in out.columns:
            out["greenhouse_gas"] = out["gas"]
        if "unit" not in out.columns and "unit_label" in out.columns:
            out["unit"] = out["unit_label"]
        if "unit_label" not in out.columns and "unit" in out.columns:
            out["unit_label"] = out["unit"]
        if "updated_at" not in out.columns and "last_updated" in out.columns:
            out["updated_at"] = out["last_updated"]
        if "last_updated" not in out.columns and "updated_at" in out.columns:
            out["last_updated"] = out["updated_at"]
        if "factor_id" not in out.columns:
            out["factor_id"] = None
        if "factor_source" not in out.columns and "source_entity_short" in out.columns:
            out["factor_source"] = out["source_entity_short"]
        if "source_entity_short" not in out.columns and "factor_source" in out.columns:
            out["source_entity_short"] = out["factor_source"]
        for col in [
            "emission_category",
            "type",
            "description",
            "attribute",
            "life_cycle_stage",
            "greenhouse_gas",
            "gas",
            "unit",
            "unit_label",
            "region",
            "country",
            "state",
            "egrid_subregion",
            "confidence_level",
            "source_entity_short",
            "factor_source",
            "accounting_method",
            "factor_role",
            "valid_from",
            "valid_to",
            "last_updated",
            "updated_at",
        ]:
            if col not in out.columns:
                out[col] = None
        for col in ["valid_from", "valid_to", "last_updated", "updated_at"]:
            out[col] = pd.to_datetime(out[col], errors="coerce").dt.date
        if "data_year" in out.columns:
            out["data_year"] = pd.to_numeric(out["data_year"], errors="coerce")
        else:
            out["data_year"] = None
        if "priority" in out.columns:
            out["priority"] = pd.to_numeric(out["priority"], errors="coerce")
        else:
            out["priority"] = None
        if "confidence" in out.columns:
            out["confidence"] = pd.to_numeric(out["confidence"], errors="coerce")
        else:
            out["confidence"] = None
        if "value" in out.columns:
            out["value"] = pd.to_numeric(out["value"], errors="coerce")
        if "geography_global" in out.columns:
            out["geography_global"] = out["geography_global"].astype("boolean").fillna(False).astype(bool)
        else:
            out["geography_global"] = False
        out["accounting_method"] = out["accounting_method"].fillna("none")
        return out

    def _coarse_rows(self, q: FactorQuery) -> pd.DataFrame:
        key = (q.emission_category, q.type, q.attribute)
        idxs = self._index.get(key)
        if idxs is None:
            return self.df.iloc[0:0]
        return self.df.loc[idxs]

    def _derive_factor_id(self, row: dict[str, object]) -> str:
        if row.get("factor_id"):
            return str(row["factor_id"])
        payload = "|".join(
            str(row.get(k, ""))
            for k in ["emission_category", "type", "description", "attribute", "greenhouse_gas", "unit", "value"]
        )
        return f"derived_{sha1(payload.encode('utf-8')).hexdigest()[:12]}"

    def _canonical_from_row(self, row: pd.Series) -> CanonicalFactorRecord:
        data = row.to_dict()
        cleaned = {key: (None if pd.isna(value) else value) for key, value in data.items()}
        factor_id = self._derive_factor_id(cleaned)
        greenhouse_gas = cleaned.get("greenhouse_gas") or cleaned.get("gas")
        gas = cleaned.get("gas") or greenhouse_gas
        unit = cleaned.get("unit") or cleaned.get("unit_label")
        unit_label = cleaned.get("unit_label") or unit
        unit_1 = cleaned.get("unit_1")
        unit_2 = cleaned.get("unit_2")
        if unit and "/" in str(unit):
            numerator, denominator = str(unit).split("/", 1)
            unit_1 = unit_1 or numerator.strip()
            unit_2 = unit_2 or denominator.strip()
        attribute = str(cleaned.get("attribute") or "")
        factor_role = cleaned.get("factor_role")
        if factor_role is None:
            factor_role = "heat_content" if attribute == "heat_content" else "emission_factor"
        return CanonicalFactorRecord(
            factor_id=factor_id,
            emission_category=str(cleaned.get("emission_category") or ""),
            type=str(cleaned.get("type") or ""),
            description=cleaned.get("description"),
            attribute=attribute,
            greenhouse_gas=greenhouse_gas,
            gas=gas,
            value=float(cleaned.get("value")),
            unit=str(unit),
            unit_label=unit_label,
            unit_1=unit_1,
            unit_2=unit_2,
            life_cycle_stage=cleaned.get("life_cycle_stage"),
            geography_global=bool(cleaned.get("geography_global", False)),
            region=cleaned.get("region"),
            country=cleaned.get("country"),
            state=cleaned.get("state"),
            egrid_subregion=cleaned.get("egrid_subregion"),
            factor_source=cleaned.get("factor_source"),
            source_entity_short=cleaned.get("source_entity_short"),
            data_year=int(cleaned["data_year"]) if cleaned.get("data_year") is not None else None,
            priority=float(cleaned["priority"]) if cleaned.get("priority") is not None else None,
            confidence=float(cleaned["confidence"]) if cleaned.get("confidence") is not None else None,
            confidence_level=cleaned.get("confidence_level"),
            updated_at=cleaned.get("updated_at"),
            last_updated=cleaned.get("last_updated"),
            valid_from=cleaned.get("valid_from"),
            valid_to=cleaned.get("valid_to"),
            accounting_method=cleaned.get("accounting_method") or "none",
            factor_role=factor_role,
        )

    @staticmethod
    def _model_from_canonical(record: CanonicalFactorRecord) -> EmissionFactorRow:
        return EmissionFactorRow(
            factor_id=record.factor_id,
            emission_category=record.emission_category,
            type=record.type,
            life_cycle_stage=record.life_cycle_stage,
            description=record.description or "",
            attribute=record.attribute,
            gas=record.gas,
            greenhouse_gas=record.greenhouse_gas,
            value=record.value,
            unit=record.unit,
            unit_label=record.unit_label,
            unit_1=record.unit_1,
            unit_2=record.unit_2,
            valid_from=record.valid_from,
            valid_to=record.valid_to,
            geography_global=record.geography_global,
            region=record.region,
            country=record.country,
            state=record.state,
            egrid_subregion=record.egrid_subregion,
            source_entity_short=record.source_entity_short,
            factor_source=record.factor_source,
            data_year=record.data_year,
            confidence=record.confidence,
            confidence_level=record.confidence_level,
            priority=record.priority,
            updated_at=record.updated_at,
            last_updated=record.last_updated,
            accounting_method=record.accounting_method,
        )

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        idx = self._by_factor_id.get(str(factor_id))
        if idx is None:
            return None
        row = self.df.loc[idx]
        return self._model_from_canonical(self._canonical_from_row(row))

    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        base = self._coarse_rows(q)
        if base.empty:
            return []
        records = [self._canonical_from_row(row) for _, row in base.iterrows()]
        return [self._model_from_canonical(record) for record in self._selector.candidates(records, q)]

    def select_best(self, q: FactorQuery, *, trace: list[str] | None = None) -> EmissionFactorRow | None:
        base = self._coarse_rows(q)
        if base.empty:
            if trace is not None:
                trace.append("factor select: 0 coarse candidates")
            return None
        records = [self._canonical_from_row(row) for _, row in base.iterrows()]
        chosen = self._selector.select_best(records, q, trace=trace, trace_prefix="factor select")
        if chosen is None:
            return None
        return self._model_from_canonical(chosen)

    def find(self, q: FactorQuery) -> list[EmissionFactorRow]:
        return self.candidates(q)

    def select(self, q: FactorQuery) -> EmissionFactorRow | None:
        return self.select_best(q)

    def preview(self, query_text: str | None = None) -> list[dict[str, str]]:
        df = self.df
        if query_text:
            needle = query_text.lower()
            mask = df.apply(lambda col: col.astype(str).str.lower().str.contains(needle, na=False))
            df = df[mask.any(axis=1)]
        cols = [
            col
            for col in [
                "factor_id",
                "emission_category",
                "type",
                "description",
                "attribute",
                "gas",
                "unit",
                "factor_source",
            ]
            if col in df.columns
        ]
        return df[cols].head(100).to_dict(orient="records")
