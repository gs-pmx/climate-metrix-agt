"""PR B unit tests for the applicability service.

These exercise the pure helpers without touching FastAPI / SQLite.
The end-to-end behavior is covered separately in
``tests/test_calculation_applicability.py`` via TestClient.
"""

from __future__ import annotations

from typing import Any

import pytest

from ghg_engine.models import ProjectSnapshot, ReportingUnitDraft
from ghg_engine.services.applicability import (
    build_applicability_map,
    is_applicable,
    normalize_payload_applicability,
    resolve_applicability,
)


def _snapshot(reporting_units: list[ReportingUnitDraft]) -> ProjectSnapshot:
    """Minimal snapshot fixture — only ``reporting_units`` matters here."""

    return ProjectSnapshot(reporting_units=reporting_units)


def _ru(id_: str, applicable: list[str] | None = None) -> ReportingUnitDraft:
    return ReportingUnitDraft(
        id=id_,
        facility_name=id_,
        applicable_activity_types=applicable or [],
    )


# ---------------------------------------------------------------------------
# build_applicability_map
# ---------------------------------------------------------------------------


def test_build_applicability_map_legacy_permissive_ru_maps_to_none():
    snapshot = _snapshot([_ru("ru_1", applicable=[])])
    result = build_applicability_map(snapshot)
    assert result == {"ru_1": None}


def test_build_applicability_map_explicit_checklist_maps_to_frozenset():
    snapshot = _snapshot([_ru("ru_1", applicable=["scope1_mobile_gasoline", "scope2_grid"])])
    result = build_applicability_map(snapshot)
    assert result == {"ru_1": frozenset({"scope1_mobile_gasoline", "scope2_grid"})}


def test_build_applicability_map_mixed_units():
    snapshot = _snapshot(
        [_ru("legacy", applicable=[]), _ru("checked", applicable=["scope1_mobile_gasoline"])]
    )
    result = build_applicability_map(snapshot)
    assert result == {
        "legacy": None,
        "checked": frozenset({"scope1_mobile_gasoline"}),
    }


# ---------------------------------------------------------------------------
# is_applicable
# ---------------------------------------------------------------------------


def test_is_applicable_short_circuits_when_map_is_none():
    """Calc routes pass ``None`` when no applicability is in play; every
    activity is applicable."""

    assert is_applicable(None, "any_ru", "any_activity") is True


def test_is_applicable_unknown_ru_is_permissive():
    """RUs not in the map have no checklist — they get every activity."""

    applicability = {"ru_1": frozenset({"scope1_mobile_gasoline"})}
    assert is_applicable(applicability, "ru_999", "scope3_business_travel") is True


def test_is_applicable_legacy_permissive_entry_lets_everything_through():
    applicability = {"ru_1": None}
    assert is_applicable(applicability, "ru_1", "anything") is True


def test_is_applicable_explicit_checklist_filters():
    applicability = {"ru_1": frozenset({"scope1_mobile_gasoline"})}
    assert is_applicable(applicability, "ru_1", "scope1_mobile_gasoline") is True
    assert is_applicable(applicability, "ru_1", "scope2_grid") is False


# ---------------------------------------------------------------------------
# normalize_payload_applicability — the wire-shape converter
# ---------------------------------------------------------------------------


def test_normalize_payload_none_passes_through_as_none():
    """Field omitted on the wire stays ``None`` so callers run the
    fallback chain."""

    assert normalize_payload_applicability(None) is None


def test_normalize_payload_empty_dict_stays_empty_dict():
    """Field present but empty is an explicit "no rules" signal — distinct
    from the missing/None case."""

    assert normalize_payload_applicability({}) == {}


def test_normalize_payload_per_ru_none_or_empty_becomes_permissive_entry():
    raw = {"ru_a": None, "ru_b": []}
    result = normalize_payload_applicability(raw)
    assert result == {"ru_a": None, "ru_b": None}


def test_normalize_payload_explicit_lists_become_frozensets():
    raw = {"ru_a": ["scope1_mobile_gasoline", "scope2_grid"]}
    result = normalize_payload_applicability(raw)
    assert result == {"ru_a": frozenset({"scope1_mobile_gasoline", "scope2_grid"})}


# ---------------------------------------------------------------------------
# resolve_applicability — fallback chain
# ---------------------------------------------------------------------------


class _FakeStore:
    """Minimal ProjectStore stand-in for resolve_applicability tests."""

    def __init__(
        self,
        *,
        draft: dict[str, Any] | None = None,
        version: dict[str, Any] | None = None,
        draft_raises: Exception | None = None,
        version_raises: Exception | None = None,
    ) -> None:
        self._draft = draft
        self._version = version
        self._draft_raises = draft_raises
        self._version_raises = version_raises
        self.draft_calls = 0
        self.version_calls = 0

    def load_project_draft(self, project_id: str) -> dict[str, Any] | None:
        self.draft_calls += 1
        if self._draft_raises is not None:
            raise self._draft_raises
        return self._draft

    def get_version_snapshot(
        self, project_id: str, version_number: int | None = None
    ) -> dict[str, Any]:
        self.version_calls += 1
        if self._version_raises is not None:
            raise self._version_raises
        return self._version or {}


