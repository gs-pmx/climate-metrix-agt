import assert from "node:assert/strict";
import test from "node:test";

import {
  STARTER_DEFAULT_IDS,
  addDefaultsToChecked,
  buildActivitySelection,
  buildReportingUnitSelection,
  collectChecked,
  defaultsPresentInCatalog,
  initialSetFromReportingUnit,
  makeApplyPerActivityUpdate,
  makeApplyPerReportingUnitUpdate,
  selectAllInScope,
  setDefaultsAsChecked,
  shouldWarnOnUncheck,
  toggleActivity,
} from "./configureSources.js";

const CATALOG = [
  { activity_type_id: "scope1_stationary_natural_gas", label: "Stationary Natural Gas", scope: "scope_1" },
  { activity_type_id: "scope2_electricity", label: "Purchased Electricity", scope: "scope_2" },
  { activity_type_id: "scope3_business_travel", label: "Business Travel", scope: "scope_3" },
];

// ---------------------------------------------------------------------------
// Initial state + basic reducers
// ---------------------------------------------------------------------------

test("initialSetFromReportingUnit pre-checks the current applicable_activity_types", () => {
  const ru = {
    id: "F1",
    applicable_activity_types: ["scope1_stationary_natural_gas", "scope2_electricity"],
  };
  const set = initialSetFromReportingUnit(ru);
  assert.equal(set.size, 2);
  assert.ok(set.has("scope1_stationary_natural_gas"));
  assert.ok(set.has("scope2_electricity"));
  assert.ok(!set.has("scope3_business_travel"));
});

test("initialSetFromReportingUnit returns empty set when list is missing or empty", () => {
  assert.equal(initialSetFromReportingUnit({}).size, 0);
  assert.equal(initialSetFromReportingUnit({ applicable_activity_types: [] }).size, 0);
  assert.equal(initialSetFromReportingUnit(null).size, 0);
});

test("toggleActivity adds an unchecked id and returns a new Set", () => {
  const before = new Set(["scope1_stationary_natural_gas"]);
  const after = toggleActivity(before, "scope2_electricity");
  assert.ok(before !== after);
  assert.equal(after.size, 2);
  assert.ok(after.has("scope2_electricity"));
  // original set untouched
  assert.equal(before.size, 1);
});

test("toggleActivity removes a checked id", () => {
  const before = new Set(["scope1_stationary_natural_gas", "scope2_electricity"]);
  const after = toggleActivity(before, "scope1_stationary_natural_gas");
  assert.ok(!after.has("scope1_stationary_natural_gas"));
  assert.equal(after.size, 1);
});

// ---------------------------------------------------------------------------
// collectChecked - producing the save payload
// ---------------------------------------------------------------------------

test("collectChecked returns catalog-ordered list of checked ids", () => {
  const checked = new Set(["scope2_electricity", "scope1_stationary_natural_gas"]);
  const out = collectChecked(checked, CATALOG);
  assert.deepEqual(out, ["scope1_stationary_natural_gas", "scope2_electricity"]);
});

test("collectChecked preserves checked ids that are not in the catalog", () => {
  const checked = new Set(["scope1_stationary_natural_gas", "legacy_unknown_activity"]);
  const out = collectChecked(checked, CATALOG);
  assert.ok(out.includes("scope1_stationary_natural_gas"));
  assert.ok(out.includes("legacy_unknown_activity"));
});

test("save round-trip: initial set -> toggle -> collect = expected list", () => {
  const ru = {
    id: "F1",
    applicable_activity_types: ["scope1_stationary_natural_gas"],
  };
  let checked = initialSetFromReportingUnit(ru);
  checked = toggleActivity(checked, "scope3_business_travel"); // add
  checked = toggleActivity(checked, "scope1_stationary_natural_gas"); // remove
  const saved = collectChecked(checked, CATALOG);
  assert.deepEqual(saved, ["scope3_business_travel"]);
});

// ---------------------------------------------------------------------------
// shouldWarnOnUncheck
// ---------------------------------------------------------------------------

test("shouldWarnOnUncheck is true when initially-checked id is unchecked and data exists", () => {
  const ru = { id: "F1", applicable_activity_types: ["scope1_stationary_natural_gas"] };
  const existing = new Set(["F1::scope1_stationary_natural_gas"]);
  const warn = shouldWarnOnUncheck({
    reportingUnit: ru,
    activityTypeId: "scope1_stationary_natural_gas",
    currentChecked: false,
    existingPairsSet: existing,
  });
  assert.equal(warn, true);
});

test("shouldWarnOnUncheck is false when the id is still checked", () => {
  const ru = { id: "F1", applicable_activity_types: ["scope1_stationary_natural_gas"] };
  const existing = new Set(["F1::scope1_stationary_natural_gas"]);
  const warn = shouldWarnOnUncheck({
    reportingUnit: ru,
    activityTypeId: "scope1_stationary_natural_gas",
    currentChecked: true,
    existingPairsSet: existing,
  });
  assert.equal(warn, false);
});

