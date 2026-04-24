// Pure helpers for Phase C2 "applicable activity types" semantics.
//
// A Reporting Unit (RU) carries an optional `applicable_activity_types`
// list. The product rules:
//
//   - Empty list = legacy permissive: every catalog activity is shown
//     and treated as applicable. Snapshots saved before the feature
//     shipped look like this and must keep canonicalizing unchanged.
//
//   - Non-empty list = explicit checklist: only those activity_type_ids
//     are shown in the per-RU grid and counted in progress/completion.
//
// These helpers are intentionally free of React so they can be unit-
// tested in node's built-in test runner, matching the pattern already
// used by rowStatus.js / activityDrafts.js.

import { ROW_STATUS, classifyRepeatableRow, classifyRow } from "./rowStatus.js";
import { hasMeaningfulParamValue, isRepeatableActivity } from "./activityDrafts.js";

// Local mirror of the two pair helpers lifted from gridEditingHelpers.jsx.
// We inline them so this module can be imported from node --test without
// dragging JSX through the test runner.
function pairKey(facilityId, activityTypeId) {
  return `${facilityId}::${activityTypeId}`;
}

function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => hasMeaningfulParamValue(value));
}

function getApplicableList(reportingUnit) {
  const list = reportingUnit?.applicable_activity_types;
  return Array.isArray(list) ? list : [];
}

// True when the activity_type_id is applicable to the given RU.
// Empty applicable list == legacy "show all" -> always true.
export function isActivityApplicable(reportingUnit, activityTypeId) {
  const list = getApplicableList(reportingUnit);
  if (list.length === 0) return true;
  return list.includes(activityTypeId);
}

// Filter a catalog-like list of activity types down to those applicable
// to the given RU. Preserves input order.
export function filterApplicableActivities(reportingUnit, activityTypes) {
  if (!Array.isArray(activityTypes)) return [];
  const list = getApplicableList(reportingUnit);
  if (list.length === 0) return activityTypes;
  const set = new Set(list);
  return activityTypes.filter((at) => set.has(at?.activity_type_id));
}

// Filter a list of reporting units down to those to which the given
// activity_type_id applies. Used by the By Activity view to hide empty
// cells when an RU's explicit list excludes the current activity type.
export function filterApplicableReportingUnits(reportingUnits, activityTypeId) {
  if (!Array.isArray(reportingUnits)) return [];
  return reportingUnits.filter((ru) => isActivityApplicable(ru, activityTypeId));
}

// Filter a list of activity drafts down to those whose (facility_id,
// activity_type_id) pair is applicable to its owning Reporting Unit.
// Used at calculate time so deselected sources — which may still carry
// draft data via soft-hide — do not flow into the /calculate payload
// and blow up on missing params in the engine. Legacy permissive
// units (empty applicable list) let every row through.
export function filterRowsApplicable(rows, reportingUnits) {
  if (!Array.isArray(rows)) return [];
  const byId = new Map((reportingUnits || []).map((ru) => [ru?.id, ru]));
  return rows.filter((draft) =>
    isActivityApplicable(byId.get(draft?.facility_id), draft?.activity_type_id),
  );
}

// Set of composite pair keys (facility_id::activity_type_id) for which
// the project has at least one meaningful draft entry. Used by the
// configure-sources dialog to warn on uncheck.
export function buildExistingPairsSet(activities) {
  const set = new Set();
  for (const draft of activities || []) {
    if (!draft?.facility_id || !draft?.activity_type_id) continue;
    if (!hasMeaningfulData(draft)) continue;
    set.add(pairKey(draft.facility_id, draft.activity_type_id));
  }
  return set;
}

// Group activity-type list by Scope 1 / Scope 2 / Scope 3. Accepts any
// of the scope string variants the catalog uses ("scope_1", "Scope 1",
// "1", ...) and falls back to an "Other" bucket. Within each group
// activities are sorted by label for predictable dialog layout.
function scopeMatches(raw, digit) {
  const s = String(raw || "").toLowerCase();
  const pattern = new RegExp(`(?:^|\\b|scope)[\\s_]*${digit}(?:\\b|$)`);
  return pattern.test(s);
}

export function groupActivitiesByScope(activityTypes) {
  const buckets = [
    { key: "scope_1", label: "Scope 1 - Direct emissions", match: (s) => scopeMatches(s, 1), activities: [] },
    { key: "scope_2", label: "Scope 2 - Purchased energy", match: (s) => scopeMatches(s, 2), activities: [] },
    { key: "scope_3", label: "Scope 3 - Value chain", match: (s) => scopeMatches(s, 3), activities: [] },
    { key: "other", label: "Other", match: () => true, activities: [] },
  ];
  for (const at of activityTypes || []) {
    const bucket = buckets.find((b) => b.match(at?.scope));
    if (bucket) bucket.activities.push(at);
  }
  for (const bucket of buckets) {
    bucket.activities.sort((a, b) => String(a?.label || "").localeCompare(String(b?.label || "")));
  }
  return buckets.filter((b) => b.activities.length > 0);
}

