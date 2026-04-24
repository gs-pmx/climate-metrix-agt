import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExistingPairsSet,
  computeReportingUnitProgress,
  ensureActivityApplicable,
  filterApplicableActivities,
  filterApplicableReportingUnits,
  filterRowsApplicable,
  getSelectedActivityTypeIds,
  groupActivitiesByScope,
  isActivityApplicable,
} from "./applicability.js";

// ---------------------------------------------------------------------------
// Minimal catalog fixtures. Only the fields applicability / progress inspect
// are populated (activity_type_id, label, scope, implementation_status, and
// the input_schema/default_unit the row classifier needs).
// ---------------------------------------------------------------------------

const AT_NATURAL_GAS = {
  activity_type_id: "scope1_stationary_natural_gas",
  label: "Stationary Natural Gas",
  scope: "scope_1",
  implementation_status: "implemented",
  default_unit: "scf",
  allowed_units: ["scf", "therm", "mmbtu"],
  input_schema: {
    fields: [
      {
        field_id: "fuel_use",
        label: "Natural Gas Consumption",
        kind: "quantity",
        required: true,
        is_primary: true,
        default_unit: "scf",
        allowed_units: ["scf", "therm", "mmbtu"],
        options: [],
        param_key: null,
      },
    ],
    notes: [],
  },
};

const AT_ELECTRICITY = {
  activity_type_id: "scope2_electricity",
  label: "Purchased Electricity",
  scope: "scope_2",
  implementation_status: "implemented",
  default_unit: "kwh",
  allowed_units: ["kwh", "mwh"],
  input_schema: {
    fields: [
      {
        field_id: "energy_use",
        label: "Electricity",
        kind: "quantity",
        required: true,
        is_primary: true,
        default_unit: "kwh",
        allowed_units: ["kwh", "mwh"],
        options: [],
        param_key: null,
      },
    ],
    notes: [],
  },
};

const AT_BIZ_TRAVEL = {
  activity_type_id: "scope3_business_travel",
  label: "Business Travel",
  scope: "scope_3",
  implementation_status: "implemented",
  default_unit: "miles",
  allowed_units: ["miles"],
  input_schema: {
    fields: [
      {
        field_id: "distance",
        label: "Distance",
        kind: "quantity",
        required: true,
        is_primary: true,
        default_unit: "miles",
        allowed_units: ["miles"],
        options: [],
        param_key: null,
      },
    ],
    notes: [],
  },
};

const CATALOG = [AT_NATURAL_GAS, AT_ELECTRICITY, AT_BIZ_TRAVEL];

function makeRU(overrides = {}) {
  return {
    id: "F1",
    facility_name: "Acme HQ",
    applicable_activity_types: [],
    ...overrides,
  };
}

function makeDraft({ id = "A1", facilityId = "F1", activityTypeId, value = "", unit = "" }) {
  return {
    id,
    facility_id: facilityId,
    activity_type_id: activityTypeId,
    activity: { value, unit },
    params: {},
  };
}

// ---------------------------------------------------------------------------
// isActivityApplicable / filterApplicableActivities
// ---------------------------------------------------------------------------

test("empty applicable list is legacy permissive - every activity is applicable", () => {
  const ru = makeRU({ applicable_activity_types: [] });
  assert.equal(isActivityApplicable(ru, AT_NATURAL_GAS.activity_type_id), true);
  assert.equal(isActivityApplicable(ru, AT_ELECTRICITY.activity_type_id), true);
});

test("non-empty applicable list gates membership", () => {
  const ru = makeRU({ applicable_activity_types: [AT_NATURAL_GAS.activity_type_id] });
  assert.equal(isActivityApplicable(ru, AT_NATURAL_GAS.activity_type_id), true);
  assert.equal(isActivityApplicable(ru, AT_ELECTRICITY.activity_type_id), false);
});

test("filterApplicableActivities returns all when list is empty", () => {
  const ru = makeRU({ applicable_activity_types: [] });
  const out = filterApplicableActivities(ru, CATALOG);
  assert.equal(out.length, CATALOG.length);
});

