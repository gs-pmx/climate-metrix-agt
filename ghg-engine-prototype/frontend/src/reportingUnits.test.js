import assert from "node:assert/strict";
import test from "node:test";

import {
  countActivitiesWithDataForUnit,
  removeActivitiesForReportingUnit,
  removeReportingUnitFromList,
} from "./reportingUnits.js";

// ---------------------------------------------------------------------------
// removeReportingUnitFromList
// ---------------------------------------------------------------------------

test("removeReportingUnitFromList drops the matching unit", () => {
  const units = [
    { id: "ru_a", facility_name: "A" },
    { id: "ru_b", facility_name: "B" },
    { id: "ru_c", facility_name: "C" },
  ];
  const next = removeReportingUnitFromList(units, "ru_b");
  assert.equal(next.length, 2);
  assert.deepEqual(next.map((u) => u.id), ["ru_a", "ru_c"]);
});

test("removeReportingUnitFromList returns same ref when id is not present", () => {
  const units = [{ id: "ru_a" }];
  const next = removeReportingUnitFromList(units, "ru_missing");
  assert.equal(next, units);
});

test("removeReportingUnitFromList tolerates empty / nullish input", () => {
  assert.deepEqual(removeReportingUnitFromList([], "ru_a"), []);
  assert.deepEqual(removeReportingUnitFromList(null, "ru_a"), []);
  assert.deepEqual(removeReportingUnitFromList(undefined, "ru_a"), []);
});

test("removeReportingUnitFromList tolerates falsy id (no-op)", () => {
  const units = [{ id: "ru_a" }];
  assert.equal(removeReportingUnitFromList(units, ""), units);
  assert.equal(removeReportingUnitFromList(units, null), units);
});

// ---------------------------------------------------------------------------
// removeActivitiesForReportingUnit
// ---------------------------------------------------------------------------

test("removeActivitiesForReportingUnit drops every draft with the matching facility_id", () => {
  const activities = [
    { id: "d1", facility_id: "ru_a", activity_type_id: "x" },
    { id: "d2", facility_id: "ru_b", activity_type_id: "x" },
    { id: "d3", facility_id: "ru_a", activity_type_id: "y" },
    { id: "d4", facility_id: "ru_c", activity_type_id: "z" },
  ];
  const next = removeActivitiesForReportingUnit(activities, "ru_a");
  assert.equal(next.length, 2);
  assert.deepEqual(next.map((d) => d.id), ["d2", "d4"]);
});

test("removeActivitiesForReportingUnit returns empty array for empty input", () => {
  assert.deepEqual(removeActivitiesForReportingUnit([], "ru_a"), []);
  assert.deepEqual(removeActivitiesForReportingUnit(null, "ru_a"), []);
});

test("removeActivitiesForReportingUnit leaves activities untouched when id absent", () => {
  const activities = [
    { id: "d1", facility_id: "ru_a" },
    { id: "d2", facility_id: "ru_b" },
  ];
  const next = removeActivitiesForReportingUnit(activities, "ru_missing");
  assert.equal(next.length, 2);
});

// ---------------------------------------------------------------------------
// countActivitiesWithDataForUnit
// ---------------------------------------------------------------------------

test("countActivitiesWithDataForUnit counts drafts with activity.value or non-blank params", () => {
  const activities = [
    // Has activity value -> counts.
    { id: "d1", facility_id: "ru_a", activity: { value: "100", unit: "kWh" }, params: {} },
    // Other unit -> ignored.
    { id: "d2", facility_id: "ru_b", activity: { value: "200", unit: "kWh" }, params: {} },
    // No value, no params -> does not count.
    { id: "d3", facility_id: "ru_a", activity: { value: "", unit: "" }, params: {} },
    // Non-blank string param -> counts.
    { id: "d4", facility_id: "ru_a", activity: { value: "", unit: "" }, params: { fuel_efficiency: "30" } },
    // Quantity param -> counts.
    { id: "d5", facility_id: "ru_a", activity: { value: "", unit: "" }, params: { distance: { value: "50", unit: "miles" } } },
    // Empty string param -> does not count.
    { id: "d6", facility_id: "ru_a", activity: { value: "", unit: "" }, params: { fuel_efficiency: "" } },
  ];
  assert.equal(countActivitiesWithDataForUnit(activities, "ru_a"), 3);
  assert.equal(countActivitiesWithDataForUnit(activities, "ru_b"), 1);
  assert.equal(countActivitiesWithDataForUnit(activities, "ru_missing"), 0);
});

test("countActivitiesWithDataForUnit returns 0 for empty / nullish input", () => {
  assert.equal(countActivitiesWithDataForUnit([], "ru_a"), 0);
  assert.equal(countActivitiesWithDataForUnit(null, "ru_a"), 0);
  assert.equal(countActivitiesWithDataForUnit(undefined, "ru_a"), 0);
});
