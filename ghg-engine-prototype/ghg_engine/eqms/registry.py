from __future__ import annotations

from .base import EQMPlugin
from .direct_factor import DirectFactorMethod
from .distance_plus_efficiency import DistancePlusEfficiencyEQM
from .freight_ton_mile import FreightTonMileMethod
from .passenger_distance import PassengerDistanceMethod
from .refrigerant_mass_to_gwp import RefrigerantMassToGwpMethod
from .scope2_energy import Scope2EnergyMethod
from .waste_mass import WasteMassMethod


def default_plugin_registry() -> dict[str, EQMPlugin]:
    plugins: list[EQMPlugin] = [
        DirectFactorMethod(),
        Scope2EnergyMethod(),
        DistancePlusEfficiencyEQM(),
        FreightTonMileMethod(),
        PassengerDistanceMethod(),
        RefrigerantMassToGwpMethod(),
        WasteMassMethod(),
    ]
    return {plugin.id: plugin for plugin in plugins}
