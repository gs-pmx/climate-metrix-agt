"""Reporting-unit applicability — domain service.

A Reporting Unit (RU) carries an optional ``applicable_activity_types``
checklist. The product rules:

* Empty list (or unset) means **legacy permissive** — every activity
  flows through. Snapshots saved before the Phase C2 feature shipped
  look like this.
* Non-empty list means **explicit checklist** — only the listed
  ``activity_type_id`` values are applicable to that RU.
* Reporting units that don't appear in the map are treated permissively.

Pre-PR-B these helpers lived in ``ghg_engine/infrastructure/sqlite_inventory.py``
as private functions used during snapshot materialization. PR B promotes
them into a shared service so the API calc routes can enforce the same
rule before invoking the engine — defense-in-depth against direct API
callers and stale frontends.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ghg_engine.models import ProjectSnapshot

if TYPE_CHECKING:
    from project_store import ProjectStore

log = logging.getLogger(__name__)

ApplicabilityMap = dict[str, frozenset[str] | None]


def build_applicability_map(snapshot: ProjectSnapshot) -> ApplicabilityMap:
    """Build ``{facility_id: allowed activity_type_ids | None}`` from a snapshot.

    ``None`` for an entry means "legacy permissive — show all".
    A ``frozenset`` means "only these ``activity_type_id`` values
    are applicable". RUs not in the snapshot are absent from the map
    and are treated permissively when read via ``is_applicable``.
    """
    result: ApplicabilityMap = {}
    for unit in snapshot.reporting_units:
        allowed = tuple(unit.applicable_activity_types or ())
        result[unit.id] = frozenset(allowed) if allowed else None
    return result


def is_applicable(
    applicability: ApplicabilityMap | None,
    facility_id: str,
    activity_type_id: str,
) -> bool:
    """Return ``True`` when ``(facility_id, activity_type_id)`` is applicable.

    * ``applicability is None`` short-circuits to ``True`` — used for
      the "no map at all" case in calc routes.
    * Unknown reporting units return ``True`` — they have no checklist
      so we don't silently drop their rows.
    * Known RUs with an empty / ``None`` entry also return ``True``
      (legacy permissive).
    """
    if applicability is None:
        return True
    allowed = applicability.get(facility_id)
    if allowed is None:
        return True
    return activity_type_id in allowed


def normalize_payload_applicability(
    raw: dict[str, list[str] | None] | None,
) -> ApplicabilityMap | None:
    """Convert the API's wire shape (``dict[str, list[str] | None] | None``)
    into the internal ``ApplicabilityMap``.

    Two distinct cases on the wire (kept distinct intentionally — see
    the PR description):

    * ``raw is None`` (field omitted in the payload) → returns ``None``.
      Callers interpret this as "missing — fall back to stored state".
    * ``raw == {}`` (field present but empty) → returns ``{}``.
      Callers interpret this as "explicit, no per-RU rules — fully
      permissive, do not fall back".

    Per-RU values:

    * ``None`` or empty list → entry is ``None`` (permissive for that RU).
    * Non-empty list → ``frozenset`` of the activity_type_ids.
    """
    if raw is None:
        return None
    result: ApplicabilityMap = {}
    for facility_id, activity_ids in raw.items():
        if activity_ids is None or len(activity_ids) == 0:
            result[facility_id] = None
        else:
            result[facility_id] = frozenset(activity_ids)
    return result


def resolve_applicability(
    *,
    payload_applicability: dict[str, list[str] | None] | None,
    project_id: str | None,
    store: ProjectStore | None,
) -> ApplicabilityMap | None:
    """Resolve the applicability map per the PR-B fallback chain.

    Order of precedence:

    1. **Payload-provided** — payload_applicability is not ``None``
       (even ``{}`` counts; see ``normalize_payload_applicability``
       for the None-vs-empty distinction).
    2. **Latest project draft** — when a ``project_id`` is set and
       a draft snapshot is on disk.
    3. **Latest saved snapshot** — when no draft exists.
    4. **Permissive (return ``None``)** — when nothing else is
       available; the engine will not filter anything.

    Each fallback step is best-effort: if the store call fails or the
    snapshot is missing reporting_units, we move to the next step
    rather than surfacing the error to the caller. The motivating
    use case is "calculate the inventory I'm staring at" — applicability
    enforcement should never block a request the engine would otherwise
    accept.
    """
    if payload_applicability is not None:
        return normalize_payload_applicability(payload_applicability)
    if project_id is None or store is None:
        return None

    snapshot = _load_snapshot_for_applicability(store, project_id)
    if snapshot is not None:
        return build_applicability_map(snapshot)
    return None


def _load_snapshot_for_applicability(
    store: ProjectStore,
    project_id: str,
) -> ProjectSnapshot | None:
    """Try the draft buffer first, then the latest saved snapshot.

    Returns ``None`` if neither path yields a usable ``ProjectSnapshot``.
    All exceptions are logged and swallowed — applicability fallback is
    never load-bearing for a calc request.
    """
    try:
        draft = store.load_project_draft(project_id)
    except Exception:  # noqa: BLE001 — fallback must not raise
        log.warning(
            "applicability fallback: load_project_draft failed for %s", project_id,
            exc_info=True,
        )
        draft = None
    snapshot = _coerce_snapshot(draft.get("snapshot") if draft else None)
    if snapshot is not None:
        return snapshot

    try:
        latest = store.get_version_snapshot(project_id)
    except Exception:  # noqa: BLE001
        log.warning(
            "applicability fallback: get_version_snapshot failed for %s", project_id,
            exc_info=True,
        )
        return None
    return _coerce_snapshot(latest.get("snapshot") if latest else None)


def _coerce_snapshot(raw: dict | None) -> ProjectSnapshot | None:
    if not raw:
        return None
    try:
        return ProjectSnapshot.model_validate(raw)
    except Exception:  # noqa: BLE001
        log.warning("applicability fallback: snapshot did not validate", exc_info=True)
        return None


__all__ = [
    "ApplicabilityMap",
    "build_applicability_map",
    "is_applicable",
    "normalize_payload_applicability",
    "resolve_applicability",
]
