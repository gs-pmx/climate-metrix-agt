import assert from "node:assert/strict";
import test from "node:test";

import {
  TOC_SCOPES,
  TOC_SUBCATEGORIES,
  categorizeForTOC,
  groupByTOC,
  sectionAnchorId,
} from "./categorizeForTOC.js";

// Representative fixtures taken from the Phase C4 catalog. Each record is
// the minimal set of fields `categorizeForTOC` consults — if we add a
// rule that looks at more fields, extend these inline rather than import
// the full catalog (we want the tests to keep running under node --test).
const FIXTURES = [
  {
    activity_type_id: "scope1_stationary_natural_gas",
    scope: "Scope 1",
    category: "Stationary Energy",
    metric_group: "fuel",
    metric_subgroup: "fossil_fuel",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope1_mobile_diesel",
    scope: "Scope 1",
    category: "Transportation",
    metric_group: "fuel",
    metric_subgroup: "fossil_fuel",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope1_fugitive_refrigerant_release",
    scope: "Scope 1",
    category: "Fugitive Emissions",
    metric_group: "other_ghg",
    metric_subgroup: null,
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope2_purchased_electricity_grid_mix",
    scope: "Scope 2",
    category: "Stationary Energy",
    metric_group: "grid_energy",
    metric_subgroup: "electricity_mix",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope2_purchased_electricity_renewable_purchase",
    scope: "Scope 2",
    category: "Stationary Energy",
    metric_group: "grid_energy",
    metric_subgroup: "electricity_renewable",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope2_mobile_electricity",
    scope: "Scope 2",
    category: "Transportation",
    metric_group: "grid_energy",
    metric_subgroup: "electricity_mix",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope2_purchased_district_steam",
    scope: "Scope 2",
    category: "Stationary Energy",
    metric_group: "grid_energy",
    metric_subgroup: "steam_mix",
    protocol_category_code: null,
  },
  {
    activity_type_id: "scope3_upstream_transport_truck_freight",
    scope: "Scope 3",
    category: "Transportation",
    metric_group: "upstream",
    metric_subgroup: "3.4_upstream_transportation",
    protocol_category_code: "4",
  },
  {
    activity_type_id: "scope3_business_travel_air",
    scope: "Scope 3",
    category: "Transportation",
    metric_group: "upstream",
    metric_subgroup: "3.6_business_travel",
    protocol_category_code: "6",
  },
  {
    activity_type_id: "scope3_employee_commuting_bus",
    scope: "Scope 3",
    category: "Transportation",
    metric_group: "upstream",
    metric_subgroup: "3.7_employee_commute",
    protocol_category_code: "7",
  },
  {
    activity_type_id: "scope3_waste_generated_in_operations",
    scope: "Scope 3",
    category: "Solid Waste",
    metric_group: "downstream",
    metric_subgroup: "3.5_waste_from_operations",
    protocol_category_code: "5",
  },
];

test("categorizeForTOC routes Scope 1 stationary combustion", () => {
  const result = categorizeForTOC(FIXTURES[0]);
  assert.equal(result.scope, "scope_1");
  assert.equal(result.subcategory, "stationary_combustion");
});

test("categorizeForTOC routes Scope 1 mobile combustion", () => {
  const result = categorizeForTOC(FIXTURES[1]);
  assert.equal(result.scope, "scope_1");
  assert.equal(result.subcategory, "mobile_combustion");
});

test("categorizeForTOC routes Scope 1 fugitive emissions", () => {
  const result = categorizeForTOC(FIXTURES[2]);
  assert.equal(result.scope, "scope_1");
  assert.equal(result.subcategory, "fugitive_emissions");
});

test("categorizeForTOC routes Scope 2 purchased electricity (grid mix)", () => {
  const result = categorizeForTOC(FIXTURES[3]);
  assert.equal(result.scope, "scope_2");
  assert.equal(result.subcategory, "purchased_electricity");
});

test("categorizeForTOC routes Scope 2 renewable electricity purchases", () => {
  const result = categorizeForTOC(FIXTURES[4]);
  assert.equal(result.scope, "scope_2");
  assert.equal(result.subcategory, "purchased_electricity");
});

test("categorizeForTOC routes Scope 2 mobile electricity to purchased electricity", () => {
  const result = categorizeForTOC(FIXTURES[5]);
  assert.equal(result.scope, "scope_2");
  assert.equal(result.subcategory, "purchased_electricity");
});

