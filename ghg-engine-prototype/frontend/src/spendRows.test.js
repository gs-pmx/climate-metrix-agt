import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendSpendRow,
  createEmptySpendRow,
  deleteSpendRow,
  getSpendRowsForRu,
  isSpendRow,
  patchSpendRow,
  validateSpendRow,
  SPEND_BASED_ACTIVITY_ID,
} from "./spendRows.js";

test("createEmptySpendRow stamps the spend activity type and an empty quantity", () => {
  const row = createEmptySpendRow("ru1");
  assert.equal(row.activity_type_id, SPEND_BASED_ACTIVITY_ID);
  assert.equal(row.facility_id, "ru1");
  assert.equal(row.activity.unit, "USD");
  assert.equal(row.activity.value, "");
  assert.equal(row.params.gl_code, "");
  assert.equal(row.params.gl_account_name, "");
});

test("createEmptySpendRow gives every row a unique id", () => {
  const a = createEmptySpendRow("ru1");
  const b = createEmptySpendRow("ru1");
  assert.notEqual(a.id, b.id);
});

test("isSpendRow only fires for the spend activity type", () => {
  assert.equal(isSpendRow(null), false);
  assert.equal(isSpendRow({ activity_type_id: SPEND_BASED_ACTIVITY_ID }), true);
  assert.equal(isSpendRow({ activity_type_id: "scope1_natural_gas" }), false);
});

test("getSpendRowsForRu filters by activity type and reporting unit", () => {
  const activities = [
    { id: "a", activity_type_id: SPEND_BASED_ACTIVITY_ID, facility_id: "ru1" },
    { id: "b", activity_type_id: SPEND_BASED_ACTIVITY_ID, facility_id: "ru2" },
    { id: "c", activity_type_id: "scope1_natural_gas", facility_id: "ru1" },
  ];
  const rows = getSpendRowsForRu(activities, "ru1");
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
});

test("getSpendRowsForRu defends against null inputs", () => {
  assert.deepEqual(getSpendRowsForRu(null, "ru1"), []);
  assert.deepEqual(getSpendRowsForRu([], ""), []);
});

test("appendSpendRow returns a new array containing a fresh row for the RU", () => {
  const before = [{ id: "x", activity_type_id: "scope1_natural_gas", facility_id: "ru1" }];
  const { activities, newRowId } = appendSpendRow(before, "ru1");
  assert.equal(activities.length, 2);
  assert.notEqual(activities, before, "should not mutate the input array");
  assert.equal(activities[1].id, newRowId);
  assert.equal(activities[1].facility_id, "ru1");
});

test("deleteSpendRow drops the row matching the id", () => {
  const before = [
    { id: "a", activity_type_id: SPEND_BASED_ACTIVITY_ID, facility_id: "ru1" },
    { id: "b", activity_type_id: SPEND_BASED_ACTIVITY_ID, facility_id: "ru1" },
  ];
  const after = deleteSpendRow(before, "a");
  assert.deepEqual(after.map((r) => r.id), ["b"]);
});

test("patchSpendRow updates activity.value and params keys, leaves siblings intact", () => {
  const before = [
    {
      id: "a",
      activity_type_id: SPEND_BASED_ACTIVITY_ID,
      facility_id: "ru1",
      activity: { value: "", unit: "USD" },
      params: { gl_code: "", gl_account_name: "" },
    },
    {
      id: "b",
      activity_type_id: SPEND_BASED_ACTIVITY_ID,
      facility_id: "ru1",
      activity: { value: 200, unit: "USD" },
      params: { gl_code: "G2" },
    },
  ];
  const after = patchSpendRow(before, "a", {
    activity_value: 1000,
    "param.gl_code": "G1",
    "param.gl_account_name": "Office Supplies",
  });
  const a = after.find((r) => r.id === "a");
  const b = after.find((r) => r.id === "b");
  assert.equal(a.activity.value, 1000);
  assert.equal(a.activity.unit, "USD");
  assert.equal(a.params.gl_code, "G1");
  assert.equal(a.params.gl_account_name, "Office Supplies");
  assert.equal(b, before[1], "untouched row should keep object identity");
});

test("patchSpendRow ignores patches targeted at non-spend rows of the same id", () => {
  const before = [
    { id: "x", activity_type_id: "scope1_natural_gas", facility_id: "ru1", activity: { value: 100, unit: "kwh" } },
  ];
  const after = patchSpendRow(before, "x", { activity_value: 9999 });
  assert.equal(after[0].activity.value, 100);
});

// Validation -----------------------------------------------------------------

function _spendRow({ glCode = "", spend = "" } = {}) {
  return {
    id: "r1",
    facility_id: "ru1",
    activity_type_id: SPEND_BASED_ACTIVITY_ID,
    activity: { value: spend, unit: "USD" },
    params: { gl_code: glCode, gl_account_name: "" },
  };
}

test("validateSpendRow flags blank gl_code and blank spend independently", () => {
  assert.deepEqual(validateSpendRow(_spendRow({ glCode: "", spend: "" })), [
    "missing_gl_code",
    "missing_spend",
  ]);
});

test("validateSpendRow flags unmapped gl_code when no mapping exists for this RU", () => {
  const warnings = validateSpendRow(
    _spendRow({ glCode: "G123", spend: 1000 }),
    [{ gl_code: "G_OTHER", factor_id: "useeio:1" }],
  );
  assert.deepEqual(warnings, ["unmapped_gl_code"]);
});

test("validateSpendRow returns no warnings when gl_code maps and spend is set", () => {
  assert.deepEqual(
    validateSpendRow(
      _spendRow({ glCode: "G123", spend: 1000 }),
      [{ gl_code: "G123", factor_id: "useeio:1" }],
    ),
    [],
  );
});

test("validateSpendRow accepts zero and negative spend values without flagging missing_spend", () => {
  const mappings = [{ gl_code: "G123", factor_id: "useeio:1" }];
  assert.deepEqual(validateSpendRow(_spendRow({ glCode: "G123", spend: 0 }), mappings), []);
  assert.deepEqual(validateSpendRow(_spendRow({ glCode: "G123", spend: -100 }), mappings), []);
});

test("validateSpendRow flags an unmapped gl_code that is just whitespace", () => {
  const warnings = validateSpendRow(
    _spendRow({ glCode: "   ", spend: 100 }),
    [{ gl_code: "G123", factor_id: "useeio:1" }],
  );
  assert.deepEqual(warnings, ["missing_gl_code"]);
});

test("validateSpendRow returns empty list for non-spend activities", () => {
  assert.deepEqual(
    validateSpendRow({ activity_type_id: "scope1_natural_gas" }),
    [],
  );
});
