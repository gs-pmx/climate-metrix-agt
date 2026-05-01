// Phase D2 — planned-vs-actual completeness audit.
//
// The user's audit hazard: configure 10 sources for a Reporting Unit,
// enter data for 6, run a calc, see results — and have no surface that
// flags the 4 silently-absent sources. This module is the single source
// of truth for project-level coverage counts. All visible surfaces
// (Reporting Unit chips, Activity Inputs banner, Dashboard widget) read
// from `computeProjectCoverage` so the numbers always agree.
//
// For each (Reporting Unit, applicable_activity_type) pair we classify:
//   - missing  : RU lists the activity but no draft has meaningful data
//   - errored  : the latest /calculate run returned an error for the pair
//   - complete : data exists AND no error attaches to the pair
// And separately surface:
//   - orphaned : draft data exists for an activity that is NOT in the
//                RU's non-empty applicable list. Soft-hidden — the data
//                is preserved in the snapshot but excluded from inventory.
//                Legacy permissive units (empty applicable list) cannot
//                produce orphans because no activity is excluded.
//
// Pure functions, no React. Mirrors the unit-test pattern used by
// applicability.js / rowStatus.js / activityDrafts.js.

import { hasMeaningfulParamValue } from "./activityDrafts.js";

// Local mirror of `hasMeaningfulData` from gridEditingHelpers.jsx. Kept
// inline so this module imports cleanly under `node --test` without
// dragging JSX through the runner — same pattern as applicability.js.
function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => hasMeaningfulParamValue(value));
}

function getApplicableList(reportingUnit) {
  const list = reportingUnit?.applicable_activity_types;
  return Array.isArray(list) ? list : [];
}

// Did the latest calc envelope contain an error for this (unit, activity)
// pair? Errors can be missing facility_id (defensive shape), so match on
// activity_type_id alone in that case — same rule as filterErrorsForRow
// in rowStatus.js.
function hasErrorForPair(calcErrors, facilityId, activityTypeId) {
  if (!Array.isArray(calcErrors) || calcErrors.length === 0) return false;
  return calcErrors.some((err) => {
    if (!err) return false;
    if (err.activity_type_id !== activityTypeId) return false;
    if (err.facility_id != null && facilityId != null && err.facility_id !== facilityId) {
      return false;
    }
    return true;
  });
}

// Group draft activities by (facility_id, activity_type_id) so we can
// count meaningful drafts per pair without re-iterating the whole list
// for each pair. Returns Map<facility_id, Map<activity_type_id, draft[]>>.
function indexDraftsByPair(activities) {
  const out = new Map();
  for (const draft of activities || []) {
    const fid = draft?.facility_id;
    const aid = draft?.activity_type_id;
    if (!fid || !aid) continue;
    let perUnit = out.get(fid);
    if (!perUnit) {
      perUnit = new Map();
      out.set(fid, perUnit);
    }
    let drafts = perUnit.get(aid);
    if (!drafts) {
      drafts = [];
      perUnit.set(aid, drafts);
    }
    drafts.push(draft);
  }
  return out;
}

