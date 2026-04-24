import assert from "node:assert/strict";
import test from "node:test";

import {
  coerceNumericParamsForSubmit,
  getActivitySupportNotice,
  getCompletionState,
  normalizeActivityForSubmit,
  sanitizeParams,
  withActivityTypeDefaults,
} from "./activityDrafts.js";

const DIRECT_OVERRIDE_ACTIVITY = {
  activity_type_id: "scope1_stationary_natural_gas",
  label: "Stationary Natural Gas",
  implementation_status: "implemented",
  default_unit: "scf",
  allowed_units: ["scf", "therm", "mmbtu"],
  accounting_metadata: {},
  ui_metadata: {},
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
        field_id: "emission_factor_override",
        label: "Emission Factor Override",
        kind: "quantity",
        required: false,
        is_primary: false,
        default_unit: "kg/mmbtu",
        allowed_units: ["kg/scf", "kg/mmbtu"],
        options: [],
        param_key: "emission_factor_override",
      },
      {
        field_id: "emission_factor_override_source",
        label: "Override Factor Source",
        kind: "string",
        required: false,
        is_primary: false,
        default_unit: null,
        allowed_units: [],
        options: [],
        param_key: "emission_factor_override_source",
      },
    ],
    notes: [],
  },
};

const PLANNED_ACTIVITY = {
  ...DIRECT_OVERRIDE_ACTIVITY,
  activity_type_id: "scope1_onsite_generation_electricity",
  label: "Onsite Electricity Generation",
  implementation_status: "planned",
};

test("sanitizeParams drops blank quantity params but keeps zero-value overrides", () => {
  assert.deepEqual(
    sanitizeParams({
      empty_quantity: { value: "", unit: "kg/kwh" },
      zero_override: { value: 0, unit: "kg/mmbtu" },
      source: "",
      include_false: false,
    }),
    {
      zero_override: { value: 0, unit: "kg/mmbtu" },
      include_false: false,
    },
  );
});

test("getCompletionState validates quantity detail fields", () => {
  const draft = withActivityTypeDefaults(
    {
      id: "A1",
      facility_id: "F1",
      activity_type_id: DIRECT_OVERRIDE_ACTIVITY.activity_type_id,
      activity: { value: "1000", unit: "scf" },
      params: {
        emission_factor_override: { value: "1.5", unit: "kg/short-ton" },
      },
    },
    DIRECT_OVERRIDE_ACTIVITY,
  );

  const invalidCompletion = getCompletionState(draft, DIRECT_OVERRIDE_ACTIVITY);
  assert.equal(invalidCompletion.state, "incomplete");
  assert.match(invalidCompletion.errors.join(", "), /Emission Factor Override unit/);

  const validCompletion = getCompletionState(
    {
      ...draft,
      params: {
        emission_factor_override: { value: "1.5", unit: "kg/mmbtu" },
      },
    },
    DIRECT_OVERRIDE_ACTIVITY,
  );
  assert.equal(validCompletion.state, "complete");
});

test("normalizeActivityForSubmit preserves quantity override params for calculable rows", () => {
  const draft = withActivityTypeDefaults(
    {
      id: "A1",
      facility_id: "F1",
      activity_type_id: DIRECT_OVERRIDE_ACTIVITY.activity_type_id,
      activity: { value: "1000", unit: "scf" },
      params: {
        emission_factor_override: { value: "5", unit: "kg/mmbtu" },
        emission_factor_override_source: "Utility disclosure",
      },
    },
    DIRECT_OVERRIDE_ACTIVITY,
  );

  assert.deepEqual(normalizeActivityForSubmit(draft, DIRECT_OVERRIDE_ACTIVITY), {
    facility_id: "F1",
    activity_type_id: DIRECT_OVERRIDE_ACTIVITY.activity_type_id,
    activity: { value: 1000, unit: "scf" },
    params: {
      emission_factor_override: { value: "5", unit: "kg/mmbtu" },
      emission_factor_override_source: "Utility disclosure",
    },
  });
});

// Mobile-combustion-style fixture with both a primary quantity and a
// secondary `kind: "number"` (fuel efficiency / MPG). Used to exercise
// the comma-stripping path that surfaces when users type "1,234"-style
// values into the Activity Detail dialog and the value flows back
// through normalizeActivityForSubmit.
const MOBILE_COMBUSTION_ACTIVITY = {
  activity_type_id: "scope1_mobile_diesel",
  label: "Mobile Combustion - Diesel",
  implementation_status: "implemented",
  default_unit: "miles",
  allowed_units: ["miles", "km"],
  accounting_metadata: {},
  ui_metadata: {},
  input_schema: {
    fields: [
      {
        field_id: "distance",
        label: "Distance",
        kind: "quantity",
        required: true,
        is_primary: true,
        default_unit: "miles",
        allowed_units: ["miles", "km"],
        options: [],
        param_key: null,
      },
      {
        field_id: "fuel_efficiency",
        label: "Fuel Efficiency",
        kind: "number",
        required: false,
        is_primary: false,
        default_unit: null,
        allowed_units: [],
        options: [],
        param_key: "fuel_efficiency",
      },
      {
        field_id: "alt_quantity_param",
        label: "Alt Quantity Param",
        kind: "quantity",
        required: false,
        is_primary: false,
        default_unit: "gallon",
        allowed_units: ["gallon"],
        options: [],
        param_key: "alt_quantity_param",
      },
    ],
    notes: [],
  },
};

