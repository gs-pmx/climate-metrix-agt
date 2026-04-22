from __future__ import annotations

from typing import Any, Protocol

from ghg_engine.factors import FactorQuery
from ghg_engine.models import EmissionFactorRow


class FactorQueryRepository(Protocol):
    def candidates(self, q: FactorQuery) -> list[EmissionFactorRow]:
        ...

    def select_best(
        self,
        q: FactorQuery,
        *,
        trace: list[str] | None = None,
    ) -> EmissionFactorRow | None:
        ...

    def get_by_factor_id(self, factor_id: str) -> EmissionFactorRow | None:
        ...

    def preview(self, query_text: str | None = None) -> list[dict[str, str]]:
        ...


class FactorDatasetRepository(Protocol):
    def import_factor_documents(
        self,
        *,
        dataset_key: str,
        source_name: str,
        version_label: str,
        docs: list[dict[str, Any]],
        publish: bool = True,
        notes: str | None = None,
    ) -> dict[str, Any]:
        ...

    def current_factor_dataset(self) -> dict[str, Any] | None:
        ...

    def factor_repository(self, dataset_key: str | None = None) -> FactorQueryRepository:
        ...