// Progress numbers for a Reporting Unit card:
//   selected:  length of applicable_activity_types (0 when legacy permissive)
//   withData:  applicable activity-types that have at least one
//              meaningful draft entry for this RU
//   complete:  applicable activity-types whose row status is COMPLETE
//              for this RU
//   total:     number of applicable activity-types considered
//   legacyPermissive: true when we fell back to "all catalog activities"
//                     because the RU had an empty applicable list
//
// When `applicable_activity_types` is empty we fall back to counting
// across every activity present in the supplied catalog — legacy RUs
// still get informative numbers instead of "0 / 0 / 0".
// Ensure the given Reporting Unit has `activityTypeId` listed as applicable.
//
// Bug 1: when a user enters activity data through any entry mode for a
// (reporting_unit_id, activity_type_id) pair where the RU's applicable
// list is non-empty AND does not include that activity type, the
// backend canonicalization filter silently drops the data during save.
// To prevent that invisible drop this helper auto-appends the activity
// type to the RU's list and signals the caller that it did so, so the
// UI can surface a transient toast.
//
// Inputs are kept small so the helper can be unit tested without any
// React state glue:
//   - `reportingUnits`:    the current array of RUs in the session.
//   - `reportingUnitId`:   which RU to ensure.
//   - `activityTypeId`:    which activity type to ensure.
// Returns `{ reportingUnits, wasAdded }`. The returned array is
// reference-identical to the input when no change was made, so callers
// can cheaply skip a state update.
export function ensureActivityApplicable({
  reportingUnits,
  reportingUnitId,
  activityTypeId,
}) {
  if (!Array.isArray(reportingUnits) || !reportingUnitId || !activityTypeId) {
    return { reportingUnits, wasAdded: false };
  }
  const idx = reportingUnits.findIndex((ru) => ru?.id === reportingUnitId);
  if (idx < 0) {
    return { reportingUnits, wasAdded: false };
  }
  const ru = reportingUnits[idx];
  const list = getApplicableList(ru);
  // Legacy permissive: empty list means "show all" — filter does not
  // apply, so no mutation is required and no toast should fire.
  if (list.length === 0) {
    return { reportingUnits, wasAdded: false };
  }
  if (list.includes(activityTypeId)) {
    return { reportingUnits, wasAdded: false };
  }
  const nextUnit = {
    ...ru,
    applicable_activity_types: [...list, activityTypeId],
  };
  const next = reportingUnits.slice();
  next[idx] = nextUnit;
  return { reportingUnits: next, wasAdded: true };
}

export function computeReportingUnitProgress({
  reportingUnit,
  activityCatalog = [],
  activities = [],
  activityTypesById = null,
}) {
  const applicable = getApplicableList(reportingUnit);
  const useCatalogFallback = applicable.length === 0;
  const applicableIds = useCatalogFallback
    ? (activityCatalog || []).map((at) => at?.activity_type_id).filter(Boolean)
    : applicable;

  const byPair = new Map();
  for (const draft of activities || []) {
    if (!draft?.facility_id || !draft?.activity_type_id) continue;
    if (draft.facility_id !== reportingUnit?.id) continue;
    const key = draft.activity_type_id;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(draft);
  }

  let withData = 0;
  let complete = 0;
  const typesMap = activityTypesById
    || Object.fromEntries((activityCatalog || []).map((at) => [at?.activity_type_id, at]));

  for (const activityTypeId of applicableIds) {
    const drafts = byPair.get(activityTypeId) || [];
    const meaningful = drafts.filter((d) => hasMeaningfulData(d));
    if (meaningful.length > 0) withData += 1;

    const activityType = typesMap[activityTypeId];
    if (!activityType) continue;

    const isComplete = isRepeatableActivity(activityType)
      ? classifyRepeatableRow(drafts, activityType).status === ROW_STATUS.COMPLETE
      : (meaningful.length > 0
          && meaningful.every((d) => classifyRow(d, activityType).status === ROW_STATUS.COMPLETE));

    if (isComplete) complete += 1;
  }

  return {
    selected: applicable.length,
    withData,
    complete,
    total: applicableIds.length,
    legacyPermissive: useCatalogFallback,
  };
}
