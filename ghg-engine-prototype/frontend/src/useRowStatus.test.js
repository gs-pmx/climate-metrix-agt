import assert from "node:assert/strict";
import test from "node:test";

import {
  ROW_STATUS,
  classifyRepeatableRow,
  classifyRow,
  filterErrorsForRow,
} from "./rowStatus.js";

const ACTIVITY_TYPE = {
  activity_type_id: "scope1_stationary_natural_gas",
  label: "Stationary Natural Gas",
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
      {
        field_id: "boiler_efficiency",
        label: "Boiler Efficiency",
        kind: "number",
        required: false,
        is_primary: false,
        param_key: "boiler_efficiency",
      },
      {
        field_id: "fuel_grade",
        label: "Fuel Grade",
        kind: "enum",
        required: false,
        is_primary: false,
        options: ["pipeline", "lng"],
        param_key: "fuel_grade",
      },
    ],
    notes: [],
  },
};

const PARTIAL_TYPE = { ...ACTIVITY_TYPE, implementation_status: "partial" };
const PLANNED_TYPE = { ...ACTIVITY_TYPE, implementation_status: "planned" };
const DEFERRED_TYPE = { ...ACTIVITY_TYPE, implementation_status: "deferred" };

function draftWith(overrides = {}) {
  return {
    id: "A1",
    facility_id: "F1",
    activity_type_id: ACTIVITY_TYPE.activity_type_id,
    activity: { value: "", unit: "scf" },
    params: {},
    ...overrides,
  };
}

test("blank draft is not-started", () => {
  const { status } = classifyRow(draftWith(), ACTIVITY_TYPE);
  assert.equal(status, ROW_STATUS.NOT_STARTED);
});

test("complete row with valid number is complete", () => {
  const { status, fieldErrors } = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.COMPLETE);
  assert.deepEqual(fieldErrors, {});
});

test("accepts thousands-separated primary values as complete", () => {
  const { status } = classifyRow(
    draftWith({ activity: { value: "12,345.6", unit: "scf" } }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.COMPLETE);
});

test("non-numeric primary value is invalid", () => {
  const { status, fieldErrors } = classifyRow(
    draftWith({ activity: { value: "abc", unit: "scf" } }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.INVALID);
  assert.ok(fieldErrors["Activity value"]);
});

test("unit outside allowed list is invalid", () => {
  const { status, fieldErrors } = classifyRow(
    draftWith({ activity: { value: "100", unit: "gallons" } }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.INVALID);
  assert.ok(fieldErrors["Activity unit"]);
});

test("partial-support activity with complete inputs is partial-support", () => {
  const { status } = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    PARTIAL_TYPE,
  );
  assert.equal(status, ROW_STATUS.PARTIAL_SUPPORT);
});

test("planned activity is always unsupported", () => {
  const { status } = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    PLANNED_TYPE,
  );
  assert.equal(status, ROW_STATUS.UNSUPPORTED);
});

test("deferred activity is always unsupported", () => {
  const { status } = classifyRow(draftWith(), DEFERRED_TYPE);
  assert.equal(status, ROW_STATUS.UNSUPPORTED);
});

test("detail field with invalid enum is invalid", () => {
  const { status, fieldErrors } = classifyRow(
    draftWith({
      activity: { value: "1000", unit: "scf" },
      params: { fuel_grade: "diesel" },
    }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.INVALID);
  assert.ok(fieldErrors["Fuel Grade"]);
});

test("detail field with invalid number is invalid", () => {
  const { status, fieldErrors } = classifyRow(
    draftWith({
      activity: { value: "1000", unit: "scf" },
      params: { boiler_efficiency: "ninety" },
    }),
    ACTIVITY_TYPE,
  );
  assert.equal(status, ROW_STATUS.INVALID);
  assert.ok(fieldErrors["Boiler Efficiency"]);
});

test("no activityType returns not-started", () => {
  const { status } = classifyRow(draftWith(), null);
  assert.equal(status, ROW_STATUS.NOT_STARTED);
});

test("row with only a partially-entered quantity detail is missing-details", () => {
  // Required detail field scenario — synthesize one.
  const typeWithRequired = {
    ...ACTIVITY_TYPE,
    input_schema: {
      ...ACTIVITY_TYPE.input_schema,
      fields: [
        ...ACTIVITY_TYPE.input_schema.fields,
        {
          field_id: "emission_factor_override",
          label: "Override Factor",
          kind: "quantity",
          required: true,
          is_primary: false,
          default_unit: "kg/mmbtu",
          allowed_units: ["kg/mmbtu"],
          param_key: "emission_factor_override",
        },
      ],
    },
  };
  const { status, missingRequired } = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    typeWithRequired,
  );
  assert.equal(status, ROW_STATUS.MISSING_DETAILS);
  assert.ok(missingRequired.includes("Override Factor"));
});

test("classifyRepeatableRow with no entries is not-started", () => {
  const { status, count } = classifyRepeatableRow([], ACTIVITY_TYPE);
  assert.equal(status, ROW_STATUS.NOT_STARTED);
  assert.equal(count, 0);
});

test("classifyRepeatableRow aggregates invalid entries", () => {
  const drafts = [
    draftWith({ activity: { value: "100", unit: "scf" } }),
    draftWith({ id: "A2", activity: { value: "abc", unit: "scf" } }),
  ];
  const { status } = classifyRepeatableRow(drafts, ACTIVITY_TYPE);
  assert.equal(status, ROW_STATUS.INVALID);
});

test("classifyRepeatableRow returns partial-support when all complete but type is partial", () => {
  const drafts = [draftWith({ activity: { value: "100", unit: "scf" } })];
  const { status, count } = classifyRepeatableRow(drafts, PARTIAL_TYPE);
  assert.equal(status, ROW_STATUS.PARTIAL_SUPPORT);
  assert.equal(count, 1);
});

test("classifyRepeatableRow unsupported for planned/deferred regardless of entries", () => {
  const drafts = [draftWith({ activity: { value: "100", unit: "scf" } })];
  assert.equal(classifyRepeatableRow(drafts, PLANNED_TYPE).status, ROW_STATUS.UNSUPPORTED);
  assert.equal(classifyRepeatableRow(drafts, DEFERRED_TYPE).status, ROW_STATUS.UNSUPPORTED);
});

// ---------------------------------------------------------------------------
// Backend-error overlay — Phase C1 row-level error attribution.
//
// classifyRow accepts an optional `errors` array of ActivityCalculationError
// envelopes (already filtered by the caller to the row's facility/activity
// pair). When non-empty, the row is reported as backend-error regardless
// of client-side classification.
// ---------------------------------------------------------------------------

const SAMPLE_ERROR = {
  activity_index: 0,
  activity_type_id: ACTIVITY_TYPE.activity_type_id,
  facility_id: "F1",
  error_code: "factor_not_found",
  message: "No emission factor for scope1_stationary_natural_gas",
  details: { exception_type: "ValueError" },
};

test("blank draft with a backend error is backend-error (overrides not-started)", () => {
  const result = classifyRow(draftWith(), ACTIVITY_TYPE, [SAMPLE_ERROR]);
  assert.equal(result.status, ROW_STATUS.BACKEND_ERROR);
  assert.equal(result.error, SAMPLE_ERROR);
});

test("complete draft with a backend error is backend-error (overrides complete)", () => {
  const result = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    ACTIVITY_TYPE,
    [SAMPLE_ERROR],
  );
  assert.equal(result.status, ROW_STATUS.BACKEND_ERROR);
  assert.equal(result.error.error_code, "factor_not_found");
});

