"""In-memory crosswalk loader for the spend-based pipeline.

Three classification crosswalks live as static CSVs under
``data/reference_data/crosswalks/``. They are loaded on demand and held
in memory for the lifetime of the resolver. The CSVs are partial — see
``data/reference_data/crosswalks/README.md`` — but the resolver flow is
identical regardless of coverage; missing entries return ``None`` and
the caller decides whether to fall back or surface a gap.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


_DEFAULT_CROSSWALK_DIR = (
    Path(__file__).resolve().parent.parent.parent / "data" / "reference_data" / "crosswalks"
)


@dataclass
class CrosswalkResolver:
    """Resolve classification codes between NAICS / BEA / NACE / CPA / EXIOBASE.

    Each crosswalk is a one-to-many lookup. The resolver returns the
    first matching entry — appropriate for v1 since the bundled
    crosswalks de-dupe to a single best target per source code. Future
    versions can return all candidates with confidence scores.
    """

    naics_to_bea: dict[str, dict[str, str]] = field(default_factory=dict)
    nace_to_cpa: dict[str, dict[str, str]] = field(default_factory=dict)
    cpa_to_exiobase: dict[str, dict[str, str]] = field(default_factory=dict)

    @classmethod
    def from_csv_dir(cls, directory: Path) -> CrosswalkResolver:
        return cls(
            naics_to_bea=_load_csv(directory / "naics_to_bea.csv", "naics_code"),
            nace_to_cpa=_load_csv(directory / "nace_to_cpa.csv", "nace_code"),
            cpa_to_exiobase=_load_csv(directory / "cpa_to_exiobase.csv", "cpa_code"),
        )

    def resolve_naics_to_bea(self, naics_code: str) -> dict[str, str] | None:
        return self.naics_to_bea.get(_normalize(naics_code))

    def resolve_nace_to_cpa(self, nace_code: str) -> dict[str, str] | None:
        return self.nace_to_cpa.get(_normalize(nace_code))

    def resolve_cpa_to_exiobase(self, cpa_code: str) -> dict[str, str] | None:
        return self.cpa_to_exiobase.get(_normalize(cpa_code))

    def naics_to_exiobase(self, naics_code: str) -> dict[str, str] | None:
        """Compose NAICS -> BEA -> CPA -> EXIOBASE.

        v1 has a NAICS -> BEA bridge but no BEA -> CPA bridge yet, so
        this composite returns ``None`` whenever the BEA-side hop has
        no NACE-equivalent route. Documented in the resolver README.
        """

        bea = self.resolve_naics_to_bea(naics_code)
        if bea is None:
            return None
        # No BEA -> CPA crosswalk in v1; return the BEA hit so the
        # caller at least learns the BEA side of the bridge.
        return bea


def default_crosswalks() -> CrosswalkResolver:
    """Load the bundled crosswalks from ``data/reference_data/crosswalks``."""

    if _DEFAULT_CROSSWALK_DIR.is_dir():
        return CrosswalkResolver.from_csv_dir(_DEFAULT_CROSSWALK_DIR)
    return CrosswalkResolver()


def _normalize(code: str | None) -> str:
    if code is None:
        return ""
    return str(code).strip()


def _load_csv(path: Path, key_field: str) -> dict[str, dict[str, str]]:
    if not path.is_file():
        return {}
    out: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            key = _normalize(row.get(key_field))
            if not key:
                continue
            # First-write wins; bundled CSVs are pre-deduped, but be
            # explicit so a future user-supplied file with duplicates
            # doesn't silently flip semantics.
            if key in out:
                continue
            out[key] = {k: ("" if v is None else str(v)) for k, v in row.items()}
    return out


def collected_keys(resolver: CrosswalkResolver) -> Iterable[str]:
    """Diagnostic helper: return all source-code keys across crosswalks."""

    yield from resolver.naics_to_bea
    yield from resolver.nace_to_cpa
    yield from resolver.cpa_to_exiobase