test("shouldWarnOnUncheck is false when there is no existing data for the pair", () => {
  const ru = { id: "F1", applicable_activity_types: ["scope1_stationary_natural_gas"] };
  const existing = new Set(); // no drafts yet
  const warn = shouldWarnOnUncheck({
    reportingUnit: ru,
    activityTypeId: "scope1_stationary_natural_gas",
    currentChecked: false,
    existingPairsSet: existing,
  });
  assert.equal(warn, false);
});

test("shouldWarnOnUncheck is false when the id was not initially checked", () => {
  // Unchecking something the user just added in this dialog session is
  // never destructive — they're adding+removing without committing.
  const ru = { id: "F1", applicable_activity_types: [] };
  const existing = new Set(["F1::scope1_stationary_natural_gas"]);
  const warn = shouldWarnOnUncheck({
    reportingUnit: ru,
    activityTypeId: "scope1_stationary_natural_gas",
    currentChecked: false,
    existingPairsSet: existing,
  });
  assert.equal(warn, false);
});

// ---------------------------------------------------------------------------
// buildReportingUnitSelection - per-activity dialog payload
// ---------------------------------------------------------------------------

test("buildReportingUnitSelection exposes per-RU checked state for a header activity", () => {
  const units = [
    { id: "F1", facility_name: "HQ", applicable_activity_types: ["scope2_electricity"] },
    { id: "F2", facility_name: "Warehouse", applicable_activity_types: [] },
    { id: "F3", facility_name: "Lab", applicable_activity_types: ["scope1_stationary_natural_gas", "scope2_electricity"] },
  ];
  const sel = buildReportingUnitSelection(units, "scope2_electricity");
  assert.equal(sel.length, 3);
  assert.equal(sel[0].checked, true);
  // empty list -> NOT pre-checked in the per-activity dialog (explicit UI
  // action required for legacy RUs to join the checklist).
  assert.equal(sel[1].checked, false);
  assert.equal(sel[2].checked, true);
});

// ---------------------------------------------------------------------------
// makeApplyPerActivityUpdate - per-activity save path
// ---------------------------------------------------------------------------

