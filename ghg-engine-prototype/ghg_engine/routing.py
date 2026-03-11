from __future__ import annotations

import pandas as pd

from .models import ActivityRecord, RoutingRow


class RoutingCatalog:
    def __init__(self, rows: list[RoutingRow]):
        self.rows = rows

    @classmethod
    def from_csv(cls, path: str) -> RoutingCatalog:
        df = pd.read_csv(path)
        rows: list[RoutingRow] = []
        for _, r in df.iterrows():
            rows.append(
                RoutingRow(
                    source_id=str(r.get("source_id")),
                    label=str(r.get("label")),
                    source_type=str(r.get("source_type")),
                    scope=str(r.get("scope")),
                    metric_group=str(r.get("metric_group")),
                    metric_subgroup=(None if pd.isna(r.get("metric_subgroup")) else str(r.get("metric_subgroup"))),
                    is_biogenic=bool(r.get("is_biogenic")) if not pd.isna(r.get("is_biogenic")) else False,
                    default_unit=str(r.get("default_unit")),
                    method_id=str(r.get("method_id")),
                    emission_category=str(r.get("emission_category")),
                    factor_description=(
                        None
                        if pd.isna(r.get("factor_description"))
                        else str(r.get("factor_description"))
                    ),
                )
            )
        return cls(rows)

    def resolve(self, activity: ActivityRecord) -> RoutingRow:
        if activity.source_id:
            by_id = [r for r in self.rows if r.source_id == activity.source_id]
            if by_id:
                return by_id[0]
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
