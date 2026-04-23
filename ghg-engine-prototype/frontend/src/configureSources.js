// Pure helpers for the ConfigureSourcesDialog.
//
// Extracting the checkbox-set reducer + warning logic into a plain module
// lets us unit-test the behavior in node's built-in test runner (no JSDOM).
// The React component in ConfigureSourcesDialog.jsx is a thin view over
// these functions — it holds an initial set built from
// `initialSetFromReportingUnit`, toggles entries with `toggleActivity`,
// queries `shouldWarnOnUncheck` inline to render the inline warn copy,
// and on Save calls `collectChecked` to produce the `applicable_activity_types`
// list we hand to the parent.

// Inlined from gridEditingHelpers.jsx so this module is importable from
// node --test without dragging JSX through the test runner.
function pairKey(facilityId, activityTypeId) {
  return `${facilityId}::${activityTypeId}`;
}

// Turn a ReportingUnit's applicable_activity_types into a Set<string>.
// Used as the dialog's initial checked-state.
export function initialSetFromReportingUnit(reportingUnit) {
  const list = reportingUnit?.applicable_activity_types;
  return new Set(Array.isArray(list) ? list : []);
}

// Immutably add / remove an activity_type_id from the checked-set.
// Returns a new Set so React equality checks flag a change.
export function toggleActivity(set, activityTypeId) {
  const next = new Set(set);
  if (next.has(activityTypeId)) {
    next.delete(activityTypeId);
  } else {
    next.add(activityTypeId);
  }
  return next;
}

// True when (1) this activity_type_id is currently CHECKED in the
// initial reporting unit's list, (2) the user has just UNCHECKED it,
// and (3) there is existing draft data for this (RU, activity) pair.
// When true the dialog renders the inline warn copy.
export function shouldWarnOnUncheck({
  reportingUnit,
  activityTypeId,
  currentChecked,
  existingPairsSet,
}) {
  const initiallyChecked = (reportingUnit?.applicable_activity_types || []).includes(activityTypeId);
  if (!initiallyChecked) return false;
  if (currentChecked) return false;
  if (!existingPairsSet) return false;
  const key = pairKey(reportingUnit?.id, activityTypeId);
  return existingPairsSet instanceof Set
    ? existingPairsSet.has(key)
    : Boolean(existingPairsSet[key]);
}

// Flatten the checked-set to an ordered list suitable for
// `applicable_activity_types`. We preserve the activity-catalog order
// so snapshots round-trip with a predictable sort.
export function collectChecked(checkedSet, activityCatalog) {
  const set = checkedSet instanceof Set ? checkedSet : new Set(checkedSet || []);
  const out = [];
  for (const at of activityCatalog || []) {
    if (set.has(at?.activity_type_id)) out.push(at.activity_type_id);
  }
  // Include any checked items that are not in the catalog (defensive —
  // e.g. an RU carries a legacy id that has since been removed). Keep
  // their relative order via iteration of the set.
  for (const id of set) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Derive the dialog's in-scope activity list for a single activity-type
// header button in "By Activity" view. Given the full catalog + the
// currently-viewed activity_type_id, returns the (reportingUnit, checked)
// tuples we render as checkboxes. Kept here so the dialog can be
// re-used from both the per-RU path (scope=catalog) and the per-activity
// path (scope=reportingUnits).
export function buildReportingUnitSelection(reportingUnits, activityTypeId) {
  return (reportingUnits || []).map((ru) => ({
    reportingUnit: ru,
    checked: Array.isArray(ru?.applicable_activity_types)
      ? ru.applicable_activity_types.includes(activityTypeId)
      : false,
  }));
}

// Given a map of {reporting_unit_id -> checked boolean} produced by the
// per-activity dialog, and the activity_type_id that was the dialog's
// header, return an updater function suitable for `setFacilities`.
// The updater adds/removes the activity_type_id from each unit's
// `applicable_activity_types` based on the checked state; units not
// present in the map are left untouched.
export function makeApplyPerActivityUpdate({ activityTypeId, checkedById }) {
  return function applyUpdate(reportingUnits) {
    return (reportingUnits || []).map((ru) => {
      if (!Object.prototype.hasOwnProperty.call(checkedById, ru.id)) return ru;
      const checked = Boolean(checkedById[ru.id]);
      const current = Array.isArray(ru.applicable_activity_types)
        ? ru.applicable_activity_types
        : [];
      const has = current.includes(activityTypeId);
      if (checked && !has) {
        return { ...ru, applicable_activity_types: [...current, activityTypeId] };
      }
      if (!checked && has) {
        return { ...ru, applicable_activity_types: current.filter((id) => id !== activityTypeId) };
      }
      return ru;
    });
  };
}
