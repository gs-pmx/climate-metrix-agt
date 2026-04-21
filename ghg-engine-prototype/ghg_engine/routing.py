from __future__ import annotations

import pandas as pd

from .activity_catalog import ActivityCatalog, ActivityTypeDefinition, ImplementationStatus
from .models import ActivityRecord, RoutingRow


class RoutingCatalog:
    def __init__(self, rows: list[RoutingRow]):
        self.rows = rows
        self._by_source_id: dict[str, RoutingRow] = {}
        self._by_activity_type_id: dict[str, RoutingRow] = {}
        self._by_legacy_source_id: dict[str, list[RoutingRow]] = {}
        for row in rows:
            if row.source_id in self._by_source_id:
                raise ValueError(f"duplicate source_id '{row.source_id}' in routing catalog")
            self._by_source_id[row.source_id] = row
            if row.activity_type_id:
                if row.activity_type_id in self._by_activity_type_id:
                    raise ValueError(f"duplicate activity_type_id '{row.activity_type_id}' in routing catalog")
                self._by_activity_type_id[row.activity_type_id] = row
            for legacy_source_id in row.legacy_source_ids:
                self._by_legacy_source_id.setdefault(legacy_source_id, []).append(row)

    @classmethod
    def from_csv(cls, path: str) -> RoutingCatalog:
        df = pd.read_csv(path)
        rows: list[RoutingRow] = []
        for _, r in df.iterrows():
            rows.append(
                RoutingRow(
                    activity_type_id=(
                        None if pd.isna(r.get("activity_type_id")) else str(r.get("activity_type_id"))
                    ),
                    source_id=str(r.get("source_id")),
                    legacy_source_ids=[],
                    label=str(r.get("label")),
                    source_type=str(r.get("source_type")),
                    scope=str(r.get("scope")),
                    metric_group=str(r.get("metric_group")),
                    metric_subgroup=(None if pd.isna(r.get("metric_subgroup")) else str(r.get("metric_subgroup"))),
                    is_biogenic=bool(r.get("is_biogenic")) if not pd.isna(r.get("is_biogenic")) else False,
                    default_unit=str(r.get("default_unit")),
                    allowed_units=[],
                    method_id=str(r.get("method_id")),
                    emission_category=str(r.get("emission_category")),
                    factor_description=(
                        None
                        if pd.isna(r.get("factor_description"))
                        else str(r.get("factor_description"))
                    ),
                    implementation_status=None,
                )
            )
        return cls(rows)

    @classmethod
    def from_activity_catalog(
        cls,
        activity_catalog: ActivityCatalog,
        *,
        legacy_catalog: RoutingCatalog | None = None,
        include_statuses: tuple[ImplementationStatus, ...] = ("implemented", "partial"),
    ) -> RoutingCatalog:
        rows: list[RoutingRow] = []
        for activity in activity_catalog.rows:
            if activity.implementation_status not in include_statuses:
                continue
            row = cls._bridge_activity(activity, legacy_catalog)
            if row is None:
                continue
            rows.append(row)
        return cls(rows)

    @staticmethod
    def _find_legacy_bridge(
        activity: ActivityTypeDefinition,
        legacy_catalog: RoutingCatalog | None,
    ) -> RoutingRow | None:
        if legacy_catalog is None:
            return None
        for source_id in [*activity.legacy_source_ids, activity.source_id]:
            row = legacy_catalog._by_source_id.get(source_id)
            if row is not None:
                return row
        return None

    @classmethod
    def _bridge_activity(
        cls,
        activity: ActivityTypeDefinition,
        legacy_catalog: RoutingCatalog | None,
    ) -> RoutingRow | None:
        bridge = cls._find_legacy_bridge(activity, legacy_catalog)
        runtime_method_id = bridge.method_id if bridge is not None else activity.method_id
        if runtime_method_id not in {"direct_factor", "miles_to_fuel"}:
            return None
        runtime_source_type = bridge.source_type if bridge is not None else (activity.source_type or "")
        runtime_metric_group = bridge.metric_group if bridge is not None else activity.metric_group
        runtime_metric_subgroup = bridge.metric_subgroup if bridge is not None else activity.metric_subgroup
        runtime_emission_category = (
            bridge.emission_category if bridge is not None else (activity.emission_category or "")
        )
        if not runtime_source_type or not runtime_emission_category:
            return None
        runtime_factor_description = bridge.factor_description if bridge is not None else activity.factor_description
        return RoutingRow(
            activity_type_id=activity.activity_type_id,
            source_id=activity.source_id,
            legacy_source_ids=list(activity.legacy_source_ids),
            label=activity.label,
            source_type=runtime_source_type,
            scope=activity.scope,
            metric_group=runtime_metric_group,
            metric_subgroup=runtime_metric_subgroup,
            is_biogenic=activity.is_biogenic_default,
            default_unit=activity.default_unit,
            allowed_units=list(activity.allowed_units),
            method_id=runtime_method_id,
            emission_category=runtime_emission_category,
            factor_description=runtime_factor_description,
            implementation_status=activity.implementation_status,
        )

    def resolve(self, activity: ActivityRecord) -> RoutingRow:
        if activity.activity_type_id:
            by_activity_type_id = self._by_activity_type_id.get(activity.activity_type_id)
            if by_activity_type_id:
                return by_activity_type_id
        if activity.source_id:
            by_id = self._by_source_id.get(activity.source_id)
            if by_id:
                return by_id
            by_legacy_id = self._by_legacy_source_id.get(activity.source_id, [])
            if len(by_legacy_id) == 1:
                return by_legacy_id[0]
            if len(by_legacy_id) > 1:
                raise KeyError(
                    f"legacy source_id '{activity.source_id}' is ambiguous; provide activity_type_id"
                )
        matches = [
            r for r in self.rows
            if r.source_type == activity.source_type
            and r.metric_group == activity.metric_group
            and (r.metric_subgroup or None) == (activity.metric_subgroup or None)
            and r.scope == activity.scope
        ]
        if len(matches) == 0:
            raise KeyError(
                "No routing row match for source_type="
                f"{activity.source_type}, metric_group={activity.metric_group}, "
                f"metric_subgroup={activity.metric_subgroup}, scope={activity.scope}"
            )
        if len(matches) > 1:
            raise KeyError(f"Multiple routing rows matched activity; provide source_id. count={len(matches)}")
        return matches[0]