test("filterApplicableActivities filters to explicit list", () => {
  const ru = makeRU({
    applicable_activity_types: [AT_NATURAL_GAS.activity_type_id, AT_BIZ_TRAVEL.activity_type_id],
  });
  const out = filterApplicableActivities(ru, CATALOG);
  assert.deepEqual(
    out.map((a) => a.activity_type_id),
    [AT_NATURAL_GAS.activity_type_id, AT_BIZ_TRAVEL.activity_type_id],
  );
});

// ---------------------------------------------------------------------------
// filterApplicableReportingUnits — By Activity view side
// ---------------------------------------------------------------------------

test("filterApplicableReportingUnits hides RUs whose explicit list excludes the activity", () => {
  const ruA = makeRU({ id: "F1", applicable_activity_types: [AT_NATURAL_GAS.activity_type_id] });
  const ruB = makeRU({ id: "F2", applicable_activity_types: [AT_ELECTRICITY.activity_type_id] });
  const ruLegacy = makeRU({ id: "F3", applicable_activity_types: [] }); // legacy permissive

  const forNG = filterApplicableReportingUnits([ruA, ruB, ruLegacy], AT_NATURAL_GAS.activity_type_id);
  assert.deepEqual(forNG.map((r) => r.id), ["F1", "F3"]);

  const forElec = filterApplicableReportingUnits([ruA, ruB, ruLegacy], AT_ELECTRICITY.activity_type_id);
  assert.deepEqual(forElec.map((r) => r.id), ["F2", "F3"]);
});

// ---------------------------------------------------------------------------
// buildExistingPairsSet — used by the dialog warn-on-uncheck path
// ---------------------------------------------------------------------------

test("buildExistingPairsSet collects pairs with meaningful data", () => {
  const drafts = [
    makeDraft({ id: "A1", facilityId: "F1", activityTypeId: "scope1_stationary_natural_gas", value: "123", unit: "scf" }),
    makeDraft({ id: "A2", facilityId: "F1", activityTypeId: "scope2_electricity" }), // blank
    makeDraft({ id: "A3", facilityId: "F2", activityTypeId: "scope1_stationary_natural_gas", value: "5", unit: "scf" }),
  ];
  const set = buildExistingPairsSet(drafts);
  assert.ok(set.has("F1::scope1_stationary_natural_gas"));
  assert.ok(!set.has("F1::scope2_electricity"));
  assert.ok(set.has("F2::scope1_stationary_natural_gas"));
});

test("buildExistingPairsSet skips incomplete keys defensively", () => {
  const drafts = [
    { id: "A1", activity: { value: "123", unit: "scf" }, params: {} }, // no facility_id
    { id: "A2", facility_id: "F1", activity: { value: "1", unit: "kwh" }, params: {} }, // no activity_type_id
  ];
  const set = buildExistingPairsSet(drafts);
  assert.equal(set.size, 0);
});

// ---------------------------------------------------------------------------
// groupActivitiesByScope — feeds the ConfigureSourcesDialog layout
// ---------------------------------------------------------------------------

test("groupActivitiesByScope sorts alphabetically within each scope", () => {
  const groups = groupActivitiesByScope(CATALOG);
  const keys = groups.map((g) => g.key);
  assert.deepEqual(keys, ["scope_1", "scope_2", "scope_3"]);
  assert.equal(groups[0].activities[0].activity_type_id, AT_NATURAL_GAS.activity_type_id);
});

test("groupActivitiesByScope handles unknown scope by dropping into Other", () => {
  const groups = groupActivitiesByScope([{ activity_type_id: "x", label: "X", scope: "offsets" }]);
  const keys = groups.map((g) => g.key);
  assert.deepEqual(keys, ["other"]);
});

// ---------------------------------------------------------------------------
// computeReportingUnitProgress
// ---------------------------------------------------------------------------

