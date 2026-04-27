// Pure helpers for the Phase D3 dashboard.
//
// The dashboard receives a list of pre-aggregated rows from
// ``GET /projects/{id}/analytics`` (one row per facility/activity/scope
// cell, with co2e_kg) and re-filters/re-aggregates them client-side
// under arbitrary scope/RU/category filter combinations.
//
// Keeping the filter and aggregation logic here (free of React) lets
// the node --test runner exercise the math without rendering anything.
// The DashboardTab.jsx wrapper just glues these to MUI components.

// ---------------------------------------------------------------------------
// Number / unit helpers
// ---------------------------------------------------------------------------

// Convert kilograms (the wire unit) to metric tons (the display unit).
// The dashboard speaks MTCO2e everywhere; converting once at the edge
// keeps every downstream sum and comparison in the same scale.
export function kgToMetricTons(kg) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return 0;
  return n / 1000;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

// Apply the dashboard filter chips to the analytics row list.
//
// ``filters.scopes`` is a Set or array of scope strings (e.g.
// ``"Scope 1"``). When empty/null, we treat that as "no scope filter"
// — every row passes the scope predicate. Same shape choice for
// ``reportingUnitId`` and ``category`` but those are single-valued
// (``null`` / ``""`` means "All").
//
// Filters AND together: a row must satisfy every active filter.
export function filterRows(rows, filters = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const scopes = normalizeScopeSet(filters.scopes);
  const reportingUnitId = filters.reportingUnitId || "";
  const category = filters.category || "";
  return rows.filter((row) => {
    if (scopes && scopes.size > 0 && !scopes.has(row.scope)) return false;
    if (reportingUnitId && row.facility_id !== reportingUnitId) return false;
    if (category && row.category !== category) return false;
    return true;
  });
}

function normalizeScopeSet(value) {
  if (value == null) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return null;
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

// Aggregate the four headline KPI values from a row list (already
// filtered if applicable). The shape is suitable for a 4-up tile row.
export function aggregateKpis(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      totalCo2eMt: 0,
      reportingUnitsReporting: 0,
      activitiesCalculated: 0,
      coveragePct: null,
    };
  }
  let totalKg = 0;
  const facilityIds = new Set();
  const activityKeys = new Set();
  for (const row of rows) {
    totalKg += Number(row.co2e_kg) || 0;
    if (row.facility_id) facilityIds.add(row.facility_id);
    if (row.facility_id && row.activity_type_id) {
      activityKeys.add(`${row.facility_id}::${row.activity_type_id}`);
    }
  }
  return {
    totalCo2eMt: kgToMetricTons(totalKg),
    reportingUnitsReporting: facilityIds.size,
    activitiesCalculated: activityKeys.size,
    coveragePct: null, // The CoverageWidget handles project-level coverage; the KPI strip surfaces a passthrough value when wired by the parent.
  };
}

// ---------------------------------------------------------------------------
// Scope rollup (stacked horizontal bar)
// ---------------------------------------------------------------------------

// Produce one bucket per Scope (1/2/3) with metric-ton totals plus
// percent-of-total. The stacked bar uses ``valueMt`` as the segment
// width; ``pct`` is shown in the legend / tooltip.
export function aggregateByScope(rows) {
  const scopes = ["Scope 1", "Scope 2", "Scope 3"];
  const totals = Object.fromEntries(scopes.map((s) => [s, 0]));
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(totals, row.scope)) {
      totals[row.scope] += Number(row.co2e_kg) || 0;
    }
  }
  const grandTotalKg = scopes.reduce((sum, s) => sum + totals[s], 0);
  return scopes.map((scope) => {
    const kg = totals[scope];
    const valueMt = kgToMetricTons(kg);
    const pct = grandTotalKg > 0 ? (kg / grandTotalKg) * 100 : 0;
    return { scope, valueMt, valueKg: kg, pct };
  });
}

// ---------------------------------------------------------------------------
// Reporting Unit rollup (Top RUs vertical bar)
// ---------------------------------------------------------------------------

