from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from ghg_engine.domain import CanonicalFactorRecord

if TYPE_CHECKING:
    from ghg_engine.factors import FactorQuery

_CONFIDENCE_MAP = {"high": 3.0, "moderate": 2.0, "medium": 2.0, "low": 1.0}
_COUNTRY_ALIASES: dict[str, str] = {"us": "usa", "united states": "usa", "uk": "gbr", "united kingdom": "gbr"}


class FactorSelectionService:
    def candidates(self, records: list[CanonicalFactorRecord], q: FactorQuery) -> list[CanonicalFactorRecord]:
        filtered = [record for record in records if self._matches_filter(record, q)]
        if not filtered:
            return []
        return self._prefer_most_recent_year(filtered, q)

    def select_best(
        self,
        records: list[CanonicalFactorRecord],
        q: FactorQuery,
        *,
        trace: list[str] | None = None,
        trace_prefix: str = "factor select",
    ) -> CanonicalFactorRecord | None:
        if not records:
            if trace is not None:
                trace.append(f"{trace_prefix}: 0 coarse candidates")
            return None

        filtered = self.candidates(records, q)
        if not filtered:
            if trace is not None:
                trace.append(f"{trace_prefix}: no candidates after filtering")
            return None

        scored: list[tuple[tuple[float, ...], CanonicalFactorRecord]] = []
        for record in filtered:
            geo_score = self._geo_score(record, q)
            if geo_score < 0:
                continue
            row_source = str(record.source_entity_short or record.factor_source or "").lower()
            user_pref = 1000.0 if (q.allow_user_factors and row_source == "user") else 0.0
            unit_score = float(self._unit_preference_score(record, q))
            priority = float(record.priority or 0.0)
            confidence = self._confidence_score(record)
            data_year = float(record.data_year) if record.data_year is not None else -1.0
            last_updated_ord = float(record.last_updated.toordinal()) if record.last_updated else -1.0
            updated_at_ord = float(record.updated_at.toordinal()) if record.updated_at else -1.0
            sort_key = (
                user_pref + geo_score + unit_score + (priority / 100.0),
                geo_score,
                unit_score,
                priority,
                confidence,
                data_year,
                max(last_updated_ord, updated_at_ord),
            )
            scored.append((sort_key, record))

        if not scored:
            if trace is not None:
                trace.append(f"{trace_prefix}: no candidates after geography rules")
            return None

        scored.sort(key=lambda item: item[0], reverse=True)
        chosen = scored[0][1]
        if trace is not None:
            trace.append(
                f"{trace_prefix}: candidates={len(filtered)} chosen={chosen.factor_id} "
                f"score={scored[0][0][0]:.2f} geo={scored[0][0][1]:.0f} unit={scored[0][0][2]:.0f}"
            )
        return chosen

    def _matches_filter(self, record: CanonicalFactorRecord, q: FactorQuery) -> bool:
        if q.description is not None and record.description != q.description:
            return False
        if q.life_cycle_stage is not None and record.life_cycle_stage != q.life_cycle_stage:
            return False
        if q.greenhouse_gas is not None and record.greenhouse_gas != q.greenhouse_gas:
            return False
        if q.accounting_method != "none" and record.accounting_method != q.accounting_method:
            return False
        if record.factor_role not in (None, q.role):
            return False
        return self._valid_for_period(record, q)

    def _valid_for_period(self, record: CanonicalFactorRecord, q: FactorQuery) -> bool:
        start, end = q.resolved_period()
        if start is None and end is None:
            return True
        if record.valid_from is not None or record.valid_to is not None:
            if record.valid_from is not None and end is not None and record.valid_from > end:
                return False
            if record.valid_to is not None and start is not None and record.valid_to < start:
                return False
            return True
        if record.data_year is not None and q.inventory_year is not None:
            return record.data_year <= q.inventory_year
        return True

    def _prefer_most_recent_year(
        self,
        records: list[CanonicalFactorRecord],
        q: FactorQuery,
    ) -> list[CanonicalFactorRecord]:
        if q.inventory_year is None:
            return records
        years = [record.data_year for record in records if record.data_year is not None]
        if not years:
            return records
        best_year = max(years)
        return [record for record in records if record.data_year is None or record.data_year == best_year]

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

    def _geo_score(self, record: CanonicalFactorRecord, q: FactorQuery) -> int:
        query_geo = {
            "egrid_subregion": q.geo.egrid_subregion,
            "state": q.geo.state,
            "country": q.geo.country,
            "region": q.geo.region,
        }
        row_geo = {
            "egrid_subregion": record.egrid_subregion,
            "state": record.state,
            "country": record.country,
            "region": record.region,
        }
        score = 0
        for field, field_score in [("egrid_subregion", 40), ("state", 30), ("country", 20), ("region", 10)]:
            rv = row_geo[field]
            if rv is None:
                continue
            qv = query_geo[field]
            if qv is None:
                if field in {"egrid_subregion", "state"}:
                    return -1
                continue
            if self._normalize_geo(field, rv) != self._normalize_geo(field, qv):
                return -1
            score = max(score, field_score)
        if q.allow_fallback_geography is False:
            target = self._most_specific_query_geo_field(q)
            if target is not None:
                rv = row_geo[target]
                if rv is None or self._normalize_geo(target, rv) != self._normalize_geo(target, query_geo[target]):
                    return -1
        if score == 0 and record.geography_global:
            return 0
        return score

    def _normalize_geo(self, field: str, value: str | None) -> str | None:
        if value is None:
            return None
        token = str(value).strip()
        if field != "country":
            return token
        lower = token.lower()
        return _COUNTRY_ALIASES.get(lower, lower)

    def _normalize_unit(self, raw: str) -> str:
        alias = {
            "gallons": "gal",
            "gallon": "gal",
            "gal": "gal",
            "kwh": "kwh",
            "kilowatt_hour": "kwh",
            "mwh": "mwh",
            "mmbtu": "mmbtu",
            "scf": "scf",
        }
        token = raw.strip().lower().replace(" ", "_")
        return alias.get(token, token)

    def _unit_preference_score(self, record: CanonicalFactorRecord, q: FactorQuery) -> int:
        if not q.preferred_denominator_units:
            return 0
        denom = record.unit_2
        if not denom:
            unit = record.unit_label or record.unit
            if "/" in unit:
                denom = unit.split("/", 1)[1].strip()
        if not denom:
            return 0
        norm = self._normalize_unit(denom)
        preferred = {self._normalize_unit(unit) for unit in q.preferred_denominator_units}
        return 5 if norm in preferred else 0

    def _confidence_score(self, record: CanonicalFactorRecord) -> float:
        if record.confidence is not None:
            return float(record.confidence)
        level = str(record.confidence_level or "").strip().lower()
        if not level:
            return 0.0
        return _CONFIDENCE_MAP.get(level, 0.0)
