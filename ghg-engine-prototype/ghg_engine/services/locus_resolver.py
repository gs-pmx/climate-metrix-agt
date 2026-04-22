from __future__ import annotations

from ghg_engine.domain import ActivityObservation, OperationalLocus


class LocusResolver:
    """Validation seam for resolving activities against operational loci."""

    def resolve(self, observation: ActivityObservation, locus: OperationalLocus) -> OperationalLocus:
        if observation.locus_id != locus.locus_id:
            raise ValueError(
                f"activity '{observation.activity_id}' is attached to locus '{observation.locus_id}' "
                f"but resolver received '{locus.locus_id}'"
            )
        return locus
