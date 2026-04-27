"""Phase E1 — spend-based emissions accounting domain helpers.

The package collects everything orthogonal to the rest of the engine:
the GL-mapping resolver, the FX/inflation correction helpers, and the
classification crosswalk loader. Plugins and routers import from here.
"""

from .crosswalk_resolver import CrosswalkResolver, default_crosswalks

__all__ = ["CrosswalkResolver", "default_crosswalks"]
