import { test } from "node:test";
import assert from "node:assert/strict";

import {
  autofillSpendRow,
  filterRusWithSpendSelected,
  findFactorByIdentifier,
  findMappingByCode,
  findMappingByName,
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

const SAMPLE_MAPPINGS = [
  { gl_code: "10101", gl_account_name: "Office Supplies", factor_id: "useeio:111" },
  { gl_code: "10102", gl_account_name: "Travel Expenses", factor_id: "useeio:481" },
  { gl_code: "10103", gl_account_name: "Utilities", factor_id: "useeio:221" },
];

test("findMappingByCode is case-insensitive and trim-tolerant", () => {
  assert.equal(findMappingByCode(SAMPLE_MAPPINGS, "10101")?.gl_account_name, "Office Supplies");
  assert.equal(findMappingByCode(SAMPLE_MAPPINGS, " 10102 ")?.gl_account_name, "Travel Expenses");
});

test("findMappingByCode returns null when no match or input is blank", () => {
  assert.equal(findMappingByCode(SAMPLE_MAPPINGS, "99999"), null);
  assert.equal(findMappingByCode(SAMPLE_MAPPINGS, ""), null);
  assert.equal(findMappingByCode(SAMPLE_MAPPINGS, null), null);
});

test("findMappingByName matches case-insensitively", () => {
  assert.equal(findMappingByName(SAMPLE_MAPPINGS, "office supplies")?.gl_code, "10101");
  assert.equal(findMappingByName(SAMPLE_MAPPINGS, "  Travel Expenses  ")?.gl_code, "10102");
});

test("findMappingByName returns null when no match", () => {
  assert.equal(findMappingByName(SAMPLE_MAPPINGS, "Unknown account"), null);
  assert.equal(findMappingByName(SAMPLE_MAPPINGS, ""), null);
});

test("autofillSpendRow fills the name when code is supplied alone", () => {
  const out = autofillSpendRow({ gl_code: "10101", gl_account_name: "" }, SAMPLE_MAPPINGS);
  assert.equal(out.gl_account_name, "Office Supplies");
  assert.equal(out.gl_code, "10101");
});

test("autofillSpendRow fills the code when name is supplied alone", () => {
  const out = autofillSpendRow(
    { gl_code: "", gl_account_name: "Utilities" },
    SAMPLE_MAPPINGS,
  );
  assert.equal(out.gl_code, "10103");
  assert.equal(out.gl_account_name, "Utilities");
});

test("autofillSpendRow does not overwrite a non-blank field even if mapping disagrees", () => {
  // User typed a custom name for code 10101 — keep their input.
  const params = { gl_code: "10101", gl_account_name: "Stationery (custom)" };
  const out = autofillSpendRow(params, SAMPLE_MAPPINGS);
  assert.equal(out, params);
});

test("autofillSpendRow returns the input reference when no fill applies", () => {
  const params = { gl_code: "", gl_account_name: "" };
  assert.equal(autofillSpendRow(params, SAMPLE_MAPPINGS), params);

  const noMatch = { gl_code: "99999", gl_account_name: "" };
  assert.equal(autofillSpendRow(noMatch, SAMPLE_MAPPINGS), noMatch);
});

test("autofillSpendRow preserves other params keys (supplier, country, etc.)", () => {
  const params = {
    gl_code: "10101",
    gl_account_name: "",
    supplier: "Acme",
    supplier_country: "US",
  };
  const out = autofillSpendRow(params, SAMPLE_MAPPINGS);
  assert.equal(out.supplier, "Acme");
  assert.equal(out.supplier_country, "US");
});

const SAMPLE_FACTORS = [
  { source_record_key: "useeio:541110", description: "Legal Services", source_id: "useeio_v2", factor_type: "spend" },
  { source_record_key: "useeio:481000", description: "Air Transportation", source_id: "useeio_v2", factor_type: "spend" },
  { source_record_key: "useeio:221100", description: "Electric Power", source_id: "useeio_v2", factor_type: "spend" },
];

test("findFactorByIdentifier matches by source_record_key", () => {
  const hit = findFactorByIdentifier(SAMPLE_FACTORS, "useeio:481000");
  assert.equal(hit?.description, "Air Transportation");
});

test("findFactorByIdentifier falls back to case-insensitive description match", () => {
  const hit = findFactorByIdentifier(SAMPLE_FACTORS, "legal services");
  assert.equal(hit?.source_record_key, "useeio:541110");
});

test("findFactorByIdentifier prefers source_record_key over description on a tie", () => {
  const factors = [
    { source_record_key: "useeio:A", description: "Match Me" },
    { source_record_key: "Match Me", description: "useeio:A" },
  ];
  const hit = findFactorByIdentifier(factors, "Match Me");
  assert.equal(hit?.source_record_key, "Match Me");
});

test("findFactorByIdentifier returns null on no match or blank input", () => {
  assert.equal(findFactorByIdentifier(SAMPLE_FACTORS, "nothing"), null);
  assert.equal(findFactorByIdentifier(SAMPLE_FACTORS, ""), null);
  assert.equal(findFactorByIdentifier(SAMPLE_FACTORS, null), null);
  assert.equal(findFactorByIdentifier([], "useeio:541110"), null);
});
