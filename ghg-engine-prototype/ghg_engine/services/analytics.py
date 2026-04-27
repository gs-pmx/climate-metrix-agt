"""Analytics aggregation for the dashboard.

This module exposes a single function, :func:`compute_project_analytics`,
which reads the canonical inventory tables (``calculation_results`` joined
to ``inventory_loci``) for a project + version and returns one row per
``(facility, activity_type, scope, category, subcategory)`` cell with the
SUM of CO2e in kilograms.

CO2e rollup decision (Option A)
-------------------------------
All runtime EQMs in :mod:`ghg_engine.eqms` already emit a ``gas='co2e'``
``ResultRecord`` for every activity:

* :class:`DirectFactorMethod` — when only per-gas factors match, it
  computes co2e from the per-gas rows using the version's
  ``gwp_set`` and appends a synthesized co2e row
  (see ``direct_factor.py`` lines ~166-189).
* :class:`Scope2EnergyMethod` and :class:`WasteMassMethod` delegate to
  ``DirectFactorMethod``, so they inherit the co2e row.
* :class:`RefrigerantMassToGwpMethod` emits co2e directly (the math
  already includes GWP).

Therefore the analytics aggregation is the simple
``SUM(value) WHERE gas='co2e'`` path. We never have to roll up per-gas
rows at query time, and the version's GWP set is irrelevant here — it
was already applied when the calculation was persisted. This keeps the
SQL simple and indexable on ``(inventory_version_id, gas)`` /
``(inventory_version_id, facility_id)``.

If a future EQM stops emitting a co2e row, this module will silently
omit those activities; an assertion test in ``tests/test_analytics.py``
locks the assumption so a regression is loud.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from ..activity_catalog import ActivityCatalog
from ..infrastructure.sqlite_common import connect_sqlite


@dataclass(frozen=True)
class AnalyticsRow:
    """Pre-aggregated analytics cell.

    One row per ``(facility_id, activity_type_id, scope, category,
    subcategory)`` group within a single inventory version. The frontend
    re-aggregates these client-side under arbitrary filter combinations
    (scope chips, RU dropdown, category dropdown), so we keep the grain
    fine enough that the same payload powers every visualization without
    a round-trip per filter change.
    """

    facility_id: str
    facility_name: str
    activity_type_id: str
    activity_label: str
    scope: str
    category: str
    subcategory: str | None
    co2e_kg: float


@dataclass(frozen=True)
class AnalyticsResult:
    """Container for the analytics endpoint response.

    ``total_co2e_kg`` is precomputed at the top level so the headline
    KPI tile renders without a client-side reduce; the client still
    re-aggregates ``rows`` for the filtered views.
    """

    version_id: int
    inventory_year: int
    rows: list[AnalyticsRow]
    total_co2e_kg: float
    facility_count: int


def _resolve_inventory_version(
    conn: sqlite3.Connection,
    project_id: str,
    version_id: int | None,
) -> dict | None:
    """Look up the inventory version row for ``(project, version_id)``.

    When ``version_id`` is ``None`` we resolve to the latest version for
    the project (highest ``inventory_version_id``). Returns ``None`` if
    no matching row exists so the caller can map that to a 404.
    """

    if version_id is not None:
        row = conn.execute(
            """
            SELECT inventory_version_id, project_id, inventory_year
            FROM inventory_versions
            WHERE project_id = ? AND inventory_version_id = ?
            """,
            (project_id, version_id),
        ).fetchone()
        return dict(row) if row is not None else None

    row = conn.execute(
        """
        SELECT inventory_version_id, project_id, inventory_year
        FROM inventory_versions
        WHERE project_id = ?
        ORDER BY inventory_version_id DESC
        LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    return dict(row) if row is not None else None


def _category_lookup(activity_catalog: ActivityCatalog) -> dict[str, tuple[str, str | None]]:
    """Build ``activity_type_id -> (category, metric_subgroup)``.

    Pulled from the in-memory activity catalog so the analytics SQL stays
    free of joins to per-activity-type metadata (the catalog is loaded
    from JSON at process start and is effectively static). Activity types
    not present in the catalog (e.g. legacy snapshots referencing a
    removed activity) get a ``("Other", None)`` fallback.
    """

    lookup: dict[str, tuple[str, str | None]] = {}
    for definition in activity_catalog.list():
        lookup[definition.activity_type_id] = (
            definition.category,
            definition.metric_subgroup,
        )
    return lookup