test("categorizeForTOC routes Scope 2 district steam", () => {
  const result = categorizeForTOC(FIXTURES[6]);
  assert.equal(result.scope, "scope_2");
  assert.equal(result.subcategory, "purchased_steam");
});

test("categorizeForTOC routes Scope 3 upstream transport by protocol code 4", () => {
  const result = categorizeForTOC(FIXTURES[7]);
  assert.equal(result.scope, "scope_3");
  assert.equal(result.subcategory, "upstream_distribution");
});

test("categorizeForTOC routes Scope 3 business travel by protocol code 6", () => {
  const result = categorizeForTOC(FIXTURES[8]);
  assert.equal(result.scope, "scope_3");
  assert.equal(result.subcategory, "business_travel");
});

test("categorizeForTOC routes Scope 3 employee commute by protocol code 7", () => {
  const result = categorizeForTOC(FIXTURES[9]);
  assert.equal(result.scope, "scope_3");
  assert.equal(result.subcategory, "employee_commute");
});

test("categorizeForTOC routes Scope 3 waste by protocol code 5", () => {
  const result = categorizeForTOC(FIXTURES[10]);
  assert.equal(result.scope, "scope_3");
  assert.equal(result.subcategory, "waste_generated_in_operations");
});

test("categorizeForTOC falls back to scope3_other when no rule matches", () => {
  const result = categorizeForTOC({
    activity_type_id: "scope3_some_future_category",
    scope: "Scope 3",
    category: "Something New",
  });
  assert.equal(result.scope, "scope_3");
  assert.equal(result.subcategory, "scope3_other");
});

test("categorizeForTOC falls back to other/other for null input", () => {
  const result = categorizeForTOC({});
  assert.equal(result.scope, "other");
  assert.equal(result.subcategory, "other");
});

test("categorizeForTOC uses protocol_category_code 1 and 2 for supply chain", () => {
  const resultCode1 = categorizeForTOC({
    activity_type_id: "scope3_purchased_goods",
    scope: "Scope 3",
    protocol_category_code: "1",
  });
  const resultCode2 = categorizeForTOC({
    activity_type_id: "scope3_capital_goods",
    scope: "Scope 3",
    protocol_category_code: "2",
  });
  assert.equal(resultCode1.subcategory, "supply_chain_capital_goods");
  assert.equal(resultCode2.subcategory, "supply_chain_capital_goods");
});

test("categorizeForTOC uses protocol_category_code 8 for upstream leased assets", () => {
  const result = categorizeForTOC({
    activity_type_id: "scope3_upstream_leased_assets_fuel",
    scope: "Scope 3",
    protocol_category_code: "8",
  });
  assert.equal(result.subcategory, "upstream_leased_assets");
});

// ---------------------------------------------------------------------------
// groupByTOC
// ---------------------------------------------------------------------------

test("groupByTOC builds a scope -> subcategory tree in sidebar order", () => {
  const tree = groupByTOC(FIXTURES);
  const scopeIds = tree.map((s) => s.id);
  assert.deepEqual(scopeIds, ["scope_1", "scope_2", "scope_3"]);
  // Scope 1 subcategories must appear in the sidebar order even when the
  // source list shuffles them.
  const scope1SubIds = tree[0].subcategories.map((s) => s.id);
  assert.deepEqual(scope1SubIds, [
    "stationary_combustion",
    "mobile_combustion",
    "fugitive_emissions",
  ]);
});

test("groupByTOC drops empty subcategories and empty scopes", () => {
  const tree = groupByTOC([FIXTURES[0]]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, "scope_1");
  assert.deepEqual(tree[0].subcategories.map((s) => s.id), ["stationary_combustion"]);
});

test("TOC_SUBCATEGORIES references only known scope ids", () => {
  const scopeIds = new Set(TOC_SCOPES.map((s) => s.id));
  for (const sub of TOC_SUBCATEGORIES) {
    assert.ok(scopeIds.has(sub.scope), `subcategory ${sub.id} references unknown scope ${sub.scope}`);
  }
});

test("sectionAnchorId produces a stable DOM id", () => {
  assert.equal(
    sectionAnchorId("scope_1", "stationary_combustion"),
    "ba-section-scope_1-stationary_combustion",
  );
});
