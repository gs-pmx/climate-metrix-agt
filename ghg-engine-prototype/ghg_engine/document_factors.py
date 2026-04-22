"""Document-based FactorRepository backed by nested JSON emission factor documents."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from .domain import CanonicalFactorRecord
from .factors import FactorQuery, FactorRepository
from .models import EmissionFactorRow
from .services import FactorSelectionService

# Maps the current routing catalog's emission_category values to new document domain values.
_CATEGORY_TO_DOMAIN: dict[str, str] = {
    "mobile-combustion": "combustion",
    "stationary-energy": "combustion",
    "purchased-electricity": "electricity-generation",
    "purchased-steam": "combustion",
    "3.4-upstream-transportation-distribution": "freight-transport",
    "3.5-waste-operations": "waste-decomposition",
    "3.6-business-travel": "passenger-transport",
    "3.7-employee-commuting": "passenger-transport",
    "fugitive-emission": "refrigerant-release",
}

# Current system uses underscores (co2_ef), documents use hyphens (co2-ef).
_ATTR_TO_DOC = str.maketrans("_", "-")
_ATTR_FROM_DOC = str.maketrans("-", "_")


def _get(doc: dict, *keys: str, default=None):
    """Safely traverse nested dict keys."""
    node = doc
    for key in keys:
        if not isinstance(node, dict):
            return default
        node = node.get(key, default)
    return node


class DocumentFactorRepository:
    """Emission factor repository that reads from nested JSON documents."""

    def __init__(self, docs: list[dict]):
        self._docs = docs
        self._selector = FactorSelectionService()
        self._index: dict[tuple[str, str, str], list[int]] = {}
        self._by_key: dict[str, int] = {}
        for i, doc in enumerate(docs):
            domain = _get(doc, "classification", "domain", default="")
            dtype = _get(doc, "classification", "type", default="")
            attr = _get(doc, "factor", "attribute", default="")
            self._index.setdefault((domain, dtype, attr), []).append(i)
            factor_key = doc.get("factor_key", "")
            if factor_key:
                self._by_key[factor_key] = i

    @classmethod
    def from_json(cls, path: str | Path) -> DocumentFactorRepository:
        with open(path, encoding="utf-8") as handle:
            docs = json.load(handle)
        current = [doc for doc in docs if _get(doc, "versioning", "is_current", default=True)]
        return cls(current)

    @classmethod
    def from_sqlite(cls, conn: sqlite3.Connection) -> DocumentFactorRepository:
        rows = conn.execute("SELECT doc FROM factors WHERE is_current = 1").fetchall()
        docs = [json.loads(row[0] if isinstance(row, (tuple, list)) else row["doc"]) for row in rows]
        return cls(docs)

    def _translate_query(self, q: FactorQuery) -> tuple[str, str, str]:
        domain = _CATEGORY_TO_DOMAIN.get(q.emission_category, q.emission_category)
        dtype = q.type
        attr = q.attribute.translate(_ATTR_TO_DOC)
        return domain, dtype, attr

    def _coarse_docs(self, domain: str, dtype: str, attr: str) -> list[dict]:
        idxs = self._index.get((domain, dtype, attr))
        if idxs is None:
            return []
        return [self._docs[i] for i in idxs]

    def _canonical_from_doc(self, doc: dict) -> CanonicalFactorRecord:
        geo = doc.get("geography", {})
        factor = doc.get("factor", {})
        classification = doc.get("classification", {})
        provenance = doc.get("provenance", {})
        attr_underscore = str(factor.get("attribute", "")).translate(_ATTR_FROM_DOC)
        unit_label = factor.get("unit_label")
        unit_denominator = factor.get("unit_denominator")
        unit_numerator = factor.get("unit_numerator")
        return CanonicalFactorRecord(
            factor_id=doc.get("factor_key", doc.get("_id", "")),
            emission_category=classification.get("domain", ""),
            type=classification.get("type", ""),
            description=self._normalize_description(doc),
            attribute=attr_underscore,
            greenhouse_gas=factor.get("greenhouse_gas"),
            gas=factor.get("greenhouse_gas"),
            value=float(factor.get("value")),
            unit=unit_label,
            unit_label=unit_label,
            unit_1=unit_numerator,
            unit_2=unit_denominator,
            life_cycle_stage=classification.get("life_cycle_stage"),
            geography_global=(geo.get("geographic_specificity") == "global"),
            region=geo.get("region"),
            country=geo.get("country"),
            state=geo.get("state"),
            egrid_subregion=geo.get("grid_region_code"),
            factor_source=provenance.get("source_id"),
            source_entity_short=provenance.get("source_id"),
            data_year=provenance.get("data_year"),
            confidence_level=provenance.get("confidence_level"),
            updated_at=self._parse_date(doc.get("updated_at")),
            last_updated=self._parse_date(doc.get("updated_at")),
            valid_from=self._parse_date(_get(doc, "versioning", "valid_from")),
            valid_to=self._parse_date(_get(doc, "versioning", "valid_to")),
            accounting_method=self._infer_accounting_method(doc),
            factor_role="heat_content" if attr_underscore == "heat_content" else "emission_factor",
        )

    def _normalize_description(self, doc: dict) -> str | None:
        subtype = _get(doc, "classification", "subtype")
        if subtype is None:
            return None
        normalized = str(subtype)
        denom = _get(doc, "factor", "unit_denominator")
        if denom:
            suffix = f"-{str(denom).strip().lower()}"
            if normalized.lower().endswith(suffix):
                normalized = normalized[: -len(suffix)]
        return normalized

    def _infer_accounting_method(self, doc: dict):
        domain = str(_get(doc, "classification", "domain", default=""))
        if domain != "electricity-generation":
            return "none"
        text = " ".join(
            str(value).lower()
            for value in [
                doc.get("factor_key", ""),
                _get(doc, "classification", "subtype", default=""),
                _get(doc, "provenance", "source_detail", default=""),
            ]
        )
        if any(token in text for token in ["residual-mix", "residual mix", "supplier-specific", "supplier specific", "contractual", "ppa", "rec", "tariff"]):
            return "market_based"
        return "location_based"

    def _parse_date(self, raw: str | None):
        if not raw:
            return None
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
        except ValueError:
            return None

    def select_best(self, q: FactorQuery, *, trace: list[str] | None = None) -> EmissionFactorRow | None:
        domain, dtype, attr = self._translate_query(q)
        docs = self._coarse_docs(domain, dtype, attr)
        if not docs:
            if trace is not None:
                trace.append(f"doc factor select: 0 coarse for ({domain},{dtype},{attr})")
            return None

        records = [self._canonical_from_doc(doc) for doc in docs]
        if q.description is not None and not self._selector.candidates(records, q):
            relaxed = q.model_copy(update={"description": None})
            chosen = self._selector.select_best(records, relaxed, trace=trace, trace_prefix="doc factor select")
            if chosen is not None and trace is not None:
                trace.append(f"doc factor select: relaxed description filter (was '{q.description}')")
            return FactorRepository._model_from_canonical(chosen) if chosen is not None else None

        chosen = self._selector.select_best(records, q, trace=trace, trace_prefix="doc factor select")
        return FactorRepository._model_from_canonical(chosen) if chosen is not None else None

    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        domain, dtype, attr = self._translate_query(q)
        docs = self._coarse_docs(domain, dtype, attr)
        records = [self._canonical_from_doc(doc) for doc in docs]
        return [FactorRepository._model_from_canonical(record) for record in self._selector.candidates(records, q)]

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
                "description": self._normalize_description(doc) or "",
                "attribute": _get(doc, "factor", "attribute", default=""),
                "gas": _get(doc, "factor", "greenhouse_gas", default=""),
                "unit": _get(doc, "factor", "unit_label", default=""),
                "factor_source": _get(doc, "provenance", "source_id", default=""),
            })
            if len(results) >= 100:
                break
        return results

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        idx = self._by_key.get(str(factor_id))
        if idx is None:
            return None
        return FactorRepository._model_from_canonical(self._canonical_from_doc(self._docs[idx]))
