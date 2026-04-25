from __future__ import annotations

from typing import Any, Protocol

from ghg_engine.models import ProjectSnapshot, ResultRecord, TraceRecord


class WorkspaceDraftRepository(Protocol):
    def list_projects(self) -> list[dict[str, Any]]:
        ...

    def create_project(self, *, project_id: str, name: str, inventory_year: int) -> dict[str, Any]:
        ...

    def rename_project(self, project_id: str, new_name: str) -> dict[str, Any]:
        ...

    def delete_project(self, project_id: str) -> None:
        ...

    def list_versions(self, project_id: str) -> list[dict[str, Any]]:
        ...

    def get_version_snapshot(self, project_id: str, version_number: int | None = None) -> dict[str, Any]:
        ...

    def save_workspace_snapshot(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
    ) -> dict[str, Any]:
        ...

    # ------------------------------------------------------------------
    # Draft buffer (Phase D1) — autosave methods.
    # ------------------------------------------------------------------

    def save_draft(
        self,
        *,
        project_id: str,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
    ) -> dict[str, Any]:
        ...

    def load_draft(self, project_id: str) -> dict[str, Any] | None:
        ...

    def delete_draft(self, project_id: str) -> None:
        ...


class InventoryRepository(Protocol):
    def save_inventory_version(
        self,
        *,
        project_id: str,
        workspace_version_id: int,
        inventory_year: int,
        gwp_set: str,
        include_trace: bool,
        snapshot: ProjectSnapshot,
        note: str | None = None,
    ) -> dict[str, Any]:
        ...

    def save_calculation_run(
        self,
        *,
        inventory_version_id: int,
        workspace_version_id: int,
        factor_dataset_id: str | None,
        results: list[ResultRecord],
        traces: list[TraceRecord],
        engine_version: str,
        source_kind: str = "workspace_snapshot",
        applicability: dict[str, frozenset[str] | None] | None = None,
    ) -> dict[str, Any] | None:
        ...
