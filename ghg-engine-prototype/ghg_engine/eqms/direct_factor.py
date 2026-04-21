from __future__ import annotations

from ..factors import FactorQuery, FactorRepository
from ..gwp import get_gwp_set
from ..models import ActivityRecord, CalculationContext, GeoContext, ResultRecord, RoutingRow, TraceRecord
from ..time_utils import activity_bucket
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg

GASES = ("co2", "ch4", "n2o")


class DirectFactorMethod(EQMPlugin):
    id = "direct_factor"
    version = "1.0.0"

    def required_params_schema(self) -> dict[str, object]:
        return {"type": "object", "properties": {}, "required": []}

    def applicability(self, activity: ActivityRecord, routing: RoutingRow) -> bool:
        del activity
        del routing
        return True

    def _query_factor(
        self,
        factors: FactorRepository,
        routing: RoutingRow,
        activity: ActivityRecord,
        ctx: CalculationContext,
        *,
        attribute: str,
        gas: str,
        accounting_method: str,
        trace: TraceRecord,
    ):
        preferred_denoms = (activity.activity.unit,)
        return factors.select_best(
            FactorQuery(
                role="emission_factor",
                emission_category=routing.emission_category,
                type=activity.source_type,
                description=routing.factor_description or activity.source_type,
                attribute=attribute,
                greenhouse_gas=gas,
                inventory_year=ctx.inventory_year,
                period_start=ctx.inventory_period.start.date() if ctx.inventory_period else None,
                period_end=ctx.inventory_period.end.date() if ctx.inventory_period else None,
                accounting_method=accounting_method,
                geo=GeoContext(
                    region=ctx.source_attributes.get("region"),
                    country=ctx.source_attributes.get("country"),
                    state=ctx.source_attributes.get("state"),
                    egrid_subregion=ctx.source_attributes.get("egrid_subregion"),
                ),
                preferred_denominator_units=preferred_denoms,
            ),
            trace=trace.defaults_applied,
        )

    def _activity_to_factor_denominator(self, activity: ActivityRecord, factor_unit: str, ureg):
        numerator, denominator = [x.strip() for x in factor_unit.split("/")]
        qty = parse_qty(ureg, activity.activity.value, activity.activity.unit)
        denom_qty = to_unit(ureg, qty, denominator)
        return denom_qty, numerator

    def compute(
        self,
        activity: ActivityRecord,
        routing: RoutingRow,
        ctx: CalculationContext,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        accounting_methods = (
            ["location_based", "market_based"]
            if routing.source_type in {"electricity", "district-steam"}
            else ["none"]
        )
        traces = TraceRecord(selected_method=self.id)
        results: list[ResultRecord] = []
        bucket = activity_bucket(activity, ctx.inventory_year, "month")
        gwp = get_gwp_set(ctx.gwp_set)
        ureg = default_ureg()

        for accounting_method in accounting_methods:
            gas_rows: list[ResultRecord] = []
            for gas in GASES:
                factor = self._query_factor(
                    factors,
                    routing,
                    activity,
                    ctx,
                    attribute=f"{gas}_ef",
                    gas=gas,
                    accounting_method=accounting_method,
                    trace=traces,
                )
                if factor is None:
                    continue
                try:
                    denom_qty, numerator = self._activity_to_factor_denominator(activity, factor.unit, ureg)
                except Exception:
                    traces.defaults_applied.append(
                        f"skipped {gas} factor {factor.factor_id}: "
                        f"cannot convert activity unit '{activity.activity.unit}' to factor denominator"
                    )
                    continue
                factor_denominator = factor.unit.split("/")[1].strip()
                factor_q = parse_qty(ureg, factor.value, numerator) / parse_qty(
                    ureg,
                    1.0,
                    factor_denominator,
                )
                mass_kg = (denom_qty * factor_q).to("kilogram").magnitude
                gas_rows.append(
                    ResultRecord(
                        facility_id=activity.facility_id,
                        source_id=routing.source_id,
                        scope=activity.scope,
                        accounting_method=accounting_method,
                        gas=gas,
                        value=float(mass_kg),
                        unit="kg",
                        is_biogenic=activity.is_biogenic and gas == "co2",
                        method_id=self.id,
                        factor_ids=[factor.factor_id],
                        time_bucket=bucket,
                    )
                )
                traces.factor_matches.append(factor.factor_id)

            if gas_rows:
                co2e = 0.0
                for row in gas_rows:
                    co2e += row.value * gwp.get(row.gas, 1.0)
                results.extend(gas_rows)
                results.append(
                    ResultRecord(
                        facility_id=activity.facility_id,
                        source_id=routing.source_id,
                        scope=activity.scope,
                        accounting_method=accounting_method,
                        gas="co2e",
                        value=float(co2e),
                        unit="kg",
                        is_biogenic=activity.is_biogenic,
                        method_id=self.id,
                        factor_ids=[f for r in gas_rows for f in r.factor_ids],
                        time_bucket=bucket,
                    )
                )
                continue

            co2e_factor = self._query_factor(
                factors,
                routing,
                activity,
                ctx,
                attribute="co2e_ef",
                gas="co2e",
                accounting_method=accounting_method,
                trace=traces,
            )
            if co2e_factor is None:
                continue
            denom_qty, numerator = self._activity_to_factor_denominator(activity, co2e_factor.unit, ureg)
            factor_q = parse_qty(ureg, co2e_factor.value, numerator) / parse_qty(
                ureg,
                1.0,
                co2e_factor.unit.split("/")[1].strip(),
            )
            co2e_kg = (denom_qty * factor_q).to("kilogram").magnitude
            results.append(
                ResultRecord(
                    facility_id=activity.facility_id,
                    source_id=routing.source_id,
                    scope=activity.scope,
                    accounting_method=accounting_method,
                    gas="co2e",
                    value=float(co2e_kg),
                    unit="kg",
                    is_biogenic=activity.is_biogenic,
                    method_id=self.id,
                    factor_ids=[co2e_factor.factor_id],
                    time_bucket=bucket,
                )
            )
            traces.factor_matches.append(co2e_factor.factor_id)

        if not results:
            traces.defaults_applied.append("no factors matched")
        return results, traces