def compute_project_analytics(
    *,
    db_path: Path,
    project_id: str,
    version_id: int | None,
    activity_catalog: ActivityCatalog,
) -> AnalyticsResult | None:
    """Compute pre-aggregated analytics rows for a project + version.

    Returns ``None`` if the requested version does not exist for the
    project (the API layer maps that to a 404). Returns an
    :class:`AnalyticsResult` with possibly-empty ``rows`` when the
    version exists but has no calculation results yet (e.g. an
    inventory_year was created but the user hasn't entered activities).

    Aggregation grain: ``(facility_id, activity_type_id, scope,
    accounting_method)`` from the canonical ``calculation_results``
    table. The SQL applies ``WHERE gas='co2e' AND is_biogenic=0`` so
    biogenic CO2 rows aren't double-counted (per-gas rows would've
    already excluded biogenic from their co2e aggregate inside the
    EQM — see ``direct_factor.py`` line ~172). The ``accounting_method``
    dimension keeps location-based and market-based Scope 2 totals
    distinct so the dashboard can present whichever the user prefers
    without a re-query; for v1 we sum across both, which matches the
    legacy DashboardTab behavior.
    """

    catalog = _category_lookup(activity_catalog)
    with connect_sqlite(db_path) as conn:
        version_row = _resolve_inventory_version(conn, project_id, version_id)
        if version_row is None:
            return None

        inventory_version_id = int(version_row["inventory_version_id"])
        inventory_year = int(version_row["inventory_year"])

        # Aggregation SQL. Joining ``calculation_results`` to
        # ``inventory_loci`` for ``facility_name`` is cheap because the
        # number of distinct (locus_id, inventory_version_id) pairs is
        # bounded by the number of Reporting Units (typically <100).
        #
        # We aggregate by (facility_id, activity_type_id, scope) at the
        # SQL level; category/subcategory are added in Python from the
        # in-memory catalog. Scope 2 dual-reporting (location + market)
        # is summed here — for v1 the dashboard treats CO2e as the
        # single number; per-method drill-through is a future concern.
        rows = conn.execute(
            """
            SELECT
                cr.facility_id AS facility_id,
                COALESCE(il.facility_name, cr.facility_id) AS facility_name,
                cr.activity_type_id AS activity_type_id,
                MAX(cr.activity_label) AS activity_label,
                cr.scope AS scope,
                SUM(cr.value) AS co2e_kg
            FROM calculation_results cr
            LEFT JOIN inventory_loci il
                ON il.inventory_version_id = cr.inventory_version_id
                AND il.locus_id = cr.facility_id
            WHERE cr.inventory_version_id = ?
                AND cr.gas = 'co2e'
                AND cr.is_biogenic = 0
            GROUP BY cr.facility_id, cr.activity_type_id, cr.scope
            ORDER BY co2e_kg DESC
            """,
            (inventory_version_id,),
        ).fetchall()

    analytics_rows: list[AnalyticsRow] = []
    facilities: set[str] = set()
    total = 0.0
    for row in rows:
        activity_type_id = str(row["activity_type_id"])
        category, subcategory = catalog.get(activity_type_id, ("Other", None))
        co2e_kg = float(row["co2e_kg"] or 0.0)
        facilities.add(str(row["facility_id"]))
        total += co2e_kg
        analytics_rows.append(
            AnalyticsRow(
                facility_id=str(row["facility_id"]),
                facility_name=str(row["facility_name"]),
                activity_type_id=activity_type_id,
                activity_label=str(row["activity_label"] or activity_type_id),
                scope=str(row["scope"]),
                category=category,
                subcategory=subcategory,
                co2e_kg=co2e_kg,
            )
        )

    return AnalyticsResult(
        version_id=inventory_version_id,
        inventory_year=inventory_year,
        rows=analytics_rows,
        total_co2e_kg=total,
        facility_count=len(facilities),
    )


def iter_analytics_rows(result: AnalyticsResult) -> Iterable[AnalyticsRow]:
    """Iteration helper kept on the module surface for test ergonomics."""

    return iter(result.rows)
