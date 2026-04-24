// Pure helpers for Reporting Unit list mutations.
//
// Kept React-free so the filtering logic can be unit-tested in node's
// built-in test runner. The thin orchestration (newly-created Set
// cleanup, dialog dismissal) lives in App.jsx alongside the state.

// Remove a Reporting Unit from a list by id. Returns a new array — does
// not mutate the input. If the id is not present, returns the original
// array reference (caller can use this as a no-op signal).
export function removeReportingUnitFromList(units, id) {
  if (!Array.isArray(units) || !id) return units || [];
  const next = units.filter((unit) => unit?.id !== id);
  if (next.length === units.length) return units;
  return next;
}

// Remove all activity drafts whose facility_id matches the deleted RU.
// Returns a new array — does not mutate the input.
export function removeActivitiesForReportingUnit(activities, id) {
  if (!Array.isArray(activities) || !id) return activities || [];
  return activities.filter((draft) => draft?.facility_id !== id);
}

// Count activity drafts that carry meaningful data for a specific RU.
// Used to surface a stronger warning in the delete-confirmation dialog
// when the user is about to discard real data. We keep the heuristic
// simple — any draft pointing at the RU with a non-empty
// activity.value or any non-blank param value counts.
export function countActivitiesWithDataForUnit(activities, id) {
  if (!Array.isArray(activities) || !id) return 0;
  let count = 0;
  for (const draft of activities) {
    if (!draft || draft.facility_id !== id) continue;
    if (draft?.activity?.value !== "" && draft?.activity?.value != null) {
      count += 1;
      continue;
    }
    const params = draft?.params || {};
    const hasParam = Object.values(params).some((value) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim() !== "";
      if (typeof value === "object") {
        const v = value.value;
        return v !== "" && v != null;
      }
      return value !== false;
    });
    if (hasParam) count += 1;
  }
  return count;
}
