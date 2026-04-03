from __future__ import annotations

from .base import EQMPlugin
from .direct_factor import DirectFactorMethod
from .miles_to_fuel import MilesToFuelEQM


def default_plugin_registry() -> dict[str, EQMPlugin]:
    plugins: list[EQMPlugin] = [
        DirectFactorMethod(),
        MilesToFuelEQM(),
    ]
    return {p.id: p for p in plugins}
