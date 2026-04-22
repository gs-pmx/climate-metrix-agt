from __future__ import annotations

from pydantic import BaseModel

from .activity import ActivityObservation
from .locus import OperationalLocus
from .policy import InventoryPolicy


class ResolvedActivity(BaseModel):
    observation: ActivityObservation
    locus: OperationalLocus
    policy: InventoryPolicy