// Build coverage for a single Reporting Unit. Legacy permissive units
// (empty applicable list) contribute 0 to totalApplicable — there's no
// "expected set" to audit against. Their existing data is left visible
// in the entry surfaces; coverage simply has nothing to say about them.
function computeUnitCoverage(reportingUnit, draftsByActivity, calcErrors) {
  const applicable = getApplicableList(reportingUnit);
  const legacyPermissive = applicable.length === 0;

  const missingPairs = [];
  const erroredPairs = [];
  const orphanedPairs = [];
  const completePairs = [];
  const withDataPairs = [];

  if (!legacyPermissive) {
    for (const activityTypeId of applicable) {
      const drafts = draftsByActivity?.get(activityTypeId) || [];
      const meaningful = drafts.filter((d) => hasMeaningfulData(d));
      const errored = hasErrorForPair(calcErrors, reportingUnit.id, activityTypeId);
      const pair = { unit: reportingUnit, activityTypeId };
      if (errored) {
        erroredPairs.push(pair);
        // A pair that errored may still have data — count it as
        // "with data" so the bar widget can show it as non-missing
        // without double-counting it as "complete".
        if (meaningful.length > 0) withDataPairs.push(pair);
        continue;
      }
      if (meaningful.length === 0) {
        missingPairs.push(pair);
        continue;
      }
      withDataPairs.push(pair);
      completePairs.push(pair);
    }
  }

  // Orphans: drafts whose activity_type_id is NOT in the unit's
  // non-empty applicable list. Surfaced even on legacy permissive units?
  // No — legacy means "show all", so nothing can be orphaned. Spec is
  // explicit: orphans require an explicit applicable list.
  if (!legacyPermissive && draftsByActivity) {
    const applicableSet = new Set(applicable);
    for (const [activityTypeId, drafts] of draftsByActivity.entries()) {
      if (applicableSet.has(activityTypeId)) continue;
      const meaningful = drafts.filter((d) => hasMeaningfulData(d));
      if (meaningful.length === 0) continue;
      orphanedPairs.push({
        unit: reportingUnit,
        activityTypeId,
        draftCount: meaningful.length,
      });
    }
  }

  return {
    unit: reportingUnit,
    legacyPermissive,
    totalApplicable: legacyPermissive ? 0 : applicable.length,
    withData: withDataPairs.length,
    complete: completePairs.length,
    missing: missingPairs.length,
    errored: erroredPairs.length,
    orphaned: orphanedPairs.length,
    missingPairs,
    erroredPairs,
    orphanedPairs,
  };
}

// Project-level rollup. Inputs are exactly what `App.jsx` already holds:
// - `reportingUnits` (the full list, including ones with empty applicable
//   lists)
// - `activities`     (every draft, regardless of whether the pair is
//   currently applicable — orphan detection needs the lot)
// - `calcErrors`     (the latest /calculate envelope's errors[])
//
// Output is described in the function signature comment in
// phased-development-plan.md Phase D2.
export function computeProjectCoverage({
  reportingUnits = [],
  activities = [],
  calcErrors = [],
} = {}) {
  const draftsByPair = indexDraftsByPair(activities);
  const byUnit = new Map();
  let totalApplicable = 0;
  let withData = 0;
  let complete = 0;
  let missing = 0;
  let errored = 0;
  let orphaned = 0;
  const missingPairs = [];
  const erroredPairs = [];
  const orphanedPairs = [];
  let configuredUnits = 0;

  for (const ru of reportingUnits || []) {
    if (!ru?.id) continue;
    const draftsByActivity = draftsByPair.get(ru.id) || new Map();
    const unitCoverage = computeUnitCoverage(ru, draftsByActivity, calcErrors);
    byUnit.set(ru.id, unitCoverage);
    if (!unitCoverage.legacyPermissive) configuredUnits += 1;
    totalApplicable += unitCoverage.totalApplicable;
    withData += unitCoverage.withData;
    complete += unitCoverage.complete;
    missing += unitCoverage.missing;
    errored += unitCoverage.errored;
    orphaned += unitCoverage.orphaned;
    for (const p of unitCoverage.missingPairs) missingPairs.push(p);
    for (const p of unitCoverage.erroredPairs) erroredPairs.push(p);
    for (const p of unitCoverage.orphanedPairs) orphanedPairs.push(p);
  }

  return {
    totalApplicable,
    withData,
    complete,
    missing,
    errored,
    orphaned,
    configuredUnits,
    byUnit,
    missingPairs,
    erroredPairs,
    orphanedPairs,
  };
}

// Human-readable status string for banners / dashboard widget headers.
// Order of precedence reflects what a user most needs to act on:
//   errors > missing > orphaned > complete > nothing-configured.
export function formatCoverageSummary(coverage) {
  if (!coverage || coverage.totalApplicable === 0) {
    return "No sources configured yet.";
  }
  const total = coverage.totalApplicable;
  if (coverage.errored > 0) {
    return `${coverage.complete} of ${total} complete, ${coverage.errored} with errors`;
  }
  if (coverage.missing > 0) {
    return `${coverage.missing} of ${total} sources missing data`;
  }
  if (coverage.orphaned > 0) {
    return `All ${total} sources complete, ${coverage.orphaned} excluded`;
  }
  return `All sources complete (${coverage.complete}/${total})`;
}
