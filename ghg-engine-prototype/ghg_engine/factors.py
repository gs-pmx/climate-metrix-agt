from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from hashlib import sha1

import pandas as pd
from pydantic import BaseModel, Field

from .models import AccountingMethod, EmissionFactorRow, FactorRole, GeoContext

_CONFIDENCE_MAP = {"high": 3, "moderate": 2, "medium": 2, "low": 1}


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

    def _valid_for_period(self, row: pd.Series, q: FactorQuery) -> bool:
        start, end = q.resolved_period()
        if start is None and end is None:
            return True
        valid_from = row.get("valid_from")
        valid_to = row.get("valid_to")
        if pd.notna(valid_from) or pd.notna(valid_to):
            if pd.notna(valid_from) and end is not None and valid_from > end:
                return False
            if pd.notna(valid_to) and start is not None and valid_to < start:
                return False
            return True
        data_year = row.get("data_year")
        if pd.notna(data_year) and q.inventory_year is not None:
            return int(data_year) <= q.inventory_year
        return True

    def _most_specific_query_geo_field(self, q: FactorQuery) -> str | None:
        if q.geo.egrid_subregion:
            return "egrid_subregion"
        if q.geo.state:
            return "state"
        if q.geo.country:
            return "country"
        if q.geo.region:
            return "region"
        return None

    def _geo_score(self, row: pd.Series, q: FactorQuery) -> int:
        query_geo = {
            "egrid_subregion": q.geo.egrid_subregion,
            "state": q.geo.state,
            "country": q.geo.country,
            "region": q.geo.region,
        }
        row_geo = {
            "egrid_subregion": row.get("egrid_subregion"),
            "state": row.get("state"),
            "country": row.get("country"),
            "region": row.get("region"),
        }
        score = 0
        for field, field_score in [("egrid_subregion", 40), ("state", 30), ("country", 20), ("region", 10)]:
            rv = row_geo[field]
            if pd.isna(rv):
                continue
            qv = query_geo[field]
            if qv is None or str(rv) != qv:
                return -1
            score = max(score, field_score)
        if q.allow_fallback_geography is False:
            target = self._most_specific_query_geo_field(q)
            if target is not None:
                rv = row_geo[target]
                if pd.isna(rv) or str(rv) != str(query_geo[target]):
                    return -1
        if score == 0 and bool(row.get("geography_global", False)):
            return 0
        return score

    def _normalize_unit(self, raw: str) -> str:
        alias = {
            "gallons": "gal",
            "gallon": "gal",
            "gal": "gal",
            "kwh": "kwh",
            "kilowatt_hour": "kwh",
            "mmbtu": "mmbtu",
            "scf": "scf",
        }
        token = raw.strip().lower().replace(" ", "_")
        return alias.get(token, token)

    def _unit_preference_score(self, row: pd.Series, q: FactorQuery) -> int:
        if not q.preferred_denominator_units:
            return 0
        unit = str(row.get("unit") or row.get("unit_label") or "")
        if "/" not in unit:
            return 0
        denom = self._normalize_unit(unit.split("/")[1])
        preferred = {self._normalize_unit(x) for x in q.preferred_denominator_units}
        return 5 if denom in preferred else 0

    def _confidence_score(self, row: pd.Series) -> float:
        level = str(row.get("confidence_level") or "").strip().lower()
        if level:
            return float(_CONFIDENCE_MAP.get(level, 0))
        confidence = row.get("confidence")
        if pd.notna(confidence):
            return float(confidence)
        return 0.0

    def _to_model(self, row: pd.Series) -> EmissionFactorRow:
        data = row.to_dict()
        cleaned = {k: (None if pd.isna(v) else v) for k, v in data.items()}
        cleaned["factor_id"] = self._derive_factor_id(cleaned)
        if cleaned.get("gas") is None and cleaned.get("greenhouse_gas") is not None:
            cleaned["gas"] = cleaned["greenhouse_gas"]
        if cleaned.get("greenhouse_gas") is None and cleaned.get("gas") is not None:
            cleaned["greenhouse_gas"] = cleaned["gas"]
        if cleaned.get("unit") is None and cleaned.get("unit_label") is not None:
            cleaned["unit"] = cleaned["unit_label"]
        if cleaned.get("unit_label") is None and cleaned.get("unit") is not None:
            cleaned["unit_label"] = cleaned["unit"]
        cleaned["accounting_method"] = cleaned.get("accounting_method") or "none"
        if cleaned.get("factor_source") is None and cleaned.get("source_entity_short") is not None:
            cleaned["factor_source"] = cleaned["source_entity_short"]
        if cleaned.get("source_entity_short") is None and cleaned.get("factor_source") is not None:
            cleaned["source_entity_short"] = cleaned["factor_source"]
        if cleaned.get("unit") and "/" in str(cleaned["unit"]):
            numerator, denominator = str(cleaned["unit"]).split("/", 1)
            cleaned["unit_1"] = cleaned.get("unit_1") or numerator.strip()
            cleaned["unit_2"] = cleaned.get("unit_2") or denominator.strip()
        return EmissionFactorRow(**cleaned)

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        idx = self._by_factor_id.get(str(factor_id))
        if idx is None:
            return None
        row = self.df.loc[idx]
        return self._to_model(row)

    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        base = self._coarse_rows(q)
        if base.empty:
            return []
        rows = base.copy()
        if q.description is not None:
            rows = rows[rows["description"] == q.description]
        if q.life_cycle_stage is not None:
            rows = rows[rows["life_cycle_stage"] == q.life_cycle_stage]
        if q.greenhouse_gas is not None:
            rows = rows[rows["greenhouse_gas"] == q.greenhouse_gas]
        if q.accounting_method != "none":
            rows = rows[rows["accounting_method"] == q.accounting_method]
        if "factor_role" in rows.columns:
            rows = rows[(rows["factor_role"].isna()) | (rows["factor_role"] == q.role)]
        if rows.empty:
            return []
        rows = rows[rows.apply(lambda row: self._valid_for_period(row, q), axis=1)]
        if rows.empty:
            return []
        if q.inventory_year is not None and "data_year" in rows.columns:
            year_rows = rows[pd.notna(rows["data_year"])]
            if not year_rows.empty:
                best_year = int(year_rows["data_year"].max())
                rows = rows[(pd.isna(rows["data_year"])) | (rows["data_year"] == best_year)]
        return [self._to_model(row) for _, row in rows.iterrows()]

    def select_best(self, q: FactorQuery, *, trace: list[str] | None = None) -> EmissionFactorRow | None:
        base = self._coarse_rows(q)
        if base.empty:
            if trace is not None:
                trace.append("factor select: 0 coarse candidates")
            return None
        filtered = base.copy()
        if q.description is not None:
            filtered = filtered[filtered["description"] == q.description]
        if q.life_cycle_stage is not None:
            filtered = filtered[filtered["life_cycle_stage"] == q.life_cycle_stage]
        if q.greenhouse_gas is not None:
            filtered = filtered[filtered["greenhouse_gas"] == q.greenhouse_gas]
        if q.accounting_method != "none":
            filtered = filtered[filtered["accounting_method"] == q.accounting_method]
        filtered = filtered[filtered.apply(lambda row: self._valid_for_period(row, q), axis=1)]
        if filtered.empty:
            if trace is not None:
                trace.append("factor select: no candidates after filtering")
            return None
        scored: list[tuple[tuple[float, ...], pd.Series]] = []
        for _, row in filtered.iterrows():
            geo_score = self._geo_score(row, q)
            if geo_score < 0:
                continue
            row_source = str(row.get("source_entity_short", "")).lower()
            user_pref = 1000.0 if (q.allow_user_factors and row_source == "user") else 0.0
            unit_score = float(self._unit_preference_score(row, q))
            priority = float(row.get("priority")) if pd.notna(row.get("priority")) else 0.0
            confidence = self._confidence_score(row)
            data_year = float(row.get("data_year")) if pd.notna(row.get("data_year")) else -1.0
            last_updated = row.get("last_updated") or row.get("updated_at")
            last_updated_ord = -1.0
            if pd.notna(last_updated) and isinstance(last_updated, date):
                last_updated_ord = float(last_updated.toordinal())
            sort_key = (
                user_pref + geo_score + unit_score + (priority / 100.0),
                geo_score,
                unit_score,
                priority,
                confidence,
                data_year,
                last_updated_ord,
            )
            scored.append((sort_key, row))
        if not scored:
            if trace is not None:
                trace.append("factor select: no candidates after geography rules")
            return None
        scored.sort(key=lambda x: x[0], reverse=True)
        chosen = self._to_model(scored[0][1])
        if trace is not None:
            trace.append(
                f"factor select: candidates={len(filtered)} chosen={chosen.factor_id} "
                f"score={scored[0][0][0]:.2f} geo={scored[0][0][1]:.0f} unit={scored[0][0][2]:.0f}"
            )
        return chosen

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
            c
            for c in [
                "factor_id",
                "emission_category",
                "type",
                "description",
                "attribute",
                "gas",
                "unit",
                "factor_source",
            ]
            if c in df.columns
        ]
        return df[cols].head(100).to_dict(orient="records")
