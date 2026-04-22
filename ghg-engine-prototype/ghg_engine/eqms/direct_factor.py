from __future__ import annotations

from collections import defaultdict

from ..activity_catalog import ActivityTypeDefinition, FactorQueryTemplate
from ..factors import FactorQuery, FactorRepository
from ..gwp import get_gwp_set
from ..models import ActivityRecord, CalculationContext, GeoContext, ResultRecord, TraceRecord
from ..time_utils import activity_bucket
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg

ATTRIBUTE_TO_GAS = {
    "co2_ef": "co2",
    "co2-ef": "co2",
    "ch4_ef": "ch4",
    "ch4-ef": "ch4",
    "n2o_ef": "n2o",
    "n2o-ef": "n2o",
    "co2e_ef": "co2e",
    "co2e-ef": "co2e",
}

ENERGY_DENOMINATORS = {"btu", "mmbtu", "therm", "kilowatt_hour", "kwh", "mj", "megajoule"}


class DirectFactorMethod(EQMPlugin):
    id = "direct_factor"
    version = "2.0.0"

    def required_params_schema(self) -> dict[str, object]:
        return {"type": "object", "properties": {}, "required": []}

    def applicability(self, activity: ActivityRecord, activity_def: ActivityTypeDefinition) -> bool:
        del activity
        return activity_def.method_id == self.id

    def compute(
        self,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        template_groups = self._group_templates(activity_def)
        return self.compute_from_template_groups(
            activity=activity,
            activity_def=activity_def,
            ctx=ctx,
            factors=factors,
            template_groups=template_groups,
            selected_method=self.id,
        )

    def compute_from_template_groups(
        self,
        *,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        factors: FactorRepository,
        template_groups: dict[str, list[FactorQueryTemplate]],
        selected_method: str,
        result_method_id: str | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        traces = TraceRecord(
            activity_type_id=activity.activity_type_id,
            activity_label=activity_def.label,
            selected_method=selected_method,
        )
        results: list[ResultRecord] = []
        bucket = activity_bucket(activity, ctx.inventory_year, "month")
        gwp = get_gwp_set(ctx.gwp_set)
        ureg = default_ureg()

        for accounting_method, templates in template_groups.items():
            gas_rows: list[ResultRecord] = []
            for template in templates:
                for raw_attribute in template.attributes:
                    gas = ATTRIBUTE_TO_GAS.get(raw_attribute)
                    if gas is None:
                        traces.defaults_applied.append(f"ignored unsupported factor attribute '{raw_attribute}'")
                        continue
                    factor = self._query_factor(
                        factors=factors,
                        activity_def=activity_def,
                        activity=activity,
                        ctx=ctx,
                        template=template,
                        attribute=raw_attribute,
                        accounting_method=accounting_method,
                        trace=traces,
                    )
                    if factor is None:
                        continue
                    try:
                        denom_qty, numerator = self._activity_to_factor_denominator(
                            activity=activity,
                            factor_unit=factor.unit,
                            ureg=ureg,
                            factors=factors,
                            activity_def=activity_def,
                            ctx=ctx,
                            template=template,
                            trace=traces,
                        )
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
                        self._build_result_row(
                            activity=activity,
                            activity_def=activity_def,
                            accounting_method=accounting_method,
                            gas=gas,
                            value=float(mass_kg),
                            factor_ids=[factor.factor_id],
                            time_bucket=bucket,
                            method_id=result_method_id or selected_method,
                        )
                    )
                    traces.factor_matches.append(factor.factor_id)

            if not gas_rows:
                continue
            results.extend(gas_rows)
            if any(row.gas == "co2e" for row in gas_rows):
                continue
            co2e = 0.0
            for row in gas_rows:
                if row.gas == "co2" and row.is_biogenic:
                    traces.defaults_applied.append(
                        f"excluded biogenic CO2 from scope-total CO2e aggregation for {activity_def.activity_type_id}"
                    )
                    continue
                co2e += row.value * gwp.get(row.gas, 1.0)
            results.append(
                self._build_result_row(
                    activity=activity,
                    activity_def=activity_def,
                    accounting_method=accounting_method,
                    gas="co2e",
                    value=float(co2e),
                    factor_ids=[f for row in gas_rows for f in row.factor_ids],
                    time_bucket=bucket,
                    method_id=result_method_id or selected_method,
                )
            )

        if not results:
            traces.defaults_applied.append("no factors matched")
        return results, traces

    def _group_templates(self, activity_def: ActivityTypeDefinition) -> dict[str, list[FactorQueryTemplate]]:
        grouped: dict[str, list[FactorQueryTemplate]] = defaultdict(list)
        templates = activity_def.factor_query_templates or [self._fallback_template(activity_def)]
        for template in templates:
            method = template.accounting_method or "none"
            grouped[method].append(template)
        return dict(grouped)

    def _fallback_template(self, activity_def: ActivityTypeDefinition) -> FactorQueryTemplate:
        return FactorQueryTemplate(
            domain=activity_def.emission_category or "",
            type=activity_def.source_type,
            attributes=["co2-ef", "ch4-ef", "n2o-ef"],
            description=activity_def.factor_description,
            accounting_method=None,
        )

    def _query_factor(
        self,
        *,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        activity: ActivityRecord,
        ctx: CalculationContext,
        template: FactorQueryTemplate,
        attribute: str,
        accounting_method: str,
        trace: TraceRecord,
    ):
        preferred_denoms = (activity.activity.unit,)
        normalized_attribute = attribute.replace("-", "_")
        query_type = template.type or activity_def.source_type
        if query_type is None:
            raise ValueError(f"{activity_def.activity_type_id} is missing factor query type")
        emission_category = activity_def.emission_category
        if not emission_category:
            raise ValueError(f"{activity_def.activity_type_id} is missing emission_category")
        query = FactorQuery(
            role="emission_factor",
            emission_category=emission_category,
            type=query_type,
            description=template.description or activity_def.factor_description,
            attribute=normalized_attribute,
            greenhouse_gas=ATTRIBUTE_TO_GAS.get(attribute),
            life_cycle_stage=template.life_cycle_stage,
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
            allow_fallback_geography=self._allow_fallback_geography(template),
        )
        factor = factors.select_best(query, trace=trace.defaults_applied)
        if factor is None and query.life_cycle_stage is not None:
            trace.defaults_applied.append(
                f"relaxed life_cycle_stage filter for {activity_def.activity_type_id} attribute {normalized_attribute}"
            )
            factor = factors.select_best(
                query.model_copy(update={"life_cycle_stage": None}),
                trace=trace.defaults_applied,
            )
        return factor

    def _allow_fallback_geography(self, template: FactorQueryTemplate) -> bool:
        preference = (template.geography_preference or "").lower()
        if not preference:
            return True
        return "fallback" in preference

    def _activity_to_factor_denominator(
        self,
        *,
        activity: ActivityRecord,
        factor_unit: str,
        ureg,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        ctx: CalculationContext,
        template: FactorQueryTemplate,
        trace: TraceRecord,
    ):
        numerator, denominator = self._split_factor_unit(factor_unit)
        qty = parse_qty(ureg, activity.activity.value, activity.activity.unit)
        conversion_error: Exception | None = None
        try:
            denom_qty = to_unit(ureg, qty, denominator)
            return denom_qty, numerator
        except Exception as exc:
            conversion_error = exc

        if not self._is_energy_unit(ureg, denominator):
            raise conversion_error or ValueError("unit conversion failed")
        heat_factor = self._query_heat_content_factor(
            factors=factors,
            activity_def=activity_def,
            activity=activity,
            ctx=ctx,
            template=template,
            trace=trace,
        )
        if heat_factor is None:
            raise ValueError("no heat-content factor matched")
        heat_numerator, heat_denominator = self._split_factor_unit(heat_factor.unit)
        base_qty = to_unit(ureg, qty, heat_denominator)
        heat_factor_q = parse_qty(ureg, heat_factor.value, heat_numerator) / parse_qty(ureg, 1.0, heat_denominator)
        energy_qty = base_qty * heat_factor_q
        denom_qty = to_unit(ureg, energy_qty, denominator)
        trace.conversions.append(
            f"converted {activity.activity.value} {activity.activity.unit} to {denominator} via heat-content factor {heat_factor.factor_id}"
        )
        return denom_qty, numerator

    def _query_heat_content_factor(
        self,
        *,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        activity: ActivityRecord,
        ctx: CalculationContext,
        template: FactorQueryTemplate,
        trace: TraceRecord,
    ):
        query_type = template.type or activity_def.source_type
        if query_type is None:
            return None
        query = FactorQuery(
            role="heat_content",
            emission_category=activity_def.emission_category or "",
            type=query_type,
            description=template.description or activity_def.factor_description,
            attribute="heat_content",
            greenhouse_gas=None,
            inventory_year=ctx.inventory_year,
            period_start=ctx.inventory_period.start.date() if ctx.inventory_period else None,
            period_end=ctx.inventory_period.end.date() if ctx.inventory_period else None,
            geo=GeoContext(
                region=ctx.source_attributes.get("region"),
                country=ctx.source_attributes.get("country"),
                state=ctx.source_attributes.get("state"),
                egrid_subregion=ctx.source_attributes.get("egrid_subregion"),
            ),
            preferred_denominator_units=(activity.activity.unit,),
            allow_fallback_geography=self._allow_fallback_geography(template),
        )
        return factors.select_best(query, trace=trace.defaults_applied)

    def _split_factor_unit(self, factor_unit: str) -> tuple[str, str]:
        numerator, denominator = [x.strip() for x in factor_unit.split("/")]
        return numerator, denominator

    def _is_energy_unit(self, ureg, unit_label: str) -> bool:
        try:
            qty = parse_qty(ureg, 1.0, unit_label)
        except Exception:
            return unit_label.strip().lower() in ENERGY_DENOMINATORS
        return qty.check("[mass] * [length] ** 2 / [time] ** 2")

    def _build_result_row(
        self,
        *,
        activity: ActivityRecord,
        activity_def: ActivityTypeDefinition,
        accounting_method: str,
        gas: str,
        value: float,
        factor_ids: list[str],
        time_bucket: str | None,
        method_id: str,
    ) -> ResultRecord:
        return ResultRecord(
            facility_id=activity.facility_id,
            activity_type_id=activity.activity_type_id,
            activity_label=activity_def.label,
            scope=activity_def.scope,
            protocol_category_code=activity_def.protocol_category_code,
            protocol_category_label=activity_def.protocol_category_label,
            activity_group=activity_def.ui_metadata.get("group"),
            source_type=activity_def.source_type,
            accounting_method=accounting_method,
            gas=gas,
            value=value,
            unit="kg",
            is_biogenic=activity_def.is_biogenic_default and gas == "co2",
            method_id=method_id,
            factor_ids=factor_ids,
            time_bucket=time_bucket,
        )
