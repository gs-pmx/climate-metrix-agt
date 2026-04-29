// Phase D3 + Option-B refactor — derive dashboard analytics rows from
// the in-memory ``resultRows`` React state instead of round-tripping
// to ``GET /projects/{id}/analytics``.
//
// The ``/analytics`` SQL aggregates ``calculation_results`` by
// ``(facility_id, activity_type_id, scope)`` with
// ``WHERE gas='co2e' AND is_biogenic=0``, then enriches each row with
// ``category`` / ``subcategory`` from the in-memory activity catalog.
// We mirror the same shape here so the downstream dashboard helpers
// (filterRows, listReportingUnitOptions, listCategoryOptions,
// kgToMetricTons, etc.) keep working without modification.
//
// The endpoint stays around for cross-version queries (compare a
// historical version to current, or render a saved snapshot for PDF
// export). The live tab no longer depends on it.
//
// Unit handling: ``resultRows`` in App state are already converted to
// metric tons (see ``runCalculation`` -> ``setResultRows``). The
// dashboard helpers treat ``co2e_kg`` as the wire unit and convert via
// ``kgToMetricTons`` for display, so we multiply back to kg here to
// preserve that contract.

const KG_PER_METRIC_TON = 1000;

export function buildAnalyticsRowsFromResults(resultRows, activityTypesById) {
  if (!Array.isArray(resultRows) || resultRows.length === 0) return [];
  const grouped = new Map();
  const catalogById = activityTypesById || {};

  for (const row of resultRows) {
    if (!row) continue;
    if (row.gas !== "co2e") continue;
    if (row.is_biogenic) continue;

    const activityDef = catalogById[row.activity_type_id];
    const category = activityDef?.category || "Other";
    const subcategory = activityDef?.metric_subgroup || null;

    const key = `${row.facility_id}||${row.activity_type_id}||${row.scope}`;
    const valueInKg = (Number(row.value) || 0) * KG_PER_METRIC_TON;

    const existing = grouped.get(key);
    if (existing) {
      existing.co2e_kg += valueInKg;
      continue;
    }

    grouped.set(key, {
      facility_id: row.facility_id,
      facility_name: row.facility_name || row.facility_id,
      activity_type_id: row.activity_type_id,
      activity_label:
        row.activity_label
        || activityDef?.label
        || row.activity_type_id,
      scope: row.scope,
      category,
      subcategory,
      co2e_kg: valueInKg,
    });
  }

  // Match the SQL ``ORDER BY co2e_kg DESC`` so chart-internal "top N"
  // logic that assumes a sorted input keeps its current behavior.
  return Array.from(grouped.values()).sort((a, b) => b.co2e_kg - a.co2e_kg);
}

// Build the same envelope shape the ``/analytics`` endpoint returns,
// so DashboardTab can swap the data source without restructuring its
// downstream consumers.
export function buildAnalyticsEnvelope(resultRows, activityTypesById) {
  const rows = buildAnalyticsRowsFromResults(resultRows, activityTypesById);
  const total_co2e_kg = rows.reduce((acc, r) => acc + (Number(r.co2e_kg) || 0), 0);
  const facility_count = new Set(rows.map((r) => r.facility_id)).size;
  return {
    // version_id / inventory_year aren't carried on the in-memory side;
    // the dashboard never actually reads them today, but the field is
    // present for shape parity with the endpoint payload.
    version_id: null,
    inventory_year: null,
    rows,
    total_co2e_kg,
    facility_count,
  };
}
