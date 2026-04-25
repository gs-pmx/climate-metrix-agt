"""Tests for the Phase D1 autosave draft buffer.

Covers the SQLite store layer (``SQLiteWorkspaceDraftStore.save_draft`` /
``load_draft`` / ``delete_draft``), the ``ProjectStore`` facade, and the
interaction with the explicit-version save path that must clear an
in-flight draft. API-level coverage lives in ``test_project_draft_api``.
"""

from __future__ import annotations

from pathlib import Path

from ghg_engine.models import (
    ActivityDraft,
    ProjectSnapshot,
    ReportingUnitDraft,
)
from project_store import ProjectStore


def _snapshot() -> ProjectSnapshot:
    return ProjectSnapshot(
        facilities=[
            ReportingUnitDraft(
                id="F1",
                name="Facility 1",
                applicable_activity_types=["scope1_mobile_gasoline"],
            )
        ],
        activities=[
            ActivityDraft(
                id="a1",
                facility_id="F1",
                activity_type_id="scope1_mobile_gasoline",
                activity={"value": 12.5, "unit": "gallon"},
                params={},
            )
        ],
    )


def test_save_draft_round_trips_snapshot_and_metadata(tmp_path: Path):
    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_d1", name="Draft One", inventory_year=2024)

    saved = store.save_project_draft(
        project_id="prj_d1",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
    )

    assert saved["project_id"] == "prj_d1"
    assert saved["updated_at"]

    loaded = store.load_project_draft("prj_d1")
    assert loaded is not None
    assert loaded["project_id"] == "prj_d1"
    assert loaded["inventory_year"] == 2024
    assert loaded["gwp_set"] == "AR6"
    assert loaded["include_trace"] is True
    assert isinstance(loaded["snapshot"], ProjectSnapshot)
    assert loaded["snapshot"].activities[0].activity_type_id == "scope1_mobile_gasoline"
    assert loaded["snapshot"].activities[0].activity.value == 12.5


def test_save_draft_upserts_one_row_per_project(tmp_path: Path):
    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_d2", name="Draft Two", inventory_year=2024)

    store.save_project_draft(
        project_id="prj_d2",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
    )
    store.save_project_draft(
        project_id="prj_d2",
        inventory_year=2025,
        gwp_set="AR5",
        include_trace=False,
        snapshot=_snapshot(),
    )

    with store._connect() as conn:  # noqa: SLF001 - inspecting on-disk row count
        row_count = conn.execute(
            "SELECT COUNT(*) AS c FROM project_drafts WHERE project_id = ?",
            ("prj_d2",),
        ).fetchone()["c"]
    assert row_count == 1

    loaded = store.load_project_draft("prj_d2")
    assert loaded is not None
    # The second write wins: a single row reflects the latest payload.
    assert loaded["inventory_year"] == 2025
    assert loaded["gwp_set"] == "AR5"
    assert loaded["include_trace"] is False


def test_explicit_version_save_clears_draft(tmp_path: Path):
    """A real version save replaces the draft as the canonical state.

    The draft cannot linger on disk — otherwise the user would see a
    stale "you have unsaved changes" prompt right after committing.
    """

    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_d3", name="Draft Three", inventory_year=2024)

    store.save_project_draft(
        project_id="prj_d3",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
    )
    assert store.load_project_draft("prj_d3") is not None

    store.save_project_snapshot(
        project_id="prj_d3",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
        note="explicit version",
    )

    assert store.load_project_draft("prj_d3") is None


def test_delete_draft_explicit_returns_none_on_load(tmp_path: Path):
    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_d4", name="Draft Four", inventory_year=2024)

    store.save_project_draft(
        project_id="prj_d4",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
    )
    store.delete_project_draft("prj_d4")
    assert store.load_project_draft("prj_d4") is None

    # Idempotent: a second delete is a no-op (no exception).
    store.delete_project_draft("prj_d4")
    assert store.load_project_draft("prj_d4") is None


def test_save_draft_unknown_project_raises_keyerror(tmp_path: Path):
    store = ProjectStore(tmp_path / "drafts.sqlite")

    try:
        store.save_project_draft(
            project_id="prj_missing",
            inventory_year=2024,
            gwp_set="AR6",
            include_trace=True,
            snapshot=_snapshot(),
        )
    except KeyError:
        pass
    else:
        raise AssertionError("expected KeyError for unknown project_id")


def test_draft_round_trip_preserves_applicable_activity_types(tmp_path: Path):
    """Regression guard: the wire alias must survive draft persistence.

    During C3 / B2 the ``applicable_activity_types`` field was lost on
    reload because the wire alias was not honored on deserialization.
    The draft buffer reuses the same Pydantic alias-aware deserialization
    as ``get_version_snapshot``, so the regression must not return.
    """

    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_alias", name="Alias", inventory_year=2024)

    snapshot = ProjectSnapshot(
        facilities=[
            ReportingUnitDraft(
                id="F1",
                name="Facility 1",
                applicable_activity_types=[
                    "scope1_mobile_gasoline",
                    "scope2_purchased_electricity",
                ],
            ),
            ReportingUnitDraft(id="F2", name="Facility 2"),  # empty list preserved
        ],
    )
    store.save_project_draft(
        project_id="prj_alias",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=snapshot,
    )

    loaded = store.load_project_draft("prj_alias")
    assert loaded is not None
    units = {u.id: u for u in loaded["snapshot"].reporting_units}
    assert units["F1"].applicable_activity_types == [
        "scope1_mobile_gasoline",
        "scope2_purchased_electricity",
    ]
    assert units["F2"].applicable_activity_types == []
    assert units["F1"].name == "Facility 1"


def test_delete_project_cascades_to_drafts(tmp_path: Path):
    """``ON DELETE CASCADE`` keeps the draft table in sync with projects."""

    store = ProjectStore(tmp_path / "drafts.sqlite")
    store.create_project(project_id="prj_cascade", name="Cascade", inventory_year=2024)
    store.save_project_draft(
        project_id="prj_cascade",
        inventory_year=2024,
        gwp_set="AR6",
        include_trace=True,
        snapshot=_snapshot(),
    )
    store.delete_project("prj_cascade")
    with store._connect() as conn:  # noqa: SLF001 - verifying cascade
        rows = conn.execute(
            "SELECT COUNT(*) AS c FROM project_drafts WHERE project_id = ?",
            ("prj_cascade",),
        ).fetchone()["c"]
    assert rows == 0
