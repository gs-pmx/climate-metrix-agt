import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateByReportingUnit,
  aggregateByScope,
  aggregateKpis,
  applySelectionToRows,
  buildTopContributors,
  buildTreemapData,
  filterRows,
  kgToMetricTons,
  listCategoryOptions,
  listReportingUnitOptions,
  matchesSelection,
} from "./analyticsState.js";

// Sample row set covering two RUs, three scopes, and three categories.
// Values are in kg; helpers convert to metric tons.
const SAMPLE_ROWS = [
  {
    facility_id: "F1",
    facility_name: "Headquarters",
    activity_type_id: "scope1_mobile_gasoline",
    activity_label: "Mobile Gasoline",
    scope: "Scope 1",
    category: "Transportation",
    subcategory: null,
    co2e_kg: 100_000, // 100 MT
  },
  {
    facility_id: "F1",
    facility_name: "Headquarters",
    activity_type_id: "scope2_purchased_electricity_grid_mix",
    activity_label: "Purchased Electricity",
    scope: "Scope 2",
    category: "Stationary Energy",
    subcategory: "electricity_mix",
    co2e_kg: 250_000, // 250 MT
  },
  {
    facility_id: "F2",
    facility_name: "Warehouse",
    activity_type_id: "scope1_stationary_natural_gas",
    activity_label: "Natural Gas",
    scope: "Scope 1",
    category: "Stationary Energy",
    subcategory: "fossil_fuel",
    co2e_kg: 50_000, // 50 MT
  },
  {
    facility_id: "F2",
    facility_name: "Warehouse",
    activity_type_id: "scope3_business_travel_air",
    activity_label: "Business Travel - Air",
    scope: "Scope 3",
    category: "Transportation",
    subcategory: "3.6_business_travel",
    co2e_kg: 25_000, // 25 MT
  },
];

test("kgToMetricTons converts cleanly and rejects non-finite", () => {
  assert.equal(kgToMetricTons(1000), 1);
  assert.equal(kgToMetricTons(0), 0);
  assert.equal(kgToMetricTons(NaN), 0);
  assert.equal(kgToMetricTons(undefined), 0);
});

test("filterRows passes everything when no filters supplied", () => {
  assert.equal(filterRows(SAMPLE_ROWS, {}).length, 4);
  assert.equal(filterRows(SAMPLE_ROWS, { scopes: [] }).length, 4);
  assert.equal(filterRows(SAMPLE_ROWS, { scopes: null }).length, 4);
});

test("filterRows narrows by scope (multi-select)", () => {
  const onlyScope2 = filterRows(SAMPLE_ROWS, { scopes: ["Scope 2"] });
  assert.equal(onlyScope2.length, 1);
  assert.equal(onlyScope2[0].activity_type_id, "scope2_purchased_electricity_grid_mix");

  const scope1And3 = filterRows(SAMPLE_ROWS, {
    scopes: new Set(["Scope 1", "Scope 3"]),
  });
  assert.equal(scope1And3.length, 3);
});

test("filterRows narrows by reporting unit and category, ANDed", () => {
  const f1Only = filterRows(SAMPLE_ROWS, { reportingUnitId: "F1" });
  assert.equal(f1Only.length, 2);

  const transportationOnly = filterRows(SAMPLE_ROWS, { category: "Transportation" });
  assert.equal(transportationOnly.length, 2);

  // Combined: F1 + Stationary Energy = the electricity row only.
  const combined = filterRows(SAMPLE_ROWS, {
    reportingUnitId: "F1",
    category: "Stationary Energy",
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].scope, "Scope 2");
});

test("aggregateKpis returns zeros for empty input and tile values otherwise", () => {
  const empty = aggregateKpis([]);
  assert.equal(empty.totalCo2eMt, 0);
  assert.equal(empty.reportingUnitsReporting, 0);
  assert.equal(empty.activitiesCalculated, 0);

  const k = aggregateKpis(SAMPLE_ROWS);
  // 100 + 250 + 50 + 25 = 425 MT
  assert.equal(k.totalCo2eMt, 425);
  assert.equal(k.reportingUnitsReporting, 2);
  // 4 distinct (facility, activity_type) pairs
  assert.equal(k.activitiesCalculated, 4);
});

