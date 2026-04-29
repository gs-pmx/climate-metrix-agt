"""Per-request calc-path utilities: profiling + factor cache.

Three pieces, all hung off the same ``request_scope`` context manager:

* **Layer A profiling** — caller adds a single ``perf_counter`` pair
  around the request body and emits one ``calc.request`` log line.
  Always on, costs microseconds, kept post-merge as a regression alarm.

* **Layer B profiling** — gated by ``CLIMATE_METRIX_PROFILE_FACTORS``.
  When enabled, factor-repository call sites wrap their work in
  ``time_query`` / ``record_connection_open``; the calc router emits an
  extra ``calc.profile`` summary line per request. Off by default so it
  doesn't fire for normal traffic.

* **Request-scoped factor cache** — always on inside ``request_scope``.
  Memoises ``get_by_factor_id`` results so the audit endpoint's per-gas
  re-fetch collapses to a single SQL query per distinct ``factor_id``
  in the request. Cleared at request exit.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("ghg_engine.perf_profile")

PROFILE_FACTORS_ENV = "CLIMATE_METRIX_PROFILE_FACTORS"


def factor_profiling_enabled() -> bool:
    raw = os.environ.get(PROFILE_FACTORS_ENV, "").strip().lower()
    return raw not in {"", "0", "false", "no", "off"}


@dataclass
class FactorProfile:
    connections_opened: int = 0
    total_query_seconds: float = 0.0
    longest_query_seconds: float = 0.0
    call_counts: dict[str, int] = field(default_factory=dict)


_active_profile: ContextVar[FactorProfile | None] = ContextVar(
    "_active_factor_profile", default=None
)
_active_factor_cache: ContextVar[dict[str, Any] | None] = ContextVar(
    "_active_factor_cache", default=None
)


@contextmanager
def request_scope() -> Iterator[FactorProfile | None]:
    """Open per-request profile (Layer B if enabled) and factor cache.

    Yields the active ``FactorProfile`` when Layer B is enabled,
    otherwise ``None``. The factor cache is always installed and
    cleared at exit; callers don't need to interact with it directly.
    """

    profile_token = None
    cache_token = _active_factor_cache.set({})
    profile: FactorProfile | None = None
    if factor_profiling_enabled():
        profile = FactorProfile()
        profile_token = _active_profile.set(profile)
    try:
        yield profile
    finally:
        if profile_token is not None:
            _active_profile.reset(profile_token)
        _active_factor_cache.reset(cache_token)


# Back-compat alias for callers that only care about the profile half.
request_profile = request_scope


def current_profile() -> FactorProfile | None:
    return _active_profile.get()


def current_factor_cache() -> dict[str, Any] | None:
    return _active_factor_cache.get()


@contextmanager
def time_query(call_name: str) -> Iterator[None]:
    profile = current_profile()
    if profile is None:
        yield
        return
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        profile.total_query_seconds += elapsed
        if elapsed > profile.longest_query_seconds:
            profile.longest_query_seconds = elapsed
        profile.call_counts[call_name] = profile.call_counts.get(call_name, 0) + 1


def record_connection_open() -> None:
    profile = current_profile()
    if profile is not None:
        profile.connections_opened += 1


def format_profile_summary(profile: FactorProfile) -> str:
    parts = [
        f"connections={profile.connections_opened}",
        f"total_query_s={profile.total_query_seconds:.4f}",
        f"longest_query_s={profile.longest_query_seconds:.4f}",
    ]
    for name in sorted(profile.call_counts):
        parts.append(f"{name}={profile.call_counts[name]}")
    return " ".join(parts)
