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

// Derive the dialog's in-scope activity list for the per-Reporting-Unit
// "+ Add Activity" dialog. Given the reporting unit + the full catalog,
// returns (activityType, checked) tuples we render as checkboxes. Checked
// mirrors whether the activity_type_id appears in the RU's
// applicable_activity_types list today. Mirror of
// `buildReportingUnitSelection`, but keyed on activityType instead of RU.
export function buildActivitySelection(reportingUnit, activityCatalog) {
  const current = new Set(
    Array.isArray(reportingUnit?.applicable_activity_types)
      ? reportingUnit.applicable_activity_types
      : [],
  );
  return (activityCatalog || []).map((at) => ({
    activityType: at,
    checked: current.has(at?.activity_type_id),
  }));
}

// Given a map of {activity_type_id -> checked boolean} produced by the
// per-Reporting-Unit "+ Add Activity" dialog, return an updater function
// suitable for `setFacilities`. Only the single reporting unit
// `reportingUnitId` is mutated; other RUs pass through unchanged.
//
// Semantics:
//   - checked=true  -> activity_type_id is added to the RU's
//                      applicable_activity_types (if not already there).
//   - checked=false -> activity_type_id is removed from the RU's list.
//   - ids not present in `checkedById` are not touched.
//
// Empty applicable_activity_types (legacy permissive) is handled the
// same way as an explicit list: adding an id materializes a non-empty
// list, which flips the RU out of legacy permissive mode. That matches
// what the user explicitly asked for by clicking into this dialog.
export function makeApplyPerReportingUnitUpdate({ reportingUnitId, checkedById }) {
  return function applyUpdate(reportingUnits) {
    return (reportingUnits || []).map((ru) => {
      if (ru?.id !== reportingUnitId) return ru;
      const current = Array.isArray(ru.applicable_activity_types)
        ? ru.applicable_activity_types
        : [];
      const currentSet = new Set(current);
      let changed = false;
      for (const [atId, isChecked] of Object.entries(checkedById || {})) {
        const has = currentSet.has(atId);
        if (isChecked && !has) {
          currentSet.add(atId);
          changed = true;
        } else if (!isChecked && has) {
          currentSet.delete(atId);
          changed = true;
        }
      }
      if (!changed) return ru;
      // Preserve original catalog order by iterating `current` first and
      // appending anything newly-added in the order it appeared in the
      // checkedById map.
      const nextList = [];
      for (const id of current) if (currentSet.has(id)) nextList.push(id);
      for (const id of Object.keys(checkedById || {})) {
        if (currentSet.has(id) && !nextList.includes(id)) nextList.push(id);
      }
      return { ...ru, applicable_activity_types: nextList };
    });
  };
}

// Phase C4 starter-default set for the Configure Sources tag library.
// The IDs match the closest catalog match as of the Phase C4 catalog
// inspection; when a future catalog rename breaks one of these, the
// dialog still works — unknown ids are just skipped by the union/set
// helpers below. Keep the list small (one representative activity per
// scope) so clicking "Use starter defaults" does not overwhelm a new
// user with twenty pre-selected pills.
export const STARTER_DEFAULT_IDS = [
  "scope1_stationary_natural_gas",
  "scope1_mobile_diesel",
  "scope2_purchased_electricity_grid_mix",
  "scope3_waste_generated_in_operations",
];

// Phase E1 — corporate starter set. The first auto-created Reporting
// Unit on a new project is named "Corporate" and pre-loads these
// activity types so the user does not have to hand-pick them. The list
// covers a typical headquarters' Scope 3 footprint (spend + business
// travel + employee commute), with no Scope 1 / 2 entries because most
// corporate offices either lease space (no Scope 1) or buy electricity
// through their landlord (no separable Scope 2 attribution). Unknown
// ids are silently skipped — they're a hint, not a hard requirement.
//
// IDs use the catalog's real activity_type_id strings (e.g.
// `scope3_employee_commuting_bus` not `…commute_bus`). Anything that
// doesn't exist in the active catalog gets dropped by
// `defaultsPresentInCatalog` rather than surfacing an error.
export const CORPORATE_STARTER_DEFAULT_IDS = [
  "scope3_spend_based",
  "scope3_business_travel_air",
  "scope3_business_travel_intercity_rail",
  "scope3_business_travel_rental_vehicle",
  "scope3_business_travel_employee_owned_vehicle",
  "scope3_employee_commuting_bus",
  "scope3_employee_commuting_transit_rail",
];

// Filter the defaults to only those present in the catalog. This keeps
// the dialog from trying to add activities the catalog does not ship.
export function defaultsPresentInCatalog(activityCatalog, defaults = STARTER_DEFAULT_IDS) {
  const catalogIds = new Set((activityCatalog || []).map((at) => at?.activity_type_id).filter(Boolean));
  return defaults.filter((id) => catalogIds.has(id));
}

// Union a set of existing checked ids with the defaults present in the
// catalog. Used by the "Add starter defaults" action.
export function addDefaultsToChecked(checkedSet, activityCatalog, defaults = STARTER_DEFAULT_IDS) {
  const next = new Set(checkedSet instanceof Set ? checkedSet : (checkedSet || []));
  for (const id of defaultsPresentInCatalog(activityCatalog, defaults)) next.add(id);
  return next;
}

// Replace the checked set with the defaults. Used by the "Use starter
// defaults" action when nothing is currently selected.
export function setDefaultsAsChecked(activityCatalog, defaults = STARTER_DEFAULT_IDS) {
  return new Set(defaultsPresentInCatalog(activityCatalog, defaults));
}

// "Select all Scope N" helper. Returns a new Set that unions
// `checkedSet` with every activity_type_id in the catalog whose scope
// matches `scopeMatcher(scope)`.
export function selectAllInScope(checkedSet, activityCatalog, scopeMatcher) {
  const next = new Set(checkedSet instanceof Set ? checkedSet : (checkedSet || []));
  for (const at of activityCatalog || []) {
    if (scopeMatcher(at?.scope)) next.add(at.activity_type_id);
  }
  return next;
}
