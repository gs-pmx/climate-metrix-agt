from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..activity_catalog import ActivityTypeDefinition
from ..domain import ResolvedActivity
from ..factors import FactorRepository
from ..models import ResultRecord, TraceRecord
from ..units import build_unit_registry


@dataclass
class EQMContext:
    """Optional context bag the orchestrator may pass to ``compute()``.

    Plugins that need cross-cutting state — GL mappings, FX rates,
    inflation indices, or any other per-project lookup — read it
    from here. Plugins that don't care ignore it (the parameter is
    keyword-only with a ``None`` default in the base class).
    """

    spend_based: Any | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class EQMPlugin(ABC):
    id: str
    version: str = "1.0.0"

    @abstractmethod
    def required_params_schema(self) -> dict[str, Any]:
        pass

    @abstractmethod
    def applicability(self, resolved: ResolvedActivity, activity_def: ActivityTypeDefinition) -> bool:
        pass

    @abstractmethod
    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
        *,
        eqm_context: EQMContext | None = None,
    ) -> tuple[list[ResultRecord], TraceRecord]:
        pass


_default_ureg = None


def default_ureg():
    # Pint's ``UnitRegistry`` parses the bundled definitions file on
    # every construction (~hundreds of ms) and re-defining custom units
    # like ``short_ton`` / ``therm`` emits a redefinition warning each
    # time. The registry is read-only after construction in our use, so
    # we share one instance across the process. This is the dominant
    # cost in the calc loop pre-F1.5: 30 activities × one rebuild each
    # was ~12s of every Run Calc.
    global _default_ureg
    if _default_ureg is None:
        _default_ureg = build_unit_registry()
    return _default_ureg
