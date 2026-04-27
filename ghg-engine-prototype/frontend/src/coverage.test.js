import assert from "node:assert/strict";
import test from "node:test";

import {
  computeProjectCoverage,
  formatCoverageSummary,
} from "./coverage.js";

// ---------------------------------------------------------------------------
// Fixtures — small subset of the catalog. We only need activity_type_id
// since coverage classification doesn't probe input_schema.
// ---------------------------------------------------------------------------

const NG = "scope1_stationary_natural_gas";
const ELEC = "scope2_electricity";
const TRAVEL = "scope3_business_travel";

function makeRU(id, applicableList) {
  return {
    id,
    facility_name: `RU ${id}`,
    applicable_activity_types: applicableList,
  };
}

function makeDraft({ id, facilityId, activityTypeId, value = "", unit = "", params = {} }) {
  return {
    id,
    facility_id: facilityId,
    activity_type_id: activityTypeId,
    activity: { value, unit },
    params,
  };
}

function makeError({ facilityId, activityTypeId, message = "boom" }) {
  return {
    facility_id: facilityId,
    activity_type_id: activityTypeId,
    message,
  };
}

// ---------------------------------------------------------------------------
// computeProjectCoverage — empty / legacy / configured / orphaned scenarios.
// ---------------------------------------------------------------------------

test("computeProjectCoverage returns all zeros for an empty project", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [],
    activities: [],
    calcErrors: [],
  });
  assert.equal(cov.totalApplicable, 0);
  assert.equal(cov.withData, 0);
  assert.equal(cov.complete, 0);
  assert.equal(cov.missing, 0);
  assert.equal(cov.errored, 0);
  assert.equal(cov.orphaned, 0);
  assert.equal(cov.configuredUnits, 0);
  assert.equal(cov.byUnit.size, 0);
  assert.deepEqual(cov.missingPairs, []);
  assert.deepEqual(cov.erroredPairs, []);
  assert.deepEqual(cov.orphanedPairs, []);
});

test("legacy permissive units only contribute zero applicable pairs", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", []), makeRU("F2", [])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
    ],
    calcErrors: [],
  });
  // No expected set — legacy units produce no missing / orphaned pairs.
  assert.equal(cov.totalApplicable, 0);
  assert.equal(cov.missing, 0);
  assert.equal(cov.orphaned, 0);
  assert.equal(cov.configuredUnits, 0);
  assert.equal(cov.byUnit.size, 2);
  for (const [, unitCov] of cov.byUnit) {
    assert.equal(unitCov.legacyPermissive, true);
    assert.equal(unitCov.totalApplicable, 0);
  }
});

test("configured unit with data for every applicable activity is fully complete", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG, ELEC])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
      makeDraft({ id: "A2", facilityId: "F1", activityTypeId: ELEC, value: "100", unit: "kwh" }),
    ],
    calcErrors: [],
  });
  assert.equal(cov.totalApplicable, 2);
  assert.equal(cov.withData, 2);
  assert.equal(cov.complete, 2);
  assert.equal(cov.missing, 0);
  assert.equal(cov.errored, 0);
  assert.equal(cov.orphaned, 0);
  assert.equal(cov.configuredUnits, 1);
});

test("configured unit with partial data flags missing pairs", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG, ELEC, TRAVEL])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
    ],
    calcErrors: [],
  });
  assert.equal(cov.totalApplicable, 3);
  assert.equal(cov.withData, 1);
  assert.equal(cov.complete, 1);
  assert.equal(cov.missing, 2);
  // Missing pairs reference the original RU object (not just its id) so
  // banners / widgets can show the unit's display name without re-lookup.
  const missingActivityIds = cov.missingPairs.map((p) => p.activityTypeId).sort();
  assert.deepEqual(missingActivityIds, [ELEC, TRAVEL].sort());
  for (const p of cov.missingPairs) {
    assert.equal(p.unit.id, "F1");
  }
});

