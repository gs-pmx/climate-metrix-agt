from __future__ import annotations

from collections import defaultdict

from ..activity_catalog import ActivityTypeDefinition, FactorQueryTemplate
from ..domain import ResolvedActivity
from ..factors import FactorQuery, FactorRepository
from ..gwp import get_gwp_set
from ..models import ResultRecord, TraceRecord
from ..time_utils import observation_bucket
from ..units import parse_qty, to_unit
from .base import EQMPlugin, default_ureg
from .context import geo_context, gwp_set, inventory_period, inventory_year

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
        return {
            "type": "object",
            "properties": {
                "emission_factor_override": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "number"},
                        "unit": {"type": "string"},
                    },
                    "required": ["value", "unit"],
                },
                "emission_factor_override_source": {"type": "string"},
            },
            "required": [],
        }

    def applicability(self, resolved: ResolvedActivity, activity_def: ActivityTypeDefinition) -> bool:
        del resolved
        return activity_def.method_id == self.id

    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        template_groups = self._group_templates(activity_def)
        return self.compute_from_template_groups(
            resolved=resolved,
            activity_def=activity_def,
            factors=factors,
            template_groups=template_groups,
            selected_method=self.id,
        )

    def compute_from_template_groups(
        self,
        *,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
        template_groups: dict[str, list[FactorQueryTemplate]],
        selected_method: str,
        result_method_id: str | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        observation = resolved.observation
        traces = TraceRecord(
            activity_type_id=observation.activity_type_id,
            activity_label=activity_def.label,
            selected_method=selected_method,
        )
        results: list[ResultRecord] = []
        bucket = observation_bucket(observation, inventory_year(resolved), "month")
        gwp = get_gwp_set(gwp_set(resolved))
        ureg = default_ureg()

        for accounting_method, templates in template_groups.items():
            manual_override = self._get_manual_factor_override(resolved, accounting_method)
            if manual_override is not None:
                results.extend(
                    self._compute_manual_override(
                        resolved=resolved,
                        activity_def=activity_def,
                        factors=factors,
                        template=templates[0] if templates else self._fallback_template(activity_def),
                        accounting_method=accounting_method,
                        param_key=manual_override["param_key"],
                        factor_value=float(manual_override["value"]),
                        factor_unit=str(manual_override["unit"]),
                        factor_source=manual_override["source"],
                        trace=traces,
                        time_bucket=bucket,
                        method_id=result_method_id or selected_method,
                    )
                )
                continue
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
                        resolved=resolved,
                        template=template,
                        attribute=raw_attribute,
                        accounting_method=accounting_method,
                        trace=traces,
                    )
                    if factor is None:
                        continue
                    try:
                        denom_qty, numerator = self._activity_to_factor_denominator(
                            resolved=resolved,
                            factor_unit=factor.unit,
                            ureg=ureg,
                            factors=factors,
                            activity_def=activity_def,
                            template=template,
                            trace=traces,
                        )
                    except Exception:
                        traces.defaults_applied.append(
                            f"skipped {gas} factor {factor.factor_id}: "
                            f"cannot convert activity unit '{observation.quantity.unit}' to factor denominator"
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
                            resolved=resolved,
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
                    resolved=resolved,
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

    def _get_manual_factor_override(
        self,
        resolved: ResolvedActivity,
        accounting_method: str,
    ) -> dict[str, str | float] | None:
        params = resolved.observation.params
        for param_key, source_key in self._manual_override_keys(accounting_method):
            raw = params.get(param_key)
            if not isinstance(raw, dict):
                continue
            value = raw.get("value")
            unit = str(raw.get("unit") or "").strip()
            if value in (None, "") or not unit:
                continue
            return {
                "param_key": param_key,
                "value": float(value),
                "unit": unit,
                "source": str(params.get(source_key) or "").strip(),
            }
        return None

    def _manual_override_keys(self, accounting_method: str) -> list[tuple[str, str]]:
        if accounting_method == "market_based":
            return [("market_based_emission_factor", "market_based_emission_factor_source")]
        if accounting_method == "location_based":
            return [("location_based_emission_factor", "location_based_emission_factor_source")]
        return [("emission_factor_override", "emission_factor_override_source")]

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
        resolved: ResolvedActivity,
        template: FactorQueryTemplate,
        attribute: str,
        accounting_method: str,
        trace: TraceRecord,
    ):
        observation = resolved.observation
        preferred_denoms = (observation.quantity.unit,)
        normalized_attribute = attribute.replace("-", "_")
        query_type = template.type or activity_def.source_type
        if query_type is None:
            raise ValueError(f"{activity_def.activity_type_id} is missing factor query type")
        emission_category = activity_def.emission_category
        if not emission_category:
            raise ValueError(f"{activity_def.activity_type_id} is missing emission_category")
        period_start, period_end = inventory_period(resolved)
        query = FactorQuery(
            role="emission_factor",
            emission_category=emission_category,
            type=query_type,
            description=template.description or activity_def.factor_description,
            attribute=normalized_attribute,
            greenhouse_gas=ATTRIBUTE_TO_GAS.get(attribute),
            life_cycle_stage=template.life_cycle_stage,
            inventory_year=inventory_year(resolved),
            period_start=period_start,
            period_end=period_end,
            accounting_method=accounting_method,
            geo=geo_context(resolved),
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

    def _compute_manual_override(
        self,
        *,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
        template: FactorQueryTemplate,
        accounting_method: str,
        param_key: str,
        factor_value: float,
        factor_unit: str,
        factor_source: str,
        trace: TraceRecord,
        time_bucket: str | None,
        method_id: str,
    ) -> list[ResultRecord]:
        if "/" not in factor_unit:
            raise ValueError(f"{param_key} must include a mass-per-activity unit such as kg/kwh")
        ureg = default_ureg()
        denom_qty, numerator = self._activity_to_factor_denominator(
            resolved=resolved,
            factor_unit=factor_unit,
            ureg=ureg,
            factors=factors,
            activity_def=activity_def,
            template=template,
            trace=trace,
        )
        _, denominator = self._split_factor_unit(factor_unit)
        factor_q = parse_qty(ureg, factor_value, numerator) / parse_qty(ureg, 1.0, denominator)
        mass_kg = (denom_qty * factor_q).to("kilogram").magnitude
        source_note = f" from {factor_source}" if factor_source else ""
        trace.defaults_applied.append(
            f"manual factor override: used params.{param_key} ({factor_value} {factor_unit}){source_note}"
        )
        return [
            self._build_result_row(
                resolved=resolved,
                activity_def=activity_def,
                accounting_method=accounting_method,
                gas="co2e",
                value=float(mass_kg),
                factor_ids=[],
                time_bucket=time_bucket,
                method_id=method_id,
            )
        ]

    def _activity_to_factor_denominator(
        self,
        *,
        resolved: ResolvedActivity,
        factor_unit: str,
        ureg,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        template: FactorQueryTemplate,
        trace: TraceRecord,
    ):
        observation = resolved.observation
        numerator, denominator = self._split_factor_unit(factor_unit)
        qty = parse_qty(ureg, observation.quantity.value, observation.quantity.unit)
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
            resolved=resolved,
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
            "converted "
            f"{observation.quantity.value} {observation.quantity.unit} to {denominator} "
            f"via heat-content factor {heat_factor.factor_id}"
        )
        return denom_qty, numerator

    def _query_heat_content_factor(
        self,
        *,
        factors: FactorRepository,
        activity_def: ActivityTypeDefinition,
        resolved: ResolvedActivity,
        template: FactorQueryTemplate,
        trace: TraceRecord,
    ):
        observation = resolved.observation
        query_type = template.type or activity_def.source_type
        if query_type is None:
            return None
        period_start, period_end = inventory_period(resolved)
        query = FactorQuery(
            role="heat_content",
            emission_category=activity_def.emission_category or "",
            type=query_type,
            description=template.description or activity_def.factor_description,
            attribute="heat_content",
            greenhouse_gas=None,
            inventory_year=inventory_year(resolved),
            period_start=period_start,
            period_end=period_end,
            geo=geo_context(resolved),
            preferred_denominator_units=(observation.quantity.unit,),
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
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        accounting_method: str,
        gas: str,
        value: float,
        factor_ids: list[str],
        time_bucket: str | None,
        method_id: str,
    ) -> ResultRecord:
        observation = resolved.observation
        return ResultRecord(
            facility_id=observation.locus_id,
            activity_type_id=observation.activity_type_id,
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