test("progress with empty applicable list falls back to catalog scope", () => {
  const ru = makeRU({ applicable_activity_types: [] });
  const progress = computeReportingUnitProgress({
    reportingUnit: ru,
    activityCatalog: CATALOG,
    activities: [],
  });
  assert.equal(progress.selected, 0);
  assert.equal(progress.legacyPermissive, true);
  assert.equal(progress.total, CATALOG.length);
  assert.equal(progress.withData, 0);
  assert.equal(progress.complete, 0);
});

test("progress counts 1-selected / 1-with-data / 0-complete for a missing-unit draft", () => {
  const ru = makeRU({ applicable_activity_types: [AT_NATURAL_GAS.activity_type_id] });
  const progress = computeReportingUnitProgress({
    reportingUnit: ru,
    activityCatalog: CATALOG,
    // A partial draft — value present but unit missing makes row not complete.
    activities: [makeDraft({ facilityId: "F1", activityTypeId: AT_NATURAL_GAS.activity_type_id, value: "500", unit: "" })],
  });
  assert.equal(progress.selected, 1);
  assert.equal(progress.withData, 1);
  assert.equal(progress.complete, 0);
  assert.equal(progress.total, 1);
  assert.equal(progress.legacyPermissive, false);
});

test("progress counts 1-selected / 1-with-data / 1-complete for a valid draft", () => {
  const ru = makeRU({ applicable_activity_types: [AT_NATURAL_GAS.activity_type_id] });
  const progress = computeReportingUnitProgress({
    reportingUnit: ru,
    activityCatalog: CATALOG,
    activities: [makeDraft({ facilityId: "F1", activityTypeId: AT_NATURAL_GAS.activity_type_id, value: "1000", unit: "scf" })],
  });
  assert.equal(progress.selected, 1);
  assert.equal(progress.withData, 1);
  assert.equal(progress.complete, 1);
});

test("progress ignores drafts for other reporting units", () => {
  const ru = makeRU({ id: "F1", applicable_activity_types: [AT_NATURAL_GAS.activity_type_id] });
  const progress = computeReportingUnitProgress({
    reportingUnit: ru,
    activityCatalog: CATALOG,
    activities: [makeDraft({ facilityId: "F2", activityTypeId: AT_NATURAL_GAS.activity_type_id, value: "500", unit: "scf" })],
  });
  assert.equal(progress.withData, 0);
  assert.equal(progress.complete, 0);
});

// ---------------------------------------------------------------------------
// ensureActivityApplicable - Bug 1 regression (auto-add-with-toast)
// ---------------------------------------------------------------------------

test("ensureActivityApplicable is a no-op for a legacy permissive unit", () => {
  const permissive = makeRU({ id: "F1", applicable_activity_types: [] });
  const rus = [permissive];
  const result = ensureActivityApplicable({
    reportingUnits: rus,
    reportingUnitId: "F1",
    activityTypeId: AT_NATURAL_GAS.activity_type_id,
  });
  assert.equal(result.wasAdded, false);
  // Input array must be reference-identical so callers can skip state updates.
  assert.equal(result.reportingUnits, rus);
});

test("ensureActivityApplicable appends activity to configured unit missing it", () => {
  const configured = makeRU({
    id: "F1",
    applicable_activity_types: [AT_ELECTRICITY.activity_type_id],
  });
  const rus = [configured];
  const result = ensureActivityApplicable({
    reportingUnits: rus,
    reportingUnitId: "F1",
    activityTypeId: AT_NATURAL_GAS.activity_type_id,
  });
  assert.equal(result.wasAdded, true);
  assert.notEqual(result.reportingUnits, rus);
  assert.deepEqual(result.reportingUnits[0].applicable_activity_types, [
    AT_ELECTRICITY.activity_type_id,
    AT_NATURAL_GAS.activity_type_id,
  ]);
  // Original RU must not be mutated.
  assert.deepEqual(configured.applicable_activity_types, [
    AT_ELECTRICITY.activity_type_id,
  ]);
});

test("ensureActivityApplicable is a no-op when the configured list already has it", () => {
  const configured = makeRU({
    id: "F1",
    applicable_activity_types: [AT_NATURAL_GAS.activity_type_id],
  });
  const rus = [configured];
  const result = ensureActivityApplicable({
    reportingUnits: rus,
    reportingUnitId: "F1",
    activityTypeId: AT_NATURAL_GAS.activity_type_id,
  });
  assert.equal(result.wasAdded, false);
  assert.equal(result.reportingUnits, rus);
});

