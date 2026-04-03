from __future__ import annotations

from .models import GwpSetName

GWP_100: dict[GwpSetName, dict[str, float]] = {
    "AR6": {
        "co2": 1.0,
        "ch4": 27.2,
        "n2o": 273.0,
    },
    "AR5": {
        "co2": 1.0,
        "ch4": 28.0,
        "n2o": 265.0,
    },
}


def get_gwp_set(name: GwpSetName) -> dict[str, float]:
    return GWP_100[name]
