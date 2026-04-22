from __future__ import annotations

from collections import defaultdict

from ..activity_catalog import ActivityTypeDefinition, FactorQueryTemplate
from ..factors import FactorRepository
from ..models import ActivityRecord, CalculationContext, ResultRecord, TraceRecord
from .base import EQMPlugin
from .direct_factor import DirectFactorMethod


class Scope2EnergyMethod(EQMPlugin):
    id = "scope2_energy"
    version = "2.0.0"

    def __init__(self) -> None:
        self._direct = DirectFactorMethod()

    def required_params_schema(self) -> dict[str, object]:
        return {"type": "object", "properties": {}, "required": []}

    def applicability(self, activity: ActivityRecord, activity_def: ActivityTypeDefinition) -> bool:
        del activity
        return activity_def.scope == "Scope 2" and activity_def.method_id == self.id

    def compute(
        self,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        template_groups = self._group_templates(activity_def)
        requires_dual = bool(activity_def.accounting_metadata.get("requires_dual_scope2_reporting"))
        if requires_dual:
            for method in ("location_based", "market_based"):
                if method not in template_groups:
                    raise ValueError(
                        f"{activity_def.activity_type_id} requires dual Scope 2 reporting but lacks {method} factors"
                    )
        location_results, trace = self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups={"location_based": template_groups.get("location_based", [])},
            selected_method=self.id,
            result_method_id=self.id,
        )
        results = list(location_results)
        market_results, market_trace = self._compute_market_based(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups=template_groups,
            location_results=location_results,
        )
        results.extend(market_results)
        trace.factor_matches.extend(market_trace.factor_matches)
        trace.conversions.extend(market_trace.conversions)
        trace.defaults_applied.extend(market_trace.defaults_applied)
        if requires_dual:
            observed = {row.accounting_method for row in results}
            missing = {"location_based", "market_based"} - observed
            for method in sorted(missing):
                trace.defaults_applied.append(f"no {method} Scope 2 factors matched")
        return results, trace

    def _compute_market_based(
        self,
        *,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
        template_groups: dict[str, list[FactorQueryTemplate]],
        location_results: list[ResultRecord],
    ) -> tuple[list[ResultRecord], TraceRecord]:
        market_trace = TraceRecord(
            activity_type_id=activity.activity_type_id,
            activity_label=activity_def.label,
            selected_method=self.id,
        )
        market_templates = template_groups.get("market_based", [])
        if not market_templates:
            return [], market_trace

        procurement_instrument = str(activity.params.get("procurement_instrument") or "").strip()
        if procurement_instrument:
            supplier_templates = [
                template.model_copy(update={"description": procurement_instrument})
                for template in market_templates
            ]
            supplier_results, supplier_trace = self._direct.compute_from_template_groups(
                activity=activity,
                activity_def=activity_def,
                ctx=ctx,
                factors=factors,
                template_groups={"market_based": supplier_templates},
                selected_method=self.id,
                result_method_id=self.id,
            )
            if supplier_results and not any(
                "relaxed description filter" in note for note in supplier_trace.defaults_applied
            ):
                supplier_trace.defaults_applied.append(
                    f"market-based precedence: used supplier-specific factor '{procurement_instrument}'"
                )
                return supplier_results, supplier_trace

        residual_templates = [
            template.model_copy(update={"description": "residual-mix"})
            for template in market_templates
        ]
        residual_results, residual_trace = self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups={"market_based": residual_templates},
            selected_method=self.id,
            result_method_id=self.id,
        )
        if residual_results and not any(
            "relaxed description filter" in note for note in residual_trace.defaults_applied
        ):
            residual_trace.defaults_applied.append("market-based precedence: used residual mix factor")
            return residual_results, residual_trace

        generic_results, generic_trace = self._direct.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups={"market_based": market_templates},
            selected_method=self.id,
            result_method_id=self.id,
        )
        if generic_results:
            if self._same_factor_path(generic_results, location_results):
                generic_trace.defaults_applied.append(
                    "market-based precedence: no supplier-specific or residual mix factor matched; used location-based proxy"
                )
            else:
                generic_trace.defaults_applied.append("market-based precedence: used market-based factor path")
            return generic_results, generic_trace

        if not location_results:
            market_trace.defaults_applied.append("market-based precedence: no supplier-specific, residual mix, or proxy factor matched")
            return [], market_trace

        market_trace.defaults_applied.append(
            "market-based precedence: no supplier-specific or residual mix factor matched; used location-based proxy"
        )
        proxy_results = [row.model_copy(update={"accounting_method": "market_based"}) for row in location_results]
        return proxy_results, market_trace

    def _same_factor_path(self, market_results: list[ResultRecord], location_results: list[ResultRecord]) -> bool:
        if not market_results or not location_results:
            return False
        market_ids = {factor_id for row in market_results for factor_id in row.factor_ids}
        location_ids = {factor_id for row in location_results for factor_id in row.factor_ids}
        return market_ids == location_ids and bool(market_ids)

    def _group_templates(self, activity_def: ActivityTypeDefinition) -> dict[str, list[FactorQueryTemplate]]:
        grouped: dict[str, list[FactorQueryTemplate]] = defaultdict(list)
        for template in activity_def.factor_query_templates:
            grouped[template.accounting_method or "none"].append(template)
        return dict(grouped)