test("calc errors flip a populated pair from complete to errored", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG, ELEC])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
      makeDraft({ id: "A2", facilityId: "F1", activityTypeId: ELEC, value: "100", unit: "kwh" }),
    ],
    calcErrors: [makeError({ facilityId: "F1", activityTypeId: ELEC })],
  });
  assert.equal(cov.totalApplicable, 2);
  assert.equal(cov.complete, 1);
  assert.equal(cov.errored, 1);
  assert.equal(cov.missing, 0);
  // Errored pair is still "with data" — the user supplied a value, the
  // backend just couldn't compute it. The bar widget shows it in its
  // own band rather than collapsing it under "missing".
  assert.equal(cov.withData, 2);
  const erroredActivityIds = cov.erroredPairs.map((p) => p.activityTypeId);
  assert.deepEqual(erroredActivityIds, [ELEC]);
});

test("draft for activity not in applicable list is orphaned, not missing", () => {
  const cov = computeProjectCoverage({
    // F1 is configured for natural gas only.
    reportingUnits: [makeRU("F1", [NG])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
      // Travel data exists but the unit isn't tracking travel anymore —
      // the data is soft-hidden in the UI but lives in the snapshot.
      makeDraft({ id: "A2", facilityId: "F1", activityTypeId: TRAVEL, value: "200", unit: "miles" }),
    ],
    calcErrors: [],
  });
  assert.equal(cov.totalApplicable, 1);
  assert.equal(cov.complete, 1);
  assert.equal(cov.missing, 0);
  assert.equal(cov.orphaned, 1);
  const orphanedIds = cov.orphanedPairs.map((p) => p.activityTypeId);
  assert.deepEqual(orphanedIds, [TRAVEL]);
  assert.equal(cov.orphanedPairs[0].draftCount, 1);
});

test("legacy permissive unit cannot produce orphans even with extra drafts", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
      makeDraft({ id: "A2", facilityId: "F1", activityTypeId: TRAVEL, value: "200", unit: "miles" }),
    ],
    calcErrors: [],
  });
  // "Show all" units can't orphan anything — there's no exclusion.
  assert.equal(cov.orphaned, 0);
  assert.deepEqual(cov.orphanedPairs, []);
});

test("blank drafts don't count as data — still missing", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG }), // value=""
    ],
    calcErrors: [],
  });
  assert.equal(cov.withData, 0);
  assert.equal(cov.missing, 1);
});

test("mixed scenario: errors, missing, orphaned, and complete coexist", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [
      makeRU("F1", [NG, ELEC, TRAVEL]),
      makeRU("F2", [NG, ELEC]),
      makeRU("F3", []), // legacy permissive — should not contribute
    ],
    activities: [
      // F1: NG complete, ELEC errored, TRAVEL missing.
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
      makeDraft({ id: "A2", facilityId: "F1", activityTypeId: ELEC, value: "5", unit: "kwh" }),
      // F1: orphan — TRAVEL is in the applicable list, so this won't be
      // an orphan; instead let F2 carry an orphan via an extra activity.
      // F2: NG missing, ELEC complete, plus an orphan TRAVEL draft.
      makeDraft({ id: "A3", facilityId: "F2", activityTypeId: ELEC, value: "20", unit: "kwh" }),
      makeDraft({ id: "A4", facilityId: "F2", activityTypeId: TRAVEL, value: "100", unit: "miles" }),
      // F3 (legacy): random data — should not produce missing/orphaned.
      makeDraft({ id: "A5", facilityId: "F3", activityTypeId: NG, value: "1", unit: "scf" }),
    ],
    calcErrors: [makeError({ facilityId: "F1", activityTypeId: ELEC })],
  });

  // F1: 3 applicable, F2: 2 applicable, F3: 0 (legacy).
  assert.equal(cov.totalApplicable, 5);
  // F1 NG complete, F2 ELEC complete.
  assert.equal(cov.complete, 2);
  // F1 ELEC errored.
  assert.equal(cov.errored, 1);
  // F1 TRAVEL missing, F2 NG missing.
  assert.equal(cov.missing, 2);
  // F2 has TRAVEL data outside its applicable list -> orphan.
  assert.equal(cov.orphaned, 1);
  assert.equal(cov.configuredUnits, 2);

  const missingKeys = cov.missingPairs.map((p) => `${p.unit.id}::${p.activityTypeId}`).sort();
  assert.deepEqual(missingKeys, ["F1::scope3_business_travel", "F2::scope1_stationary_natural_gas"]);
  const erroredKeys = cov.erroredPairs.map((p) => `${p.unit.id}::${p.activityTypeId}`);
  assert.deepEqual(erroredKeys, ["F1::scope2_electricity"]);
  const orphanedKeys = cov.orphanedPairs.map((p) => `${p.unit.id}::${p.activityTypeId}`);
  assert.deepEqual(orphanedKeys, ["F2::scope3_business_travel"]);
});