// Group rows by Reporting Unit, returning the top N (default 10) by
// total CO2e. Each entry carries Scope 1/2/3 sub-totals so the
// downstream BarChart can stack by scope.
export function aggregateByReportingUnit(rows, { limit = 10 } = {}) {
  const byRu = new Map();
  for (const row of rows) {
    const id = row.facility_id;
    if (!id) continue;
    const existing = byRu.get(id) || {
      facility_id: id,
      facility_name: row.facility_name || id,
      total: 0,
      "Scope 1": 0,
      "Scope 2": 0,
      "Scope 3": 0,
    };
    const kg = Number(row.co2e_kg) || 0;
    existing.total += kg;
    if (Object.prototype.hasOwnProperty.call(existing, row.scope)) {
      existing[row.scope] += kg;
    }
    byRu.set(id, existing);
  }
  // Convert to metric tons in the output shape; the in-loop sum stays
  // in kg to keep precision.
  const arr = Array.from(byRu.values()).map((entry) => ({
    facility_id: entry.facility_id,
    facility_name: entry.facility_name,
    totalMt: kgToMetricTons(entry.total),
    "Scope 1": kgToMetricTons(entry["Scope 1"]),
    "Scope 2": kgToMetricTons(entry["Scope 2"]),
    "Scope 3": kgToMetricTons(entry["Scope 3"]),
  }));
  arr.sort((a, b) => b.totalMt - a.totalMt);
  return arr.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Treemap data builder (RU > category, sized by CO2e)
// ---------------------------------------------------------------------------

// Build the recharts Treemap input: one parent per Reporting Unit, with
// children one per Category. Empty RUs are dropped because recharts
// can't render zero-sized cells gracefully. Output shape:
//
//   [{
//     name: "Headquarters",
//     facility_id: "F1",
//     value: 350,                 // metric tons, RU total (recharts uses
//                                 //   children sums when leaves exist)
//     children: [
//       { name: "Stationary Energy", value: 250, category: "...",
//         facility_id: "F1" },
//       ...
//     ]
//   }, ...]
//
// Including ``facility_id`` and ``category`` on the leaves is what
// powers click-through: when a user clicks a leaf, the dashboard
// pivots its filters to that RU + category combo.
export function buildTreemapData(rows) {
  const byRu = new Map();
  for (const row of rows) {
    const ruId = row.facility_id;
    if (!ruId) continue;
    const ruEntry = byRu.get(ruId) || {
      name: row.facility_name || ruId,
      facility_id: ruId,
      _categories: new Map(),
    };
    const categoryName = row.category || "Other";
    const catEntry = ruEntry._categories.get(categoryName) || {
      name: categoryName,
      category: categoryName,
      facility_id: ruId,
      facility_name: ruEntry.name,
      kg: 0,
    };
    catEntry.kg += Number(row.co2e_kg) || 0;
    ruEntry._categories.set(categoryName, catEntry);
    byRu.set(ruId, ruEntry);
  }
  const result = [];
  for (const ru of byRu.values()) {
    const children = Array.from(ru._categories.values())
      .map((c) => ({
        name: c.name,
        category: c.category,
        facility_id: c.facility_id,
        facility_name: c.facility_name,
        value: kgToMetricTons(c.kg),
      }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
    if (children.length === 0) continue;
    const totalMt = children.reduce((sum, c) => sum + c.value, 0);
    result.push({
      name: ru.name,
      facility_id: ru.facility_id,
      value: totalMt,
      children,
    });
  }
  result.sort((a, b) => b.value - a.value);
  return result;
}

// ---------------------------------------------------------------------------
// Top contributors table
// ---------------------------------------------------------------------------

// Roll up to one row per (RU, activity) pair, sorted descending by
// CO2e. Default limit is 20 so the table doesn't grow unbounded for
// large projects; the parent supplies a different limit when needed.
export function buildTopContributors(rows, { limit = 20 } = {}) {
  const groups = new Map();
  let grandTotalKg = 0;
  for (const row of rows) {
    const key = `${row.facility_id}::${row.activity_type_id}`;
    const existing = groups.get(key) || {
      key,
      facility_id: row.facility_id,
      facility_name: row.facility_name || row.facility_id,
      activity_type_id: row.activity_type_id,
      activity_label: row.activity_label || row.activity_type_id,
      scope: row.scope,
      category: row.category,
      kg: 0,
    };
    existing.kg += Number(row.co2e_kg) || 0;
    groups.set(key, existing);
    grandTotalKg += Number(row.co2e_kg) || 0;
  }
  const arr = Array.from(groups.values()).map((entry) => ({
    ...entry,
    valueMt: kgToMetricTons(entry.kg),
    sharePct: grandTotalKg > 0 ? (entry.kg / grandTotalKg) * 100 : 0,
  }));
  arr.sort((a, b) => b.valueMt - a.valueMt);
  return arr.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Filter option builders (dropdown population)
// ---------------------------------------------------------------------------

// Distinct list of {id, label} for the Reporting Unit dropdown,
// derived from the rows themselves (so the dropdown is always
// consistent with what's actually in the analytics payload — no
// orphaned RUs that have no co2e).
export function listReportingUnitOptions(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.facility_id) continue;
    if (!map.has(row.facility_id)) {
      map.set(row.facility_id, {
        id: row.facility_id,
        label: row.facility_name || row.facility_id,
      });
    }
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => a.label.localeCompare(b.label));
  return arr;
}

// Distinct categories. Used for the Category dropdown.
export function listCategoryOptions(rows) {
  const set = new Set();
  for (const row of rows) {
    if (row.category) set.add(row.category);
  }
  const arr = Array.from(set);
  arr.sort();
  return arr;
}