def _snapshot_dict(reporting_units: list[dict[str, Any]]) -> dict[str, Any]:
    # Match the snapshot's serialization alias — ``facilities``, not
    # ``reporting_units`` — so the model_validate path works the same as
    # if the data came from disk via ProjectStore.
    return {"facilities": reporting_units}


def test_resolve_payload_wins_over_stored_state():
    store = _FakeStore(
        draft={"snapshot": _snapshot_dict([{"id": "ru_1", "applicable_activity_types": ["draft_activity"]}])},
    )
    result = resolve_applicability(
        payload_applicability={"ru_1": ["payload_activity"]},
        project_id="proj_1",
        store=store,
    )
    # Payload checklist wins — stored draft never consulted.
    assert result == {"ru_1": frozenset({"payload_activity"})}
    assert store.draft_calls == 0
    assert store.version_calls == 0


def test_resolve_empty_dict_payload_wins_over_stored_state():
    """Empty dict is ``explicit, no fallback`` — store should not be hit."""

    store = _FakeStore(
        draft={"snapshot": _snapshot_dict([{"id": "ru_1", "applicable_activity_types": ["x"]}])},
    )
    result = resolve_applicability(
        payload_applicability={},
        project_id="proj_1",
        store=store,
    )
    assert result == {}
    assert store.draft_calls == 0
    assert store.version_calls == 0


def test_resolve_falls_back_to_draft_when_payload_omitted():
    store = _FakeStore(
        draft={
            "snapshot": _snapshot_dict(
                [{"id": "ru_1", "applicable_activity_types": ["scope1_mobile_gasoline"]}]
            )
        },
    )
    result = resolve_applicability(
        payload_applicability=None,
        project_id="proj_1",
        store=store,
    )
    assert result == {"ru_1": frozenset({"scope1_mobile_gasoline"})}
    assert store.draft_calls == 1
    # Latest snapshot not consulted because the draft resolved first.
    assert store.version_calls == 0


def test_resolve_falls_back_to_latest_snapshot_when_no_draft():
    store = _FakeStore(
        draft=None,
        version={
            "snapshot": _snapshot_dict(
                [{"id": "ru_1", "applicable_activity_types": ["scope2_grid"]}]
            )
        },
    )
    result = resolve_applicability(
        payload_applicability=None,
        project_id="proj_1",
        store=store,
    )
    assert result == {"ru_1": frozenset({"scope2_grid"})}
    assert store.draft_calls == 1
    assert store.version_calls == 1


def test_resolve_returns_none_when_nothing_in_store():
    store = _FakeStore(draft=None, version=None)
    result = resolve_applicability(
        payload_applicability=None,
        project_id="proj_1",
        store=store,
    )
    assert result is None


def test_resolve_returns_none_when_no_project_id():
    store = _FakeStore(
        draft={"snapshot": _snapshot_dict([{"id": "ru_1", "applicable_activity_types": ["x"]}])},
    )
    result = resolve_applicability(
        payload_applicability=None,
        project_id=None,
        store=store,
    )
    assert result is None
    # Without a project_id we can't load anything — must not have called.
    assert store.draft_calls == 0


def test_resolve_swallows_store_errors_and_keeps_going():
    """Applicability fallback must never break a calc request — if the
    draft load raises, we move on to the snapshot, then permissive."""

    store = _FakeStore(
        draft_raises=RuntimeError("boom"),
        version={
            "snapshot": _snapshot_dict(
                [{"id": "ru_1", "applicable_activity_types": ["scope2_grid"]}]
            )
        },
    )
    result = resolve_applicability(
        payload_applicability=None,
        project_id="proj_1",
        store=store,
    )
    assert result == {"ru_1": frozenset({"scope2_grid"})}


def test_resolve_swallows_both_store_errors_and_returns_permissive():
    store = _FakeStore(
        draft_raises=RuntimeError("draft boom"),
        version_raises=RuntimeError("version boom"),
    )
    result = resolve_applicability(
        payload_applicability=None,
        project_id="proj_1",
        store=store,
    )
    assert result is None


@pytest.mark.parametrize(
    "raw, expected",
    [
        ({"ru_a": None}, {"ru_a": None}),
        ({"ru_a": []}, {"ru_a": None}),
        (
            {"ru_a": ["scope1_mobile_gasoline"]},
            {"ru_a": frozenset({"scope1_mobile_gasoline"})},
        ),
        ({}, {}),
    ],
)
def test_normalize_payload_param_matrix(raw, expected):
    assert normalize_payload_applicability(raw) == expected
