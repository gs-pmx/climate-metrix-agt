import * as React from "react";
import { classifyRepeatableRow, classifyRow, filterErrorsForRow } from "./rowStatus.js";

// Thin memoized hook wrappers around the pure classification in rowStatus.js.
// Re-exports shared constants/helpers for convenience so components don't
// have to pull from two places.
export {
  ROW_STATUS,
  classifyRepeatableRow,
  classifyRow,
  filterErrorsForRow,
  getRowStatusColor,
  getRowStatusLabel,
} from "./rowStatus.js";

export function useRowStatus(draft, activityType, errors = []) {
  const rowErrors = React.useMemo(
    () => filterErrorsForRow(errors, draft?.facility_id, draft?.activity_type_id),
    [errors, draft?.facility_id, draft?.activity_type_id],
  );
  return React.useMemo(
    () => classifyRow(draft, activityType, rowErrors),
    [draft, activityType, rowErrors],
  );
}

export function useRepeatableRowStatus(drafts, activityType, errors = []) {
  const facilityId = drafts?.[0]?.facility_id;
  const activityTypeId = activityType?.activity_type_id;
  const rowErrors = React.useMemo(
    () => filterErrorsForRow(errors, facilityId, activityTypeId),
    [errors, facilityId, activityTypeId],
  );
  return React.useMemo(
    () => classifyRepeatableRow(drafts, activityType, rowErrors),
    [drafts, activityType, rowErrors],
  );
}