test("aggregateByScope returns three buckets with correct totals and percents", () => {
  const buckets = aggregateByScope(SAMPLE_ROWS);
  assert.equal(buckets.length, 3);
  const byScope = Object.fromEntries(buckets.map((b) => [b.scope, b]));
  // Scope 1: 100 + 50 = 150 MT
  assert.equal(byScope["Scope 1"].valueMt, 150);
  assert.equal(byScope["Scope 2"].valueMt, 250);
  assert.equal(byScope["Scope 3"].valueMt, 25);
  // Percentages of 425 total
  assert.ok(Math.abs(byScope["Scope 1"].pct - (150 / 425) * 100) < 1e-6);
  assert.ok(Math.abs(byScope["Scope 2"].pct - (250 / 425) * 100) < 1e-6);
});

test("aggregateByScope handles empty input cleanly", () => {
  const buckets = aggregateByScope([]);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].valueMt, 0);
  assert.equal(buckets[0].pct, 0);
});

test("aggregateByReportingUnit ranks RUs by total and stacks by scope", () => {
  const ranked = aggregateByReportingUnit(SAMPLE_ROWS);
  assert.equal(ranked.length, 2);
  // F1 = 350 MT (100 mobile + 250 electricity), F2 = 75 MT (50 + 25)
  assert.equal(ranked[0].facility_id, "F1");
  assert.equal(ranked[0].totalMt, 350);
  assert.equal(ranked[0]["Scope 1"], 100);
  assert.equal(ranked[0]["Scope 2"], 250);
  assert.equal(ranked[0]["Scope 3"], 0);
  assert.equal(ranked[1].facility_id, "F2");
  assert.equal(ranked[1].totalMt, 75);
  assert.equal(ranked[1]["Scope 1"], 50);
  assert.equal(ranked[1]["Scope 3"], 25);
});

test("aggregateByReportingUnit applies the limit", () => {
  // Synthesize 12 RUs so we can verify the cut-off.
  const many = [];
  for (let i = 0; i < 12; i += 1) {
    many.push({
      facility_id: `F${i}`,
      facility_name: `Facility ${i}`,
      activity_type_id: "scope1_mobile_gasoline",
      activity_label: "Mobile Gasoline",
      scope: "Scope 1",
      category: "Transportation",
      co2e_kg: (12 - i) * 1000,
    });
  }
  const limited = aggregateByReportingUnit(many, { limit: 5 });
  assert.equal(limited.length, 5);
  // Sorted by total descending — F0 carries the most.
  assert.equal(limited[0].facility_id, "F0");
});

test("buildTreemapData groups by RU then category, sized in metric tons", () => {
  const data = buildTreemapData(SAMPLE_ROWS);
  assert.equal(data.length, 2);
  // First RU: F1 (Headquarters) at 350 MT total; sorted desc.
  const f1 = data.find((d) => d.facility_id === "F1");
  assert.ok(f1);
  assert.equal(f1.value, 350);
  // Two categories under F1: Stationary Energy (250) and Transportation (100)
  const f1Categories = Object.fromEntries(f1.children.map((c) => [c.category, c]));
  assert.equal(f1Categories["Stationary Energy"].value, 250);
  assert.equal(f1Categories["Transportation"].value, 100);
  // Each leaf carries facility_id + category for click-through.
  assert.equal(f1Categories["Stationary Energy"].facility_id, "F1");
  assert.equal(f1Categories["Stationary Energy"].category, "Stationary Energy");
});

test("buildTreemapData drops empty RUs with no positive children", () => {
  const allZero = SAMPLE_ROWS.map((r) => ({ ...r, co2e_kg: 0 }));
  const data = buildTreemapData(allZero);
  assert.equal(data.length, 0);
});

test("buildTopContributors rolls up to (RU, activity) and ranks by CO2e", () => {
  const rows = buildTopContributors(SAMPLE_ROWS, { limit: 10 });
  assert.equal(rows.length, 4);
  // Largest is the F1 electricity row at 250 MT (= 250000 kg / 1000).
  assert.equal(rows[0].facility_id, "F1");
  assert.equal(rows[0].activity_type_id, "scope2_purchased_electricity_grid_mix");
  assert.equal(rows[0].valueMt, 250);
  // Share of 425 MT grand total
  assert.ok(Math.abs(rows[0].sharePct - (250 / 425) * 100) < 1e-6);
});

test("buildTopContributors honors the limit", () => {
  const top2 = buildTopContributors(SAMPLE_ROWS, { limit: 2 });
  assert.equal(top2.length, 2);
});

