"""Document-based FactorRepository backed by nested JSON emission factor documents."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from datetime import date
from pathlib import Path

from .factors import FactorQuery, FactorRepository
from .models import EmissionFactorRow

# Maps the current routing catalog's emission_category values to new document domain values.
_CATEGORY_TO_DOMAIN: dict[str, str] = {
    "mobile-combustion": "combustion",
    "stationary-energy": "combustion",
    "purchased-electricity": "electricity-generation",
    "purchased-steam": "combustion",
}

# Current system uses underscores (co2_ef), documents use hyphens (co2-ef).
_ATTR_TO_DOC = str.maketrans("_", "-")
_ATTR_FROM_DOC = str.maketrans("-", "_")

_GEO_SPEC_SCORE: dict[str, int] = {
    "site": 50,
    "subregion": 40,
    "state": 30,
    "national": 20,
    "regional": 10,
    "global": 0,
}

_CONFIDENCE_MAP: dict[str, float] = {"high": 3.0, "moderate": 2.0, "medium": 2.0, "low": 1.0}

# Normalize common country code variants to a canonical form for matching.
_COUNTRY_ALIASES: dict[str, str] = {"us": "usa", "united states": "usa", "uk": "gbr", "united kingdom": "gbr"}


def _get(doc: dict, *keys: str, default=None):
    """Safely traverse nested dict keys."""
    node = doc
    for k in keys:
        if not isinstance(node, dict):
            return default
        node = node.get(k, default)
    return node


class DocumentFactorRepository:
    """Emission factor repository that reads from nested JSON documents.

    Implements the same query interface as FactorRepository so the GHG engine
    and EQM plugins can use it as a drop-in replacement.
    """

    def __init__(self, docs: list[dict]):
        self._docs = docs
        self._index: dict[tuple[str, str, str], list[int]] = {}
        self._by_key: dict[str, int] = {}
        for i, doc in enumerate(docs):
            domain = _get(doc, "classification", "domain", default="")
            dtype = _get(doc, "classification", "type", default="")
            attr = _get(doc, "factor", "attribute", default="")
            self._index.setdefault((domain, dtype, attr), []).append(i)
            fk = doc.get("factor_key", "")
            if fk:
                self._by_key[fk] = i

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def from_json(cls, path: str | Path) -> DocumentFactorRepository:
        with open(path, encoding="utf-8") as f:
            docs = json.load(f)
        current = [d for d in docs if _get(d, "versioning", "is_current", default=True)]
        return cls(current)

    @classmethod
    def from_sqlite(cls, conn: sqlite3.Connection) -> DocumentFactorRepository:
        rows = conn.execute(
            "SELECT doc FROM factors WHERE is_current = 1"
        ).fetchall()
        docs = [json.loads(r[0] if isinstance(r, (tuple, list)) else r["doc"]) for r in rows]
        return cls(docs)

    # ------------------------------------------------------------------
    # Query translation
    # ------------------------------------------------------------------

    def _translate_query(self, q: FactorQuery) -> tuple[str, str, str]:
        """Map FactorQuery fields to document (domain, type, attribute)."""
        domain = _CATEGORY_TO_DOMAIN.get(q.emission_category, q.emission_category)
        dtype = q.type
        attr = q.attribute.translate(_ATTR_TO_DOC)
        return domain, dtype, attr

    # ------------------------------------------------------------------
    # Coarse + fine filtering
    # ------------------------------------------------------------------

    def _coarse_docs(self, domain: str, dtype: str, attr: str) -> list[dict]:
        idxs = self._index.get((domain, dtype, attr))
        if idxs is None:
            return []
        return [self._docs[i] for i in idxs]

    def _matches_filter(self, doc: dict, q: FactorQuery, domain: str, dtype: str, attr: str) -> bool:
        if q.greenhouse_gas is not None:
            doc_gas = _get(doc, "factor", "greenhouse_gas")
            if doc_gas is not None and doc_gas != q.greenhouse_gas:
                return False
        if q.description is not None:
            doc_subtype = _get(doc, "classification", "subtype")
            if doc_subtype is not None and not doc_subtype.startswith(q.description):
                return False
        if q.life_cycle_stage is not None:
            doc_stage = _get(doc, "classification", "life_cycle_stage")
            if doc_stage is not None and doc_stage != q.life_cycle_stage:
                return False
        if not self._valid_for_period(doc, q):
            return False
        return True

    def _valid_for_period(self, doc: dict, q: FactorQuery) -> bool:
        if q.inventory_year is None:
            return True
        data_year = _get(doc, "provenance", "data_year")
        if data_year is not None:
            return int(data_year) <= q.inventory_year
        return True

    # ------------------------------------------------------------------
    # Scoring (mirrors FactorRepository._geo_score, etc.)
    # ------------------------------------------------------------------

    @staticmethod
    def _norm_geo(val: str | None) -> str | None:
        if val is None:
            return None
        lower = val.strip().lower()
        return _COUNTRY_ALIASES.get(lower, lower)

    def _geo_score(self, doc: dict, q: FactorQuery) -> int:
        geo = doc.get("geography", {})
        query_geo = {
            "grid_region_code": q.geo.egrid_subregion,
            "state": q.geo.state,
            "country": q.geo.country,
            "region": q.geo.region,
        }
        row_geo = {
            "grid_region_code": geo.get("grid_region_code"),
            "state": geo.get("state"),
            "country": geo.get("country"),
            "region": geo.get("region"),
        }
        score = 0
        for field, field_score in [("grid_region_code", 40), ("state", 30), ("country", 20), ("region", 10)]:
            rv = row_geo[field]
            if rv is None:
                continue
            qv = query_geo[field]
            if qv is None:
                # Document has this geo field but query doesn't constrain it — neutral, skip.
                continue
            norm_rv = self._norm_geo(str(rv)) if field == "country" else str(rv)
            norm_qv = self._norm_geo(str(qv)) if field == "country" else str(qv)
            if norm_rv != norm_qv:
                return -1
            score = max(score, field_score)

        if not q.allow_fallback_geography:
            target = None
            if q.geo.egrid_subregion:
                target = "grid_region_code"
            elif q.geo.state:
                target = "state"
            elif q.geo.country:
                target = "country"
            elif q.geo.region:
                target = "region"
            if target is not None:
                rv = row_geo[target]
                qv = query_geo[target]
                if target == "country":
                    if rv is None or self._norm_geo(str(rv)) != self._norm_geo(str(qv)):
                        return -1
                elif rv is None or str(rv) != str(qv):
                    return -1

        if score == 0:
            spec = geo.get("geographic_specificity", "")
            if spec == "global" or spec == "national":
                return 0
        return score

    def _unit_preference_score(self, doc: dict, q: FactorQuery) -> int:
        if not q.preferred_denominator_units:
            return 0
        denom = _get(doc, "factor", "unit_denominator")
        if denom is None:
            return 0
        norm = self._normalize_unit(denom)
        preferred = {self._normalize_unit(u) for u in q.preferred_denominator_units}
        return 5 if norm in preferred else 0

    @staticmethod
    def _normalize_unit(raw: str) -> str:
        alias = {
            "gallons": "gal", "gallon": "gal", "gal": "gal",
            "kwh": "kwh", "kilowatt_hour": "kwh", "mwh": "mwh",
            "mmbtu": "mmbtu", "scf": "scf",
        }
        token = raw.strip().lower().replace(" ", "_")
        return alias.get(token, token)

    def _confidence_score(self, doc: dict) -> float:
        level = _get(doc, "provenance", "confidence_level", default="")
        if level:
            return _CONFIDENCE_MAP.get(str(level).lower(), 0.0)
        return 0.0

    # ------------------------------------------------------------------
    # Core query methods
    # ------------------------------------------------------------------

    def select_best(self, q: FactorQuery, *, trace: list[str] | None = None) -> EmissionFactorRow | None:
        domain, dtype, attr = self._translate_query(q)
        candidates = self._coarse_docs(domain, dtype, attr)
        if not candidates:
            if trace is not None:
                trace.append(f"doc factor select: 0 coarse for ({domain},{dtype},{attr})")
            return None

        filtered = [d for d in candidates if self._matches_filter(d, q, domain, dtype, attr)]
        if not filtered and q.description is not None:
            # Retry without description filter — document subtypes may differ from routing hints.
            relaxed = q.model_copy(update={"description": None})
            filtered = [d for d in candidates if self._matches_filter(d, relaxed, domain, dtype, attr)]
            if trace is not None and filtered:
                trace.append(f"doc factor select: relaxed description filter (was '{q.description}')")
        if not filtered:
            if trace is not None:
                trace.append("doc factor select: no candidates after filtering")
            return None

        # Keep only most recent data_year if multiple exist
        if q.inventory_year is not None:
            years = [_get(d, "provenance", "data_year") for d in filtered]
            years = [int(y) for y in years if y is not None]
            if years:
                best_year = max(years)
                filtered = [
                    d for d in filtered
                    if _get(d, "provenance", "data_year") is None
                    or int(_get(d, "provenance", "data_year")) == best_year
                ]

        scored: list[tuple[tuple[float, ...], dict]] = []
        for doc in filtered:
            geo_score = self._geo_score(doc, q)
            if geo_score < 0:
                continue

            source = _get(doc, "provenance", "source_id", default="")
            user_pref = 1000.0 if (q.allow_user_factors and str(source).lower() == "user") else 0.0
            unit_score = float(self._unit_preference_score(doc, q))
            confidence = self._confidence_score(doc)
            data_year = float(_get(doc, "provenance", "data_year") or -1)

            sort_key = (
                user_pref + geo_score + unit_score,
                geo_score,
                unit_score,
                confidence,
                data_year,
            )
            scored.append((sort_key, doc))

        if not scored:
            if trace is not None:
                trace.append("doc factor select: no candidates after geography rules")
            return None

        scored.sort(key=lambda x: x[0], reverse=True)
        chosen_doc = scored[0][1]
        result = self._to_model(chosen_doc)

        if trace is not None:
            trace.append(
                f"doc factor select: candidates={len(filtered)} chosen={result.factor_id} "
                f"score={scored[0][0][0]:.2f} geo={scored[0][0][1]:.0f} unit={scored[0][0][2]:.0f}"
            )
        return result

    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        domain, dtype, attr = self._translate_query(q)
        docs = self._coarse_docs(domain, dtype, attr)
        filtered = [d for d in docs if self._matches_filter(d, q, domain, dtype, attr)]
        return [self._to_model(d) for d in filtered]

    def find(self, q: FactorQuery) -> list[EmissionFactorRow]:
        return self.candidates(q)

    def select(self, q: FactorQuery) -> EmissionFactorRow | None:
        return self.select_best(q)

    def preview(self, query_text: str | None = None) -> list[dict[str, str]]:
        results = []
        needle = (query_text or "").lower()
        for doc in self._docs:
            if needle:
                blob = json.dumps(doc).lower()
                if needle not in blob:
                    continue
            results.append({
                "factor_id": doc.get("factor_key", doc.get("_id", "")),
                "emission_category": _get(doc, "classification", "domain", default=""),
                "type": _get(doc, "classification", "type", default=""),
                "description": _get(doc, "classification", "subtype", default=""),
                "attribute": _get(doc, "factor", "attribute", default=""),
                "gas": _get(doc, "factor", "greenhouse_gas", default=""),
                "unit": _get(doc, "factor", "unit_label", default=""),
                "factor_source": _get(doc, "provenance", "source_id", default=""),
            })
            if len(results) >= 100:
                break
        return results

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        idx = self._by_key.get(factor_id)
        if idx is None:
            return None
        return self._to_model(self._docs[idx])

    # ------------------------------------------------------------------
    # Document -> EmissionFactorRow conversion
    # ------------------------------------------------------------------

    def _to_model(self, doc: dict) -> EmissionFactorRow:
        geo = doc.get("geography", {})
        factor = doc.get("factor", {})
        classification = doc.get("classification", {})
        provenance = doc.get("provenance", {})
        attr_underscore = str(factor.get("attribute", "")).translate(_ATTR_FROM_DOC)

        return EmissionFactorRow(
            factor_id=doc.get("factor_key", doc.get("_id", "")),
            emission_category=classification.get("domain", ""),
            type=classification.get("type", ""),
            description=classification.get("subtype"),
            attribute=attr_underscore,
            greenhouse_gas=factor.get("greenhouse_gas"),
            gas=factor.get("greenhouse_gas"),
            value=factor.get("value"),
            unit=factor.get("unit_label"),
            unit_label=factor.get("unit_label"),
            unit_1=factor.get("unit_numerator"),
            unit_2=factor.get("unit_denominator"),
            geography_global=(geo.get("geographic_specificity") == "global"),
            region=geo.get("region"),
            country=geo.get("country"),
            state=geo.get("state"),
            egrid_subregion=geo.get("grid_region_code"),
            confidence_level=provenance.get("confidence_level"),
            data_year=provenance.get("data_year"),
            factor_source=provenance.get("source_id"),
            source_entity_short=provenance.get("source_id"),
            accounting_method="none",
            life_cycle_stage=classification.get("life_cycle_stage"),
            valid_from=None,
            valid_to=None,
            last_updated=None,
            updated_at=None,
            priority=None,
            confidence=None,
        )