test("ensureActivityApplicable is a no-op when the unit id is unknown", () => {
  const rus = [
    makeRU({ id: "F1", applicable_activity_types: [AT_ELECTRICITY.activity_type_id] }),
  ];
  const result = ensureActivityApplicable({
    reportingUnits: rus,
    reportingUnitId: "F_DOES_NOT_EXIST",
    activityTypeId: AT_NATURAL_GAS.activity_type_id,
  });
  assert.equal(result.wasAdded, false);
  assert.equal(result.reportingUnits, rus);
});

test("ensureActivityApplicable is a no-op with missing required args", () => {
  const rus = [makeRU({ id: "F1", applicable_activity_types: ["x"] })];
  assert.equal(
    ensureActivityApplicable({ reportingUnits: rus, reportingUnitId: "", activityTypeId: "y" })
      .wasAdded,
    false,
  );
  assert.equal(
    ensureActivityApplicable({ reportingUnits: rus, reportingUnitId: "F1", activityTypeId: "" })
      .wasAdded,
    false,
  );
});

test("progress with 2 applicable + 1 complete + 1 blank yields 2/1/1", () => {
  const ru = makeRU({
    applicable_activity_types: [AT_NATURAL_GAS.activity_type_id, AT_ELECTRICITY.activity_type_id],
  });
  const progress = computeReportingUnitProgress({
    reportingUnit: ru,
    activityCatalog: CATALOG,
    activities: [
      makeDraft({ facilityId: "F1", activityTypeId: AT_NATURAL_GAS.activity_type_id, value: "1000", unit: "scf" }),
    ],
  });
  assert.equal(progress.selected, 2);
  assert.equal(progress.withData, 1);
  assert.equal(progress.complete, 1);
  assert.equal(progress.total, 2);
});

// ---------------------------------------------------------------------------
// filterRowsApplicable — guards the /calculate payload from deselected rows
// ---------------------------------------------------------------------------

test("filterRowsApplicable passes rows for units with empty applicable list", () => {
  const rus = [{ id: "ru1", applicable_activity_types: [] }];
  const rows = [
    { facility_id: "ru1", activity_type_id: "scope1_mobile_diesel" },
    { facility_id: "ru1", activity_type_id: "scope1_stationary_natural_gas" },
  ];
  const out = filterRowsApplicable(rows, rus);
  assert.equal(out.length, 2);
});

test("filterRowsApplicable excludes rows for (RU, activity) pairs not in the RU's applicable list", () => {
  const rus = [
    { id: "ru1", applicable_activity_types: ["scope1_stationary_natural_gas"] },
  ];
  const rows = [
    { facility_id: "ru1", activity_type_id: "scope1_stationary_natural_gas", activity: { value: 100 } },
    { facility_id: "ru1", activity_type_id: "scope1_mobile_diesel", activity: { value: 25 } },
  ];
  const out = filterRowsApplicable(rows, rus);
  assert.equal(out.length, 1);
  assert.equal(out[0].activity_type_id, "scope1_stationary_natural_gas");
});

test("filterRowsApplicable treats unknown facility_id as permissive (empty-list semantic)", () => {
  // isActivityApplicable treats undefined/missing RU as an empty applicable
  // list, which is legacy permissive. Rows for unknown facility_ids are
  // ultimately filtered out at the dataEntryFacilityIds.has() gate in the
  // calling runCalculation, not here. This helper stays permissive so it
  // composes cleanly with that outer filter.
  const rus = [{ id: "ru1", applicable_activity_types: ["scope1_stationary_natural_gas"] }];
  const rows = [
    { facility_id: "ru_unknown", activity_type_id: "scope1_stationary_natural_gas" },
  ];
  const out = filterRowsApplicable(rows, rus);
  assert.equal(out.length, 1);
});

