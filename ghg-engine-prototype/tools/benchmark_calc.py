"""Synthetic /calculate + /calculate/audit benchmark.

Uses FastAPI's TestClient against a freshly-seeded SQLite database, so it
exercises the real production code path (router → orchestrator → EQM
plugins → SQLiteFactorRepository) without needing a running uvicorn.

Usage:
    uv run python tools/benchmark_calc.py [--activities 30] [--iterations 3]

Prints per-iteration wall time for ``/calculate`` and ``/calculate/audit``,
plus the Layer B per-call profile when ``CLIMATE_METRIX_PROFILE_FACTORS=1``.
"""

from __future__ import annotations

import argparse
import logging
import os
import statistics
import time
from pathlib import Path

# Make sure the FastAPI dependency cache is fresh per invocation.
os.environ.setdefault("CLIMATE_METRIX_PROFILE_FACTORS", "1")


def _build_activities(count: int) -> list[dict]:
    """Mix a few activity shapes so we hit multiple EQM plugins."""

    scenarios: list[dict] = [
        {
            "activity_type_id": "scope1_mobile_gasoline",
            "activity": {"value": 100.0, "unit": "gallon"},
        },
        {
            "activity_type_id": "scope1_stationary_natural_gas",
            "activity": {"value": 1000.0, "unit": "therm"},
        },
        {
            "activity_type_id": "scope2_purchased_electricity_grid_mix",
            "activity": {"value": 1000.0, "unit": "kwh"},
        },
    ]
    out: list[dict] = []
    for i in range(count):
        scenario = dict(scenarios[i % len(scenarios)])
        scenario["facility_id"] = f"F{(i // 3) + 1}"
        out.append(scenario)
    return out


def _payload(activities: list[dict]) -> dict:
    return {
        "context": {
            "inventory_year": 2024,
            "gwp_set": "AR6",
            "source_attributes": {"country": "US", "egrid_subregion": "WECC"},
        },
        "activities": activities,
    }


def _run_iteration(client, endpoint: str, payload: dict) -> float:
    started = time.perf_counter()
    response = client.post(endpoint, json=payload)
    elapsed = time.perf_counter() - started
    if response.status_code >= 400:
        body = response.json()
        errors = body.get("errors") or []
        raise RuntimeError(
            f"{endpoint} returned {response.status_code}: "
            f"{errors[0].get('message') if errors else body}"
        )
    return elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--activities", type=int, default=30)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args()

    # Late-import after env vars are set.
    from fastapi.testclient import TestClient

    from api.app import create_app
    from api.dependencies import _build

    if args.db is None:
        args.db = Path("./.benchmark.sqlite").resolve()
    if args.db.exists():
        args.db.unlink()
    os.environ["DB_PATH"] = str(args.db)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    _build.cache_clear()
    activities = _build_activities(args.activities)
    payload = _payload(activities)

    with TestClient(create_app()) as client:
        # Warm-up — covers SQLite migration, factor seeding, lru_cache.
        client.post("/calculate", json=payload)

        for endpoint in ("/calculate", "/calculate/audit"):
            timings = [
                _run_iteration(client, endpoint, payload)
                for _ in range(args.iterations)
            ]
            mean = statistics.mean(timings)
            print(
                f"{endpoint:24} activities={args.activities} "
                f"mean={mean*1000:.0f}ms "
                f"min={min(timings)*1000:.0f}ms "
                f"max={max(timings)*1000:.0f}ms "
                f"per_activity={mean / args.activities * 1000:.1f}ms"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
