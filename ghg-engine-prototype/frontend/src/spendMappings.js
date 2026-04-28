// Phase E2 — pure helpers backing the Spend Inputs tab. Pulled out
// of the .jsx component so node --test can import them directly
// without a JSX transform.

export const SPEND_BASED_ACTIVITY_ID = "scope3_spend_based";

export function filterRusWithSpendSelected(reportingUnits) {
  return (reportingUnits || []).filter((ru) =>
    Array.isArray(ru?.applicable_activity_types)
      ? ru.applicable_activity_types.includes(SPEND_BASED_ACTIVITY_ID)
      : false,
  );
}

// Bucket project-wide GL mappings by reporting_unit_id. Project-wide
// defaults (reporting_unit_id === null) land under the
// ``__project_default__`` sentinel so callers can read the per-RU map
// uniformly.
export function groupMappingsByRu(mappings) {
  const grouped = {};
  for (const m of mappings || []) {
    const key = m.reporting_unit_id || "__project_default__";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }
  return grouped;
}