test("per-activity save adds activity_type_id to newly-checked RUs", () => {
  const units = [
    { id: "F1", applicable_activity_types: [] },
    { id: "F2", applicable_activity_types: ["scope2_electricity"] },
  ];
  const apply = makeApplyPerActivityUpdate({
    activityTypeId: "scope1_stationary_natural_gas",
    checkedById: { F1: true, F2: true },
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, ["scope1_stationary_natural_gas"]);
  assert.deepEqual(next[1].applicable_activity_types, ["scope2_electricity", "scope1_stationary_natural_gas"]);
});

test("per-activity save removes activity_type_id from newly-unchecked RUs", () => {
  const units = [
    { id: "F1", applicable_activity_types: ["scope1_stationary_natural_gas", "scope2_electricity"] },
    { id: "F2", applicable_activity_types: ["scope1_stationary_natural_gas"] },
  ];
  const apply = makeApplyPerActivityUpdate({
    activityTypeId: "scope1_stationary_natural_gas",
    checkedById: { F1: false, F2: false },
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, ["scope2_electricity"]);
  assert.deepEqual(next[1].applicable_activity_types, []);
});

test("per-activity save leaves RUs not present in checkedById untouched", () => {
  const units = [
    { id: "F1", applicable_activity_types: [] },
    { id: "F2", applicable_activity_types: ["scope2_electricity"] },
  ];
  const apply = makeApplyPerActivityUpdate({
    activityTypeId: "scope1_stationary_natural_gas",
    checkedById: { F1: true }, // F2 not mentioned
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, ["scope1_stationary_natural_gas"]);
  // F2 identity preserved
  assert.equal(next[1], units[1]);
});

// ---------------------------------------------------------------------------
// Phase C4: starter defaults + per-scope select-all helpers
// ---------------------------------------------------------------------------

test("defaultsPresentInCatalog filters to ids actually in the catalog", () => {
  const catalog = [
    { activity_type_id: "scope1_stationary_natural_gas" },
    { activity_type_id: "scope2_purchased_electricity_grid_mix" },
  ];
  const result = defaultsPresentInCatalog(catalog);
  assert.deepEqual(result, [
    "scope1_stationary_natural_gas",
    "scope2_purchased_electricity_grid_mix",
  ]);
});

test("addDefaultsToChecked unions with the existing set", () => {
  const checked = new Set(["custom_x"]);
  const catalog = [
    { activity_type_id: "scope1_stationary_natural_gas" },
    { activity_type_id: "scope3_waste_generated_in_operations" },
  ];
  const next = addDefaultsToChecked(checked, catalog);
  assert.ok(next.has("custom_x"));
  assert.ok(next.has("scope1_stationary_natural_gas"));
  assert.ok(next.has("scope3_waste_generated_in_operations"));
});

test("setDefaultsAsChecked discards existing selections", () => {
  const catalog = [
    { activity_type_id: "scope1_stationary_natural_gas" },
    { activity_type_id: "scope2_purchased_electricity_grid_mix" },
  ];
  const next = setDefaultsAsChecked(catalog);
  assert.equal(next.size, 2);
  assert.ok(next.has("scope1_stationary_natural_gas"));
});

test("STARTER_DEFAULT_IDS covers all three scopes", () => {
  assert.ok(STARTER_DEFAULT_IDS.some((id) => id.startsWith("scope1_")));
  assert.ok(STARTER_DEFAULT_IDS.some((id) => id.startsWith("scope2_")));
  assert.ok(STARTER_DEFAULT_IDS.some((id) => id.startsWith("scope3_")));
});

// ---------------------------------------------------------------------------
// Phase C4: per-Reporting-Unit "+ Add Activity" dialog helpers
// ---------------------------------------------------------------------------

test("buildActivitySelection exposes per-activity checked state for a reporting unit", () => {
  const ru = {
    id: "F1",
    applicable_activity_types: ["scope2_electricity"],
  };
  const catalog = [
    { activity_type_id: "scope1_stationary_natural_gas", label: "NG" },
    { activity_type_id: "scope2_electricity", label: "Elec" },
    { activity_type_id: "scope3_business_travel", label: "BT" },
  ];
  const rows = buildActivitySelection(ru, catalog);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].checked, false);
  assert.equal(rows[1].checked, true);
  assert.equal(rows[2].checked, false);
});

test("buildActivitySelection treats missing applicable_activity_types as nothing-checked", () => {
  const ru = { id: "F1" };
  const catalog = [{ activity_type_id: "scope1_a" }];
  const rows = buildActivitySelection(ru, catalog);
  assert.equal(rows[0].checked, false);
});

test("per-RU save adds newly-checked activity_type_ids", () => {
  const units = [
    { id: "F1", applicable_activity_types: ["scope2_electricity"] },
    { id: "F2", applicable_activity_types: ["scope3_business_travel"] },
  ];
  const apply = makeApplyPerReportingUnitUpdate({
    reportingUnitId: "F1",
    checkedById: { scope1_stationary_natural_gas: true },
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, [
    "scope2_electricity",
    "scope1_stationary_natural_gas",
  ]);
  assert.equal(next[1], units[1]);
});

test("per-RU save removes newly-unchecked activity_type_ids", () => {
  const units = [
    { id: "F1", applicable_activity_types: ["scope2_electricity", "scope1_stationary_natural_gas"] },
  ];
  const apply = makeApplyPerReportingUnitUpdate({
    reportingUnitId: "F1",
    checkedById: { scope2_electricity: false },
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, ["scope1_stationary_natural_gas"]);
});

test("per-RU save leaves other RUs untouched", () => {
  const units = [
    { id: "F1", applicable_activity_types: [] },
    { id: "F2", applicable_activity_types: ["scope2_electricity"] },
  ];
  const apply = makeApplyPerReportingUnitUpdate({
    reportingUnitId: "F1",
    checkedById: { scope1_stationary_natural_gas: true },
  });
  const next = apply(units);
  assert.equal(next[1], units[1]);
  assert.deepEqual(next[0].applicable_activity_types, ["scope1_stationary_natural_gas"]);
});

test("per-RU save is identity-stable when no actual change is requested", () => {
  const units = [
    { id: "F1", applicable_activity_types: ["scope2_electricity"] },
  ];
  const apply = makeApplyPerReportingUnitUpdate({
    reportingUnitId: "F1",
    checkedById: { scope2_electricity: true, scope3_business_travel: false },
  });
  const next = apply(units);
  assert.equal(next[0], units[0]);
});

test("per-RU save materializes an empty permissive list when the first activity is added", () => {
  const units = [{ id: "F1", applicable_activity_types: [] }];
  const apply = makeApplyPerReportingUnitUpdate({
    reportingUnitId: "F1",
    checkedById: { scope1_stationary_natural_gas: true },
  });
  const next = apply(units);
  assert.deepEqual(next[0].applicable_activity_types, ["scope1_stationary_natural_gas"]);
});

test("selectAllInScope adds every matching activity and preserves existing", () => {
  const catalog = [
    { activity_type_id: "scope1_a", scope: "Scope 1" },
    { activity_type_id: "scope1_b", scope: "Scope 1" },
    { activity_type_id: "scope2_c", scope: "Scope 2" },
  ];
  const starting = new Set(["custom_x"]);
  const next = selectAllInScope(starting, catalog, (s) => /scope\s*1/i.test(s || ""));
  assert.ok(next.has("custom_x"));
  assert.ok(next.has("scope1_a"));
  assert.ok(next.has("scope1_b"));
  assert.ok(!next.has("scope2_c"));
});
