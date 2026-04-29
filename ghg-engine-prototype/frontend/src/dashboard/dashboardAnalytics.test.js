import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAnalyticsEnvelope,
  buildAnalyticsRowsFromResults,
} from "./dashboardAnalytics.js";

const CATALOG = {
  scope1_natural_gas: {
    activity_type_id: "scope1_natural_gas",
    label: "Natural Gas",
    category: "Stationary Combustion",
    metric_subgroup: "1.1_stationary",
  },
  scope2_purchased_electricity_grid_mix: {
    activity_type_id: "scope2_purchased_electricity_grid_mix",
    label: "Purchased Electricity",
    category: "Purchased Energy",
    metric_subgroup: "2.1_electricity",
  },
  scope3_spend_based: {
    activity_type_id: "scope3_spend_based",
    label: "Spend-Based Emissions",
    category: "Purchased Goods & Services",
    metric_subgroup: "3.1_purchased_goods_and_services",
  },
};

function _row(overrides) {
  return {
    facility_id: "ru1",
    facility_name: "HQ",
    activity_type_id: "scope1_natural_gas",
    activity_label: "Natural Gas",
    scope: "Scope 1",
    accounting_method: "none",
    gas: "co2e",
    value: 1, // metric tons
    unit: "metric ton",
    is_biogenic: false,
    ...overrides,
  };
}

test("buildAnalyticsRowsFromResults converts metric tons to kg", () => {
  const rows = buildAnalyticsRowsFromResults([_row({ value: 10 })], CATALOG);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].co2e_kg, 10_000);
});

test("buildAnalyticsRowsFromResults filters out non-co2e gas rows", () => {
  const input = [
    _row({ gas: "co2", value: 5 }),
    _row({ gas: "ch4", value: 3 }),
    _row({ gas: "co2e", value: 10 }),
  ];
  const rows = buildAnalyticsRowsFromResults(input, CATALOG);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].co2e_kg, 10_000);
});

test("buildAnalyticsRowsFromResults excludes biogenic rows so totals match server SQL", () => {
  const input = [
    _row({ value: 10, is_biogenic: false }),
    _row({ value: 5, is_biogenic: true }),
  ];
  const rows = buildAnalyticsRowsFromResults(input, CATALOG);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].co2e_kg, 10_000);
});

test("buildAnalyticsRowsFromResults aggregates by (facility_id, activity_type_id, scope)", () => {
  // Two rows for the same RU + activity + scope (e.g. different
  // accounting methods on a Scope 2 grid-mix EQM) should sum together.
  const input = [
    _row({ value: 4, accounting_method: "location_based" }),
    _row({ value: 6, accounting_method: "market_based" }),
  ];
  const rows = buildAnalyticsRowsFromResults(input, CATALOG);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].co2e_kg, 10_000);
});

test("buildAnalyticsRowsFromResults preserves facility_name and activity_label from the row", () => {
  const rows = buildAnalyticsRowsFromResults(
    [_row({ facility_id: "ru1", facility_name: "Headquarters", activity_label: "Boiler #1" })],
    CATALOG,
  );
  assert.equal(rows[0].facility_name, "Headquarters");
  assert.equal(rows[0].activity_label, "Boiler #1");
});

test("buildAnalyticsRowsFromResults pulls category + subcategory from the catalog", () => {
  const rows = buildAnalyticsRowsFromResults([_row()], CATALOG);
  assert.equal(rows[0].category, "Stationary Combustion");
  assert.equal(rows[0].subcategory, "1.1_stationary");
});

test("buildAnalyticsRowsFromResults falls back to 'Other' when activity is missing from catalog", () => {
  const rows = buildAnalyticsRowsFromResults(
    [_row({ activity_type_id: "unknown_activity" })],
    CATALOG,
  );
  assert.equal(rows[0].category, "Other");
  assert.equal(rows[0].subcategory, null);
});

test("buildAnalyticsRowsFromResults returns rows sorted by co2e_kg DESC", () => {
  const input = [
    _row({ facility_id: "ru1", value: 1 }),
    _row({ facility_id: "ru2", value: 5 }),
    _row({ facility_id: "ru3", value: 3 }),
  ];
  const rows = buildAnalyticsRowsFromResults(input, CATALOG);
  assert.deepEqual(
    rows.map((r) => r.facility_id),
    ["ru2", "ru3", "ru1"],
  );
});

test("buildAnalyticsRowsFromResults returns [] for null / empty input", () => {
  assert.deepEqual(buildAnalyticsRowsFromResults(null, CATALOG), []);
  assert.deepEqual(buildAnalyticsRowsFromResults([], CATALOG), []);
  assert.deepEqual(buildAnalyticsRowsFromResults(undefined, CATALOG), []);
});

test("buildAnalyticsRowsFromResults is defensive against a missing catalog", () => {
  const rows = buildAnalyticsRowsFromResults([_row()], null);
  assert.equal(rows[0].category, "Other");
});

test("buildAnalyticsEnvelope wraps rows + computes total + facility count", () => {
  const env = buildAnalyticsEnvelope(
    [
      _row({ facility_id: "ru1", value: 10 }),
      _row({ facility_id: "ru2", value: 4 }),
    ],
    CATALOG,
  );
  assert.equal(env.rows.length, 2);
  assert.equal(env.total_co2e_kg, 14_000);
  assert.equal(env.facility_count, 2);
  assert.equal(env.version_id, null);
  assert.equal(env.inventory_year, null);
});

test("buildAnalyticsEnvelope returns zero totals for an empty result set", () => {
  const env = buildAnalyticsEnvelope([], CATALOG);
  assert.deepEqual(env.rows, []);
  assert.equal(env.total_co2e_kg, 0);
  assert.equal(env.facility_count, 0);
});

test("spend-based rows flow through with category from the catalog", () => {
  const env = buildAnalyticsEnvelope(
    [
      _row({
        activity_type_id: "scope3_spend_based",
        scope: "Scope 3",
        value: 7,
        activity_label: "Spend-Based Emissions",
      }),
    ],
    CATALOG,
  );
  assert.equal(env.rows.length, 1);
  assert.equal(env.rows[0].category, "Purchased Goods & Services");
  assert.equal(env.rows[0].co2e_kg, 7_000);
});