test("errors with missing facility_id match by activity_type_id alone", () => {
  // Defensive shape: backend envelope can omit facility_id on a generic
  // calc failure. Coverage should still attribute the error.
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
    ],
    calcErrors: [{ activity_type_id: NG, message: "no factor" }],
  });
  assert.equal(cov.errored, 1);
  assert.equal(cov.complete, 0);
});

test("byUnit map exposes per-unit breakdown for chip rendering", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG, ELEC])],
    activities: [
      makeDraft({ id: "A1", facilityId: "F1", activityTypeId: NG, value: "10", unit: "scf" }),
    ],
    calcErrors: [],
  });
  const unit = cov.byUnit.get("F1");
  assert.ok(unit);
  assert.equal(unit.totalApplicable, 2);
  assert.equal(unit.missing, 1);
  assert.equal(unit.complete, 1);
  assert.equal(unit.legacyPermissive, false);
});

// ---------------------------------------------------------------------------
// formatCoverageSummary — banner / widget header text
// ---------------------------------------------------------------------------

test("formatCoverageSummary returns 'no sources' when nothing is configured", () => {
  assert.equal(
    formatCoverageSummary({ totalApplicable: 0, complete: 0, missing: 0, errored: 0, orphaned: 0 }),
    "No sources configured yet.",
  );
});

test("formatCoverageSummary calls out errors first when present", () => {
  assert.equal(
    formatCoverageSummary({ totalApplicable: 10, complete: 8, missing: 0, errored: 2, orphaned: 0 }),
    "8 of 10 complete, 2 with errors",
  );
});

test("formatCoverageSummary calls out missing when no errors", () => {
  assert.equal(
    formatCoverageSummary({ totalApplicable: 10, complete: 6, missing: 4, errored: 0, orphaned: 0 }),
    "4 of 10 sources missing data",
  );
});

test("formatCoverageSummary mentions orphaned data when otherwise complete", () => {
  assert.equal(
    formatCoverageSummary({ totalApplicable: 5, complete: 5, missing: 0, errored: 0, orphaned: 2 }),
    "All 5 sources complete, 2 orphaned",
  );
});

test("formatCoverageSummary celebrates a fully-complete project", () => {
  assert.equal(
    formatCoverageSummary({ totalApplicable: 10, complete: 10, missing: 0, errored: 0, orphaned: 0 }),
    "All sources complete (10/10)",
  );
});

// ---------------------------------------------------------------------------
// Defensive: malformed inputs.
// ---------------------------------------------------------------------------

test("computeProjectCoverage tolerates missing arrays in the input", () => {
  const cov = computeProjectCoverage({});
  assert.equal(cov.totalApplicable, 0);
  assert.equal(cov.byUnit.size, 0);
});

test("computeProjectCoverage skips drafts without facility_id or activity_type_id", () => {
  const cov = computeProjectCoverage({
    reportingUnits: [makeRU("F1", [NG])],
    activities: [
      { id: "A1", activity: { value: "10", unit: "scf" }, params: {} }, // no facility_id
      { id: "A2", facility_id: "F1", activity: { value: "1", unit: "scf" }, params: {} }, // no activity_type_id
    ],
    calcErrors: [],
  });
  assert.equal(cov.missing, 1);
  assert.equal(cov.complete, 0);
  assert.equal(cov.orphaned, 0);
});
