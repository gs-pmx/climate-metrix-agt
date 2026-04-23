import * as React from "react";
import { classifyRepeatableRow, classifyRow } from "./rowStatus.js";

// Thin memoized hook wrappers around the pure classification in rowStatus.js.
// Re-exports shared constants/helpers for convenience so components don't
// have to pull from two places.
export {
  ROW_STATUS,
  classifyRepeatableRow,
  classifyRow,
  getRowStatusColor,
  getRowStatusLabel,
} from "./rowStatus.js";

export function useRowStatus(draft, activityType) {
  return React.useMemo(() => classifyRow(draft, activityType), [draft, activityType]);
}

export function useRepeatableRowStatus(drafts, activityType) {
  return React.useMemo(() => classifyRepeatableRow(drafts, activityType), [drafts, activityType]);
}