test("row with an empty errors list classifies by client rules", () => {
  // An empty list — i.e. the caller filtered out non-matching errors —
  // must not flip the row to backend-error. This is the common case for
  // the majority of rows after a partial_success response.
  const result = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    ACTIVITY_TYPE,
    [],
  );
  assert.equal(result.status, ROW_STATUS.COMPLETE);
  assert.equal(result.error, undefined);
});

test("multiple backend errors on the same row surface the first", () => {
  const first = { ...SAMPLE_ERROR, error_code: "factor_not_found" };
  const second = { ...SAMPLE_ERROR, error_code: "calculation_error" };
  const result = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    ACTIVITY_TYPE,
    [first, second],
  );
  assert.equal(result.status, ROW_STATUS.BACKEND_ERROR);
  assert.equal(result.error, first);
});

test("backend error overrides unsupported for planned/deferred activities", () => {
  // Edge case: if the backend somehow errored on a planned activity (e.g.
  // a client submitted one despite the guard), the error still takes
  // precedence so the user gets actionable feedback.
  const result = classifyRow(draftWith(), PLANNED_TYPE, [SAMPLE_ERROR]);
  assert.equal(result.status, ROW_STATUS.BACKEND_ERROR);
});

test("classifyRepeatableRow surfaces backend-error when any error applies", () => {
  const drafts = [draftWith({ activity: { value: "100", unit: "scf" } })];
  const result = classifyRepeatableRow(drafts, ACTIVITY_TYPE, [SAMPLE_ERROR]);
  assert.equal(result.status, ROW_STATUS.BACKEND_ERROR);
  assert.equal(result.error, SAMPLE_ERROR);
  assert.equal(result.count, 1);
});

// ---------------------------------------------------------------------------
// filterErrorsForRow — the caller-side filter used by the hook and by
// grid renderers (ByActivityTable/ByFacilityTable) to slice the full
// response envelope down to the errors that belong to a single row.
// ---------------------------------------------------------------------------

test("filterErrorsForRow returns only errors matching facility and activity", () => {
  const errors = [
    { ...SAMPLE_ERROR, facility_id: "F1", activity_type_id: "scope1_stationary_natural_gas" },
    { ...SAMPLE_ERROR, facility_id: "F2", activity_type_id: "scope1_stationary_natural_gas" },
    { ...SAMPLE_ERROR, facility_id: "F1", activity_type_id: "scope2_electricity" },
  ];
  const filtered = filterErrorsForRow(errors, "F1", "scope1_stationary_natural_gas");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].facility_id, "F1");
  assert.equal(filtered[0].activity_type_id, "scope1_stationary_natural_gas");
});

test("filterErrorsForRow returns [] when nothing matches — caller then classifies by client rules", () => {
  const errors = [
    { ...SAMPLE_ERROR, facility_id: "F2", activity_type_id: "scope2_electricity" },
  ];
  const filtered = filterErrorsForRow(errors, "F1", "scope1_stationary_natural_gas");
  assert.deepEqual(filtered, []);
  // Confirm the row then classifies normally:
  const row = classifyRow(
    draftWith({ activity: { value: "1000", unit: "scf" } }),
    ACTIVITY_TYPE,
    filtered,
  );
  assert.equal(row.status, ROW_STATUS.COMPLETE);
});

test("filterErrorsForRow handles empty or missing inputs defensively", () => {
  assert.deepEqual(filterErrorsForRow(undefined, "F1", "A"), []);
  assert.deepEqual(filterErrorsForRow([], "F1", "A"), []);
  assert.deepEqual(filterErrorsForRow([SAMPLE_ERROR], "F1", undefined), []);
});
