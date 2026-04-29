import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCalculationPayload } from "./calculationPayload.js";

const NATURAL_GAS = {
  activity_type_id: "scope1_natural_gas",
  label: "Natural Gas",
  default_unit: "therm",
  allowed_units: ["therm", "kwh"],
  implementation_status: "implemented",
  input_schema: { fields: [] },
  ui_metadata: {},
};

const SPEND_BASED = {
  activity_type_id: "scope3_spend_based",
  label: "Spend-Based Emissions",
  default_unit: "USD",
  allowed_units: ["USD"],
  implementation_status: "implemented",
  input_schema: {
    fields: [
      { field_id: "spend", kind: "quantity", required: true, is_primary: true },
      { field_id: "gl_code", kind: "string", required: true, param_key: "gl_code" },
      {
        field_id: "gl_account_name",
        kind: "string",
        required: false,
        param_key: "gl_account_name",
      },
    ],
  },
  ui_metadata: { repeatable: true },
};

const CATALOG = {
  scope1_natural_gas: NATURAL_GAS,
  scope3_spend_based: SPEND_BASED,
};

const RU = {
  id: "ru1",
  facility_name: "Headquarters",
  region: "WEST",
  country: "US",
  state: "Washington",
  egrid_subregion: "NWPP",
};

const _draft = (over = {}) => ({
  id: "d1",
  facility_id: "ru1",
  activity_type_id: "scope1_natural_gas",
  activity: { value: 1000, unit: "therm" },
  params: {},
  ...over,
});

// ---------------------------------------------------------------------------
// project_id wiring (the regression bug this builder defends against)
// ---------------------------------------------------------------------------

test("payload includes project_id when an active project is set", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [_draft()],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.project_id, "prj_abc");
});

test("payload omits project_id when no project is active so JSON drops the key", () => {
  const payload = buildCalculationPayload({
    projectId: "",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [_draft()],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.project_id, undefined);
  assert.equal("project_id" in JSON.parse(JSON.stringify(payload)), false);
});

test("payload includes project_id even for non-spend calcs (forward compat)", () => {
  // A natural-gas-only calc doesn't strictly need project_id today,
  // but the builder still emits it so a spend row added later in the
  // same project doesn't silently fall back to ``validation_error``
  // because the frontend forgot to thread the field through.
  const payload = buildCalculationPayload({
    projectId: "prj_only_natural_gas",
    inventoryYear: 2024,
    gwpSet: "AR6",
    includeTrace: true,
    facility: RU,
    rows: [_draft({ activity_type_id: "scope1_natural_gas" })],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.project_id, "prj_only_natural_gas");
});

test("payload includes project_id when activities are spend rows", () => {
  const spendDraft = _draft({
    id: "d_spend",
    activity_type_id: "scope3_spend_based",
    activity: { value: 1000, unit: "USD" },
    params: { gl_code: "5100", gl_account_name: "Office Supplies" },
  });
  const payload = buildCalculationPayload({
    projectId: "prj_with_spend",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: true,
    facility: RU,
    rows: [spendDraft],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.project_id, "prj_with_spend");
  assert.equal(payload.activities.length, 1);
  assert.equal(payload.activities[0].activity_type_id, "scope3_spend_based");
});

// ---------------------------------------------------------------------------
// context shape
// ---------------------------------------------------------------------------

test("context.inventory_year coerces string years to number", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.context.inventory_year, 2024);
  assert.equal(typeof payload.context.inventory_year, "number");
});

test("context.inventory_year falls back to current year when input is non-numeric", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "not-a-year",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.context.inventory_year, new Date().getFullYear());
});

test("context.source_attributes maps facility geography fields with undefined fallbacks", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [],
    activityTypesById: CATALOG,
  });
  assert.deepEqual(payload.context.source_attributes, {
    region: "WEST",
    country: "US",
    state: "Washington",
    egrid_subregion: "NWPP",
  });
});

test("context.source_attributes uses undefined for missing facility fields", () => {
  const sparseRu = { id: "ru2" };
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: sparseRu,
    rows: [],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.context.source_attributes.region, undefined);
  assert.equal(payload.context.source_attributes.country, undefined);
});

test("context.source_attributes is well-formed when facility is null", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: null,
    rows: [],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.context.source_attributes.region, undefined);
});

// ---------------------------------------------------------------------------
// activities normalization
// ---------------------------------------------------------------------------

test("activities array normalizes each draft via normalizeActivityForSubmit", () => {
  const payload = buildCalculationPayload({
    projectId: "prj_abc",
    inventoryYear: "2024",
    gwpSet: "AR6",
    includeTrace: false,
    facility: RU,
    rows: [_draft()],
    activityTypesById: CATALOG,
  });
  assert.equal(payload.activities.length, 1);
  const activity = payload.activities[0];
  // normalizeActivityForSubmit always emits these keys.
  assert.equal(activity.facility_id, "ru1");
  assert.equal(activity.activity_type_id, "scope1_natural_gas");
});

test("activities array is empty when rows is null/empty", () => {
  for (const rows of [null, undefined, []]) {
    const payload = buildCalculationPayload({
      projectId: "prj_abc",
      inventoryYear: "2024",
      gwpSet: "AR6",
      includeTrace: false,
      facility: RU,
      rows,
      activityTypesById: CATALOG,
    });
    assert.deepEqual(payload.activities, []);
  }
});

