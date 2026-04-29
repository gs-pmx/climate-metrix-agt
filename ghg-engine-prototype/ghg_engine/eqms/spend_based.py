"""SpendBasedMethod EQM plugin.

Drives spend-based emissions accounting per the Phase E1 plan: for each
spend row, resolve a GL code -> factor mapping, look up the spend-based
emission factor, apply FX and inflation correction, and emit a single
ResultRecord. When the GL code is unmapped or an FX rate is missing, the
plugin returns no rows and raises a structured exception that the
calculation envelope translates into ``unmapped_gl_code`` /
``missing_fx_rate``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..models import EmissionFactorRow, ResultRecord, TraceRecord
from ..time_utils import observation_bucket
from .base import EQMContext, EQMPlugin
from .context import inventory_year


class UnmappedGLCodeError(ValueError):
    """Raised when a spend row's gl_code has no mapping for the project + RU."""

    def __init__(self, gl_code: str, reporting_unit_id: str | None) -> None:
        message = (
            f"unmapped_gl_code: no factor mapping found for gl_code='{gl_code}'"
            f" (reporting_unit_id='{reporting_unit_id or 'project_default'}')"
        )
        super().__init__(message)
        self.gl_code = gl_code
        self.reporting_unit_id = reporting_unit_id


class MissingFxRateError(ValueError):
    """Raised when no FX rate row exists for the (currency, transaction_year)."""

    def __init__(self, currency: str, year: int) -> None:
        message = (
            f"missing_fx_rate: no FX rate found for currency='{currency}' year={year}"
        )
        super().__init__(message)
        self.currency = currency
        self.year = year


class GLMappingResolver(Protocol):
    """Resolve a (reporting_unit_id, gl_code) pair to a factor_id.

    Implementations enforce the per-RU-overrides-project-default rule:
    if a mapping exists for the given RU, use it; otherwise fall back to
    the project-wide default (RU = ``None``); otherwise return ``None``.
    """

    def resolve(self, *, reporting_unit_id: str | None, gl_code: str) -> str | None:
        ...


@dataclass
class StaticGLMappingResolver:
    """In-memory resolver fed from an ``(reporting_unit_id, gl_code) -> factor_id`` dict.

    Empty/missing reporting_unit_id falls through to project-wide.
    """

    by_ru: dict[str, dict[str, str]] = field(default_factory=dict)
    project_default: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_rows(cls, rows: list[dict[str, Any]]) -> StaticGLMappingResolver:
        resolver = cls()
        for row in rows:
            gl_code = str(row.get("gl_code") or "").strip()
            factor_id = str(row.get("factor_id") or "").strip()
            if not gl_code or not factor_id:
                continue
            ru = row.get("reporting_unit_id")
            ru_key = (ru or "").strip() if isinstance(ru, str) else None
            if ru_key:
                resolver.by_ru.setdefault(ru_key, {})[gl_code] = factor_id
            else:
                resolver.project_default[gl_code] = factor_id
        return resolver

    def resolve(self, *, reporting_unit_id: str | None, gl_code: str) -> str | None:
        gl_code = (gl_code or "").strip()
        if not gl_code:
            return None
        if reporting_unit_id:
            ru_map = self.by_ru.get(reporting_unit_id) or {}
            if gl_code in ru_map:
                return ru_map[gl_code]
        return self.project_default.get(gl_code)


@dataclass
class SpendBasedContext:
    """Per-project context the SpendBasedMethod plugin needs.

    ``factor_provider`` returns the ``EmissionFactorRow`` for a given
    factor_id (or ``None`` if the factor is missing). The orchestrator
    typically wraps the active ``SQLiteFactorRepository.get_by_factor_id``.

    ``fx_provider`` and ``inflation_provider`` are thin lookups against
    the bundled reference tables; they return ``None`` on miss so the
    plugin can decide whether to surface a structured error.
    """

    gl_resolver: GLMappingResolver
    factor_provider: Callable[[str], EmissionFactorRow | None]
    fx_provider: Callable[[str, int], dict[str, Any] | None]
    inflation_provider: Callable[[str, int], dict[str, Any] | None]
    inflation_index_name: str = "us_cpi_u"