test("coerceNumericParamsForSubmit strips commas from kind:number values", () => {
  const out = coerceNumericParamsForSubmit(
    { fuel_efficiency: "1,234" },
    MOBILE_COMBUSTION_ACTIVITY,
  );
  assert.deepEqual(out, { fuel_efficiency: "1234" });
});

test("coerceNumericParamsForSubmit strips commas inside kind:quantity values", () => {
  const out = coerceNumericParamsForSubmit(
    { alt_quantity_param: { value: "12,345.67", unit: "gallon" } },
    MOBILE_COMBUSTION_ACTIVITY,
  );
  assert.deepEqual(out, { alt_quantity_param: { value: "12345.67", unit: "gallon" } });
});

test("coerceNumericParamsForSubmit leaves comma-free numeric strings unchanged", () => {
  const out = coerceNumericParamsForSubmit(
    {
      fuel_efficiency: "30",
      alt_quantity_param: { value: "5", unit: "gallon" },
    },
    MOBILE_COMBUSTION_ACTIVITY,
  );
  assert.deepEqual(out, {
    fuel_efficiency: "30",
    alt_quantity_param: { value: "5", unit: "gallon" },
  });
});

test("coerceNumericParamsForSubmit leaves non-numeric kinds untouched", () => {
  const out = coerceNumericParamsForSubmit(
    {
      // fuel_efficiency lives in the catalog; bogus comma-string here
      // would normally be cleaned, but only because we know its kind.
      fuel_efficiency: "1,234",
      // unknown_param has no catalog kind — pass through.
      unknown_param: "hello, world",
    },
    MOBILE_COMBUSTION_ACTIVITY,
  );
  assert.equal(out.fuel_efficiency, "1234");
  assert.equal(out.unknown_param, "hello, world");
});

test("coerceNumericParamsForSubmit leaves un-parseable numeric strings as-is", () => {
  const out = coerceNumericParamsForSubmit(
    { fuel_efficiency: "abc,def" },
    MOBILE_COMBUSTION_ACTIVITY,
  );
  // Value has a comma but doesn't parse to a number — preserved so the
  // user sees their input back in any error surface.
  assert.equal(out.fuel_efficiency, "abc,def");
});

test("normalizeActivityForSubmit cleans comma-formatted MPG and primary values end-to-end", () => {
  const draft = withActivityTypeDefaults(
    {
      id: "A1",
      facility_id: "F1",
      activity_type_id: MOBILE_COMBUSTION_ACTIVITY.activity_type_id,
      activity: { value: "1,234", unit: "miles" },
      params: {
        fuel_efficiency: "1,234",
      },
    },
    MOBILE_COMBUSTION_ACTIVITY,
  );

  assert.deepEqual(normalizeActivityForSubmit(draft, MOBILE_COMBUSTION_ACTIVITY), {
    facility_id: "F1",
    activity_type_id: MOBILE_COMBUSTION_ACTIVITY.activity_type_id,
    // Primary value is converted to a JS number (existing contract).
    activity: { value: 1234, unit: "miles" },
    // Numeric param values keep their string shape but lose commas.
    params: { fuel_efficiency: "1234" },
  });
});

test("planned activities stay unsupported and expose the planned support notice", () => {
  const draft = withActivityTypeDefaults(
    {
      id: "A2",
      facility_id: "F1",
      activity_type_id: PLANNED_ACTIVITY.activity_type_id,
      activity: { value: "25", unit: "scf" },
      params: {},
    },
    PLANNED_ACTIVITY,
  );

  const completion = getCompletionState(draft, PLANNED_ACTIVITY);
  const supportNotice = getActivitySupportNotice(PLANNED_ACTIVITY);

  assert.equal(completion.state, "unsupported");
  assert.equal(supportNotice?.severity, "info");
  assert.match(
    supportNotice?.message || "",
    /visible for draft entry and snapshotting, but calculation is not supported yet/i,
  );
  assert.throws(
    () => normalizeActivityForSubmit(draft, PLANNED_ACTIVITY),
    /not available for calculation yet/i,
  );
});
