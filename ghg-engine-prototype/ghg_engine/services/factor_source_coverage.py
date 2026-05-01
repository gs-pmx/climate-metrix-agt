from __future__ import annotations

import json
from typing import Any

from ghg_engine.activity_catalog import ActivityTypeDefinition, FactorQueryTemplate


def build_factor_source_coverage(
    activity_types: list[ActivityTypeDefinition],
    factor_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Summarize active emission-factor source coverage by catalog category.

    This is intentionally a source-level audit view, not a factor dump. The
    activity catalog defines what Climate Metrix covers; published factor rows
    tell us which sources, years, attributes, and review metadata back those
    categories.
    """

    grouped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for activity in activity_types:
        needs = _activity_factor_needs(activity)
        if not needs:
            continue
        for need in needs:
            key = (
                activity.category,
                str(activity.scope),
                need["factor_domain"],
                need["accounting_method"],
            )
            bucket = grouped.setdefault(
                key,
                {
                    "id": _row_id(*key),
                    "category": activity.category,
                    "scope": str(activity.scope),
                    "factor_domain": need["factor_domain"],
                    "accounting_method": need["accounting_method"],
                    "activity_type_ids": set(),
                    "activity_labels": set(),
                    "expected_attributes": set(),
                    "unmatched_activity_type_ids": set(),
                    "matched_factor_ids": set(),
                    "sources": set(),
                    "dataset_keys": set(),
                    "version_labels": set(),
                    "data_years": set(),
                    "attributes": set(),
                    "factor_types": set(),
                    "refresh_policies": set(),
                    "next_review_dates": set(),
                    "statuses": set(),
                    "notes": set(),
                },
            )
            bucket["activity_type_ids"].add(activity.activity_type_id)
            bucket["activity_labels"].add(activity.label)
            bucket["expected_attributes"].update(need["attributes"])

            matches = [row for row in factor_rows if _matches_need(row, need)]
            if not matches:
                bucket["unmatched_activity_type_ids"].add(activity.activity_type_id)
                bucket["notes"].add("No published factor source matched one or more catalog templates.")
                continue
            for row in matches:
                factor_id = str(row.get("factor_version_id") or row.get("source_record_key") or "")
                if factor_id:
                    bucket["matched_factor_ids"].add(factor_id)
                source = row.get("source_id") or row.get("source_name")
                if source:
                    bucket["sources"].add(str(source))
                if row.get("dataset_key"):
                    bucket["dataset_keys"].add(str(row["dataset_key"]))
                if row.get("version_label"):
                    bucket["version_labels"].add(str(row["version_label"]))
                if row.get("data_year") is not None:
                    bucket["data_years"].add(int(row["data_year"]))
                if row.get("attribute"):
                    bucket["attributes"].add(_normalize_attribute(row["attribute"]))
                if row.get("factor_type"):
                    bucket["factor_types"].add(str(row["factor_type"]))
                if row.get("status"):
                    bucket["statuses"].add(str(row["status"]))
                metadata = _metadata(row)
                maintenance = metadata.get("maintenance", {})
                if isinstance(maintenance, dict):
                    if maintenance.get("review_cycle"):
                        bucket["refresh_policies"].add(str(maintenance["review_cycle"]))
                    if maintenance.get("next_review_date"):
                        bucket["next_review_dates"].add(str(maintenance["next_review_date"]))

    rows = [_finalize_row(bucket) for bucket in grouped.values()]
    return sorted(rows, key=lambda row: (row["category"], row["scope"], row["factor_domain"], row["accounting_method"]))


def _activity_factor_needs(activity: ActivityTypeDefinition) -> list[dict[str, Any]]:
    if activity.method_id == "spend_based" or activity.emission_category == "spend-based":
        return [
            {
                "factor_kind": "spend",
                "factor_domain": "spend-based",
                "factor_type": None,
                "description": None,
                "life_cycle_stage": None,
                "accounting_method": "none",
                "attributes": {"co2e_ef"},
            }
        ]
    return [_template_need(template) for template in activity.factor_query_templates]


def _template_need(template: FactorQueryTemplate) -> dict[str, Any]:
    return {
        "factor_kind": "physical",
        "factor_domain": template.domain,
        "factor_type": template.type,
        "description": template.description,
        "life_cycle_stage": template.life_cycle_stage,
        "accounting_method": template.accounting_method or "none",
        "attributes": {_normalize_attribute(attribute) for attribute in template.attributes},
    }


def _matches_need(row: dict[str, Any], need: dict[str, Any]) -> bool:
    if str(row.get("factor_kind") or "physical") != need["factor_kind"]:
        return False
    if str(row.get("emission_category") or "") != need["factor_domain"]:
        return False
    if need["factor_type"] is not None and str(row.get("factor_type") or "") != str(need["factor_type"]):
        return False
    if need["description"] is not None and str(row.get("subtype_or_description") or "") != str(need["description"]):
        return False
    if not _life_cycle_stage_matches(
        row.get("life_cycle_stage"),
        need["life_cycle_stage"],
        need["factor_domain"],
    ):
        return False
    if need["accounting_method"] != "none" and str(row.get("accounting_method") or "none") != need["accounting_method"]:
        return False
    if need["attributes"] and _normalize_attribute(row.get("attribute")) not in need["attributes"]:
        return False
    return True


def _life_cycle_stage_matches(row_stage: Any, need_stage: Any, factor_domain: str) -> bool:
    if need_stage is None:
        return True
    normalized_row_stage = str(row_stage or "")
    normalized_need_stage = str(need_stage)
    if normalized_row_stage == normalized_need_stage:
        return True
    return (
        factor_domain == "electricity-generation"
        and normalized_need_stage == "generation"
        and normalized_row_stage == "direct"
    )


def _finalize_row(bucket: dict[str, Any]) -> dict[str, Any]:
    expected_attributes = set(bucket["expected_attributes"])
    matched_attributes = set(bucket["attributes"])
    has_unmatched_templates = bool(bucket["unmatched_activity_type_ids"])
    if not bucket["sources"]:
        coverage_status = "missing"
    elif has_unmatched_templates or (expected_attributes and not expected_attributes.issubset(matched_attributes)):
        coverage_status = "partial"
        missing = sorted(expected_attributes - matched_attributes)
        if missing:
            bucket["notes"].add(f"Missing expected attributes: {', '.join(missing)}.")
    else:
        coverage_status = "available"

    return {
        "id": bucket["id"],
        "category": bucket["category"],
        "scope": bucket["scope"],
        "factor_domain": bucket["factor_domain"],
        "accounting_method": bucket["accounting_method"],
        "activity_type_ids": sorted(bucket["activity_type_ids"]),
        "activity_labels": sorted(bucket["activity_labels"]),
        "activity_type_count": len(bucket["activity_type_ids"]),
        "sources": sorted(bucket["sources"]),
        "dataset_keys": sorted(bucket["dataset_keys"]),
        "version_labels": sorted(bucket["version_labels"]),
        "data_years": sorted(bucket["data_years"]),
        "attributes": sorted(matched_attributes),
        "expected_attributes": sorted(expected_attributes),
        "factor_types": sorted(bucket["factor_types"]),
        "factor_count": len(bucket["matched_factor_ids"]),
        "refresh_policies": sorted(bucket["refresh_policies"]),
        "next_review_dates": sorted(bucket["next_review_dates"]),
        "statuses": sorted(bucket["statuses"]),
        "coverage_status": coverage_status,
        "notes": " ".join(sorted(bucket["notes"])),
    }


def _metadata(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("extra_json")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(str(raw))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_attribute(attribute: Any) -> str:
    return str(attribute or "").replace("-", "_")


def _row_id(*parts: str) -> str:
    normalized = [part.lower().replace(" ", "_").replace("/", "_") for part in parts]
    return "::".join(normalized)