class SpendBasedMethod(EQMPlugin):
    id = "spend_based"
    version = "1.0.0"

    def required_params_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "gl_code": {"type": "string"},
                "gl_account_name": {"type": "string"},
                "transaction_year": {"type": "integer"},
                "supplier": {"type": "string"},
                "supplier_country": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["gl_code"],
        }

    def applicability(
        self, resolved: ResolvedActivity, activity_def: ActivityTypeDefinition
    ) -> bool:
        del resolved
        return activity_def.method_id == self.id

    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors,
        *,
        eqm_context: EQMContext | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        del factors  # spend factors flow via the EQMContext.factor_provider
        observation = resolved.observation
        params = observation.params
        trace = TraceRecord(
            activity_type_id=observation.activity_type_id,
            activity_label=activity_def.label,
            selected_method=self.id,
        )

        spend_ctx = self._require_context(eqm_context)
        gl_code = str(params.get("gl_code") or "").strip()
        if not gl_code:
            raise ValueError("spend_based requires params.gl_code")
        # Phase E3 — transaction_year defaults to the inventory year so
        # bulk spend imports don't have to repeat the year on every row.
        # Per the GHG protocol a transaction is scoped to the inventory
        # year it falls under; per-row override remains supported for
        # the rare cases where the underlying spend straddles years.
        raw_year = params.get("transaction_year")
        if raw_year is None or raw_year == "":
            inv_year = inventory_year(resolved)
            if inv_year is None:
                raise ValueError(
                    "spend_based requires params.transaction_year or an inventory year on the policy"
                )
            transaction_year = int(inv_year)
        else:
            transaction_year = self._require_int(raw_year, key="transaction_year")
        currency = str(observation.quantity.unit or "").strip().upper() or "USD"
        # Phase E3 — accept zero or negative spend so accounting
        # corrections (refunds, returns, reversals) flow through. The
        # math is signed; emissions for negative spend are negative.
        spend_amount = float(observation.quantity.value or 0.0)
        reporting_unit_id = observation.locus_id or None

        factor_id = spend_ctx.gl_resolver.resolve(
            reporting_unit_id=reporting_unit_id, gl_code=gl_code
        )
        if not factor_id:
            raise UnmappedGLCodeError(gl_code, reporting_unit_id)
        factor = spend_ctx.factor_provider(factor_id)
        if factor is None:
            raise UnmappedGLCodeError(gl_code, reporting_unit_id)

        if currency == "USD":
            # Short-circuit: USD is always 1:1 against itself, so we
            # never depend on a real row in fx_rates. This keeps the v1
            # USD-only entry path resilient to a missing seed.
            rate_to_usd = 1.0
        else:
            fx_row = spend_ctx.fx_provider(currency, transaction_year)
            if fx_row is None:
                raise MissingFxRateError(currency, transaction_year)
            rate_to_usd = float(fx_row.get("rate_to_usd") or 0.0)
            if rate_to_usd <= 0:
                raise MissingFxRateError(currency, transaction_year)
        usd_in_transaction_year = spend_amount * rate_to_usd
        trace.conversions.append(
            f"FX: {spend_amount:.4f} {currency} * {rate_to_usd:.6f} = "
            f"{usd_in_transaction_year:.4f} USD ({transaction_year})"
        )

        ef_year = self._factor_reference_year(factor)
        usd_in_ef_year = usd_in_transaction_year
        inflation_note = ""
        if ef_year is not None and ef_year != transaction_year:
            txn_idx = spend_ctx.inflation_provider(
                spend_ctx.inflation_index_name, transaction_year
            )
            ef_idx = spend_ctx.inflation_provider(spend_ctx.inflation_index_name, ef_year)
            if txn_idx is not None and ef_idx is not None:
                txn_value = float(txn_idx.get("index_value") or 0.0)
                ef_value = float(ef_idx.get("index_value") or 0.0)
                if txn_value > 0:
                    usd_in_ef_year = usd_in_transaction_year * (ef_value / txn_value)
                    inflation_note = (
                        f"inflation: USD {transaction_year} -> USD {ef_year} "
                        f"via {spend_ctx.inflation_index_name} "
                        f"({ef_value:.3f}/{txn_value:.3f})"
                    )
            else:
                trace.defaults_applied.append(
                    f"inflation index missing for {transaction_year} or {ef_year}"
                    f"; emissions reported without inflation correction"
                )
        if inflation_note:
            trace.conversions.append(inflation_note)

        co2e_kg = usd_in_ef_year * float(factor.value)
        trace.factor_matches.append(factor.factor_id or factor_id)
        trace.intermediate_quantities["spend_local"] = spend_amount
        trace.intermediate_quantities["usd_in_transaction_year"] = usd_in_transaction_year
        trace.intermediate_quantities["usd_in_ef_year"] = usd_in_ef_year
        trace.intermediate_quantities["factor_value"] = float(factor.value)

        result = ResultRecord(
            facility_id=observation.locus_id,
            activity_type_id=observation.activity_type_id,
            activity_label=activity_def.label,
            scope=activity_def.scope,
            protocol_category_code=activity_def.protocol_category_code,
            protocol_category_label=activity_def.protocol_category_label,
            activity_group=activity_def.ui_metadata.get("group"),
            source_type=activity_def.source_type,
            accounting_method="none",
            gas="co2e",
            value=float(co2e_kg),
            unit="kg",
            is_biogenic=False,
            method_id=self.id,
            factor_ids=[factor.factor_id] if factor.factor_id else [factor_id],
            time_bucket=observation_bucket(observation, inventory_year(resolved), "month"),
        )
        return [result], trace

    @staticmethod
    def _require_context(ctx: EQMContext | None) -> SpendBasedContext:
        if ctx is None or ctx.spend_based is None:
            raise ValueError(
                "spend_based plugin requires an EQMContext with a SpendBasedContext"
            )
        return ctx.spend_based  # type: ignore[return-value]

    @staticmethod
    def _require_int(value: Any, *, key: str) -> int:
        if value is None or value == "":
            raise ValueError(f"spend_based requires params.{key}")
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"spend_based params.{key} must be an integer year") from exc

    @staticmethod
    def _factor_reference_year(factor: EmissionFactorRow) -> int | None:
        if factor.data_year is not None:
            return int(factor.data_year)
        return None


__all__ = [
    "SpendBasedMethod",
    "SpendBasedContext",
    "GLMappingResolver",
    "StaticGLMappingResolver",
    "UnmappedGLCodeError",
    "MissingFxRateError",
]