test("filterRowsApplicable returns [] for non-array rows input", () => {
  assert.deepEqual(filterRowsApplicable(undefined, []), []);
  assert.deepEqual(filterRowsApplicable(null, []), []);
});

// ---------------------------------------------------------------------------
// getSelectedActivityTypeIds — feeds the "hide unused" toggle in By Activity
// ---------------------------------------------------------------------------

test("getSelectedActivityTypeIds returns empty set when every unit's list is empty", () => {
  const rus = [
    makeRU({ id: "F1", applicable_activity_types: [] }),
    makeRU({ id: "F2", applicable_activity_types: [] }),
  ];
  const set = getSelectedActivityTypeIds(rus);
  assert.equal(set.size, 0);
});

test("getSelectedActivityTypeIds unions a single configured unit alongside an empty unit", () => {
  const rus = [
    makeRU({
      id: "F1",
      applicable_activity_types: [AT_NATURAL_GAS.activity_type_id, AT_ELECTRICITY.activity_type_id],
    }),
    makeRU({ id: "F2", applicable_activity_types: [] }),
  ];
  const set = getSelectedActivityTypeIds(rus);
  assert.equal(set.size, 2);
  assert.ok(set.has(AT_NATURAL_GAS.activity_type_id));
  assert.ok(set.has(AT_ELECTRICITY.activity_type_id));
});

test("getSelectedActivityTypeIds unions overlapping lists across units without double-counting", () => {
  const rus = [
    makeRU({
      id: "F1",
      applicable_activity_types: [AT_NATURAL_GAS.activity_type_id, AT_ELECTRICITY.activity_type_id],
    }),
    makeRU({
      id: "F2",
      applicable_activity_types: [AT_ELECTRICITY.activity_type_id, AT_BIZ_TRAVEL.activity_type_id],
    }),
  ];
  const set = getSelectedActivityTypeIds(rus);
  assert.equal(set.size, 3);
  assert.ok(set.has(AT_NATURAL_GAS.activity_type_id));
  assert.ok(set.has(AT_ELECTRICITY.activity_type_id));
  assert.ok(set.has(AT_BIZ_TRAVEL.activity_type_id));
});

test("getSelectedActivityTypeIds handles undefined / non-array input defensively", () => {
  assert.equal(getSelectedActivityTypeIds(undefined).size, 0);
  assert.equal(getSelectedActivityTypeIds(null).size, 0);
  assert.equal(getSelectedActivityTypeIds("nope").size, 0);
  assert.equal(getSelectedActivityTypeIds([{ applicable_activity_types: "nope" }]).size, 0);
  assert.equal(getSelectedActivityTypeIds([{}]).size, 0);
  // Falsy ids inside a list are skipped.
  assert.equal(
    getSelectedActivityTypeIds([{ applicable_activity_types: ["", null, undefined] }]).size,
    0,
  );
});

test("filterRowsApplicable respects each RU independently across a mixed payload", () => {
  const rus = [
    { id: "ru1", applicable_activity_types: ["scope1_stationary_natural_gas"] },
    { id: "ru2", applicable_activity_types: [] },
  ];
  const rows = [
    { facility_id: "ru1", activity_type_id: "scope1_stationary_natural_gas" },
    { facility_id: "ru1", activity_type_id: "scope1_mobile_diesel" },
    { facility_id: "ru2", activity_type_id: "scope1_mobile_diesel" },
    { facility_id: "ru2", activity_type_id: "scope1_stationary_natural_gas" },
  ];
  const out = filterRowsApplicable(rows, rus);
  assert.equal(out.length, 3);
  assert.ok(out.some((r) => r.facility_id === "ru1" && r.activity_type_id === "scope1_stationary_natural_gas"));
  assert.ok(out.some((r) => r.facility_id === "ru2" && r.activity_type_id === "scope1_mobile_diesel"));
  assert.ok(out.some((r) => r.facility_id === "ru2" && r.activity_type_id === "scope1_stationary_natural_gas"));
  assert.ok(!out.some((r) => r.facility_id === "ru1" && r.activity_type_id === "scope1_mobile_diesel"));
});