test("buildTopContributors collapses duplicate (RU, activity) cells", () => {
  // Two rows that share (F1, scope2_*) but have different scope strings
  // for some reason — the rollup must still merge them on the (RU,
  // activity) key.
  const dup = [
    {
      facility_id: "F1",
      facility_name: "F1",
      activity_type_id: "scope2_x",
      activity_label: "X",
      scope: "Scope 2",
      category: "Stationary Energy",
      co2e_kg: 1000,
    },
    {
      facility_id: "F1",
      facility_name: "F1",
      activity_type_id: "scope2_x",
      activity_label: "X",
      scope: "Scope 2",
      category: "Stationary Energy",
      co2e_kg: 2000,
    },
  ];
  const rolled = buildTopContributors(dup);
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].valueMt, 3);
});

test("listReportingUnitOptions returns sorted distinct {id, label}", () => {
  const opts = listReportingUnitOptions(SAMPLE_ROWS);
  assert.equal(opts.length, 2);
  // Sorted by label ascending — Headquarters before Warehouse.
  assert.equal(opts[0].label, "Headquarters");
  assert.equal(opts[1].label, "Warehouse");
});

test("listCategoryOptions returns sorted distinct names", () => {
  const cats = listCategoryOptions(SAMPLE_ROWS);
  assert.deepEqual(cats, ["Stationary Energy", "Transportation"]);
});

// ---------------------------------------------------------------------------
// Selection helpers (cross-filter highlight)
// ---------------------------------------------------------------------------

test("matchesSelection returns false for null selection", () => {
  assert.equal(matchesSelection(SAMPLE_ROWS[0], null), false);
  assert.equal(matchesSelection(SAMPLE_ROWS[0], undefined), false);
});

test("matchesSelection matches by facility_id when no category specified", () => {
  const sel = { facility_id: "F1" };
  // Both F1 rows match; both F2 rows don't.
  assert.equal(matchesSelection(SAMPLE_ROWS[0], sel), true);
  assert.equal(matchesSelection(SAMPLE_ROWS[1], sel), true);
  assert.equal(matchesSelection(SAMPLE_ROWS[2], sel), false);
  assert.equal(matchesSelection(SAMPLE_ROWS[3], sel), false);
});

test("matchesSelection matches by facility_id AND category when both specified", () => {
  const sel = { facility_id: "F1", category: "Stationary Energy" };
  // Only the F1 / Stationary Energy row matches.
  assert.equal(matchesSelection(SAMPLE_ROWS[0], sel), false); // F1, Transportation
  assert.equal(matchesSelection(SAMPLE_ROWS[1], sel), true); // F1, Stationary Energy
  assert.equal(matchesSelection(SAMPLE_ROWS[2], sel), false); // F2, Stationary Energy
  assert.equal(matchesSelection(SAMPLE_ROWS[3], sel), false);
});

test("matchesSelection returns false when row is null/undefined", () => {
  const sel = { facility_id: "F1" };
  assert.equal(matchesSelection(null, sel), false);
  assert.equal(matchesSelection(undefined, sel), false);
});

test("applySelectionToRows partitions rows into selected and rest", () => {
  const sel = { facility_id: "F1" };
  const { selected, rest } = applySelectionToRows(SAMPLE_ROWS, sel);
  assert.equal(selected.length, 2);
  assert.equal(rest.length, 2);
  // Order preserved within each partition.
  assert.equal(selected[0].activity_type_id, "scope1_mobile_gasoline");
  assert.equal(rest[0].facility_id, "F2");
});

test("applySelectionToRows puts everything in rest when selection is null", () => {
  const { selected, rest } = applySelectionToRows(SAMPLE_ROWS, null);
  assert.equal(selected.length, 0);
  assert.equal(rest.length, 4);
});

test("applySelectionToRows handles facility+category selection with single match", () => {
  const sel = { facility_id: "F1", category: "Stationary Energy" };
  const { selected, rest } = applySelectionToRows(SAMPLE_ROWS, sel);
  assert.equal(selected.length, 1);
  assert.equal(rest.length, 3);
  assert.equal(selected[0].activity_type_id, "scope2_purchased_electricity_grid_mix");
});

test("applySelectionToRows returns empty selected when nothing matches", () => {
  const sel = { facility_id: "F999" };
  const { selected, rest } = applySelectionToRows(SAMPLE_ROWS, sel);
  assert.equal(selected.length, 0);
  assert.equal(rest.length, 4);
});
