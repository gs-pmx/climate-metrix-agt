import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCatalogAdvisories,
  buildCoverageNotice,
  buildNotifications,
  maxSeverity,
} from "./notices.js";

const NATURAL_GAS = {
  activity_type_id: "scope1_natural_gas",
  label: "Natural Gas",
  implementation_status: "implemented",
};

const PARTIAL_FUGITIVE = {
  activity_type_id: "scope1_fugitive_partial",
  label: "Fugitive (partial)",
  implementation_status: "partial",
  accounting_metadata: {
    partial_reason: "Only direct vents are supported; leak rates not yet modeled.",
  },
};

const PLANNED_FOREST = {
  activity_type_id: "scope1_forest_carbon",
  label: "Forest Carbon",
  implementation_status: "planned",
};

const CATALOG = {
  scope1_natural_gas: NATURAL_GAS,
  scope1_fugitive_partial: PARTIAL_FUGITIVE,
  scope1_forest_carbon: PLANNED_FOREST,
};

function _draft({ activity_type_id, value = "", params = {} }) {
  return {
    activity_type_id,
    activity: { value, unit: "" },
    params,
  };
}

// ---------------------------------------------------------------------------
// maxSeverity
// ---------------------------------------------------------------------------

test("maxSeverity picks the highest-rank severity from a list", () => {
  assert.equal(maxSeverity(["info", "warning", "success"]), "warning");
  assert.equal(maxSeverity(["error", "warning"]), "error");
  assert.equal(maxSeverity(["success"]), "success");
  assert.equal(maxSeverity([]), null);
  assert.equal(maxSeverity(null), null);
});

// ---------------------------------------------------------------------------
// buildCoverageNotice
// ---------------------------------------------------------------------------

test("buildCoverageNotice returns null when nothing is applicable yet", () => {
  assert.equal(buildCoverageNotice(null), null);
  assert.equal(buildCoverageNotice({ totalApplicable: 0 }), null);
});

test("buildCoverageNotice prioritises errored > missing > orphaned > complete", () => {
  const errored = buildCoverageNotice({
    totalApplicable: 5,
    errored: 1,
    missing: 1,
    orphaned: 1,
    complete: 2,
  });
  assert.equal(errored.severity, "error");
  assert.equal(errored.detailKind, "errored");

  const missing = buildCoverageNotice({
    totalApplicable: 5,
    errored: 0,
    missing: 2,
    orphaned: 1,
    complete: 2,
  });
  assert.equal(missing.severity, "warning");
  assert.equal(missing.detailKind, "missing");

  const orphaned = buildCoverageNotice({
    totalApplicable: 5,
    errored: 0,
    missing: 0,
    orphaned: 1,
    complete: 5,
  });
  assert.equal(orphaned.severity, "info");
  assert.equal(orphaned.detailKind, "orphaned");

  const allComplete = buildCoverageNotice({
    totalApplicable: 5,
    errored: 0,
    missing: 0,
    orphaned: 0,
    complete: 5,
  });
  assert.equal(allComplete.severity, "success");
  assert.equal(allComplete.detailKind, null);
});

// ---------------------------------------------------------------------------
// buildCatalogAdvisories
// ---------------------------------------------------------------------------

test("buildCatalogAdvisories is empty when no draft has meaningful data", () => {
  const drafts = [_draft({ activity_type_id: "scope1_fugitive_partial", value: "" })];
  assert.deepEqual(buildCatalogAdvisories(drafts, CATALOG), []);
});

test("buildCatalogAdvisories surfaces partial activities once each", () => {
  const drafts = [
    _draft({ activity_type_id: "scope1_fugitive_partial", value: 10 }),
    _draft({ activity_type_id: "scope1_fugitive_partial", value: 20 }),
    _draft({ activity_type_id: "scope1_natural_gas", value: 100 }),
  ];
  const items = buildCatalogAdvisories(drafts, CATALOG);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "partial::scope1_fugitive_partial");
  assert.equal(items[0].severity, "warning");
});

test("buildCatalogAdvisories surfaces planned activities as info-level", () => {
  const drafts = [_draft({ activity_type_id: "scope1_forest_carbon", value: 5 })];
  const items = buildCatalogAdvisories(drafts, CATALOG);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "unsupported::scope1_forest_carbon");
});

test("buildCatalogAdvisories considers params-only data as meaningful", () => {
  const drafts = [
    _draft({
      activity_type_id: "scope1_fugitive_partial",
      value: "",
      params: { refrigerant_type: "HFC-134a" },
    }),
  ];
  const items = buildCatalogAdvisories(drafts, CATALOG);
  assert.equal(items.length, 1);
});

test("buildCatalogAdvisories tolerates missing activityTypesById entries", () => {
  const drafts = [_draft({ activity_type_id: "unknown_id", value: 10 })];
  assert.deepEqual(buildCatalogAdvisories(drafts, CATALOG), []);
  assert.deepEqual(buildCatalogAdvisories(drafts, {}), []);
});

// ---------------------------------------------------------------------------
// buildNotifications composer
// ---------------------------------------------------------------------------

test("buildNotifications merges coverage + advisories and counts the badge", () => {
  const result = buildNotifications({
    coverage: {
      totalApplicable: 3,
      missing: 1,
      errored: 0,
      orphaned: 0,
      complete: 2,
    },
    activities: [
      _draft({ activity_type_id: "scope1_fugitive_partial", value: 10 }),
      _draft({ activity_type_id: "scope1_forest_carbon", value: 5 }),
    ],
    activityTypesById: CATALOG,
  });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].id, "coverage::missing");
  assert.equal(result.badge, 3);
  assert.equal(result.severity, "warning");
});

test("buildNotifications drops a success coverage from the badge count", () => {
  const result = buildNotifications({
    coverage: {
      totalApplicable: 3,
      missing: 0,
      errored: 0,
      orphaned: 0,
      complete: 3,
    },
    activities: [],
    activityTypesById: CATALOG,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].severity, "success");
  assert.equal(result.badge, 0);
});

test("buildNotifications returns an empty result when nothing applies", () => {
  const result = buildNotifications({
    coverage: { totalApplicable: 0 },
    activities: [],
    activityTypesById: CATALOG,
  });
  assert.deepEqual(result.items, []);
  assert.equal(result.badge, 0);
  assert.equal(result.severity, null);
});
