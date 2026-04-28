import { test } from "node:test";
import assert from "node:assert/strict";

import {
  filterRusWithSpendSelected,
  groupMappingsByRu,
} from "./spendMappings.js";

test("filterRusWithSpendSelected keeps RUs whose checklist includes scope3_spend_based", () => {
  const rus = [
    { id: "ru1", facility_name: "HQ", applicable_activity_types: ["scope3_spend_based"] },
    { id: "ru2", facility_name: "Plant", applicable_activity_types: ["scope1_natural_gas"] },
    {
      id: "ru3",
      facility_name: "Branch",
      applicable_activity_types: ["scope1_natural_gas", "scope3_spend_based"],
    },
    { id: "ru4", facility_name: "Empty", applicable_activity_types: [] },
  ];
  const filtered = filterRusWithSpendSelected(rus);
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["ru1", "ru3"],
  );
});

test("filterRusWithSpendSelected returns empty array for null/undefined inputs", () => {
  assert.deepEqual(filterRusWithSpendSelected(null), []);
  assert.deepEqual(filterRusWithSpendSelected(undefined), []);
  assert.deepEqual(filterRusWithSpendSelected([]), []);
});

test("filterRusWithSpendSelected tolerates RUs missing applicable_activity_types", () => {
  const rus = [
    { id: "ru1", facility_name: "Legacy" },
    { id: "ru2", facility_name: "Modern", applicable_activity_types: ["scope3_spend_based"] },
  ];
  assert.deepEqual(
    filterRusWithSpendSelected(rus).map((r) => r.id),
    ["ru2"],
  );
});

test("groupMappingsByRu buckets per RU and uses sentinel for project defaults", () => {
  const mappings = [
    { mapping_id: 1, reporting_unit_id: null, gl_code: "G1" },
    { mapping_id: 2, reporting_unit_id: "ru1", gl_code: "G2" },
    { mapping_id: 3, reporting_unit_id: "ru1", gl_code: "G3" },
    { mapping_id: 4, reporting_unit_id: "ru2", gl_code: "G4" },
  ];
  const grouped = groupMappingsByRu(mappings);
  assert.equal(grouped.__project_default__.length, 1);
  assert.equal(grouped.__project_default__[0].gl_code, "G1");
  assert.equal(grouped.ru1.length, 2);
  assert.deepEqual(
    grouped.ru1.map((m) => m.gl_code),
    ["G2", "G3"],
  );
  assert.equal(grouped.ru2.length, 1);
});

test("groupMappingsByRu returns empty object for nullish input", () => {
  assert.deepEqual(groupMappingsByRu(null), {});
  assert.deepEqual(groupMappingsByRu(undefined), {});
  assert.deepEqual(groupMappingsByRu([]), {});
});
