import * as React from "react";
import { Chip, Tooltip } from "@mui/material";
import {
  ROW_STATUS,
  classifyRepeatableRow,
  classifyRow,
  filterErrorsForRow,
  getRowStatusColor,
  getRowStatusLabel,
} from "./rowStatus";

function tooltipFor(status, fieldErrors, missingRequired, error) {
  if (status === ROW_STATUS.BACKEND_ERROR) {
    if (!error) return "Calculation error";
    const code = error.error_code ? ` (${error.error_code})` : "";
    const msg = error.message || "Calculation failed";
    return `${msg}${code}`;
  }
  if (status === ROW_STATUS.INVALID) {
    const entries = Object.entries(fieldErrors || {});
    if (entries.length === 0) return "Invalid entry";
    return entries.map(([k, v]) => `${k}: ${v}`).join(" | ");
  }
  if (status === ROW_STATUS.MISSING_DETAILS) {
    if (!missingRequired || missingRequired.length === 0) return "Missing required fields";
    return `Missing: ${missingRequired.join(", ")}`;
  }
  return "";
}

// Status chip driven by the new row-status state machine. Only shows a
// muted/info badge when there's a reason to — not-started rows display a
// dimmed chip with no warning noise.
//
// `rowErrors` (optional) is the filtered list of backend errors that apply
// to this row. When non-empty, the chip switches to the backend-error
// variant (filled red) to distinguish it from client-side invalid
// (outlined red).
export function StatusChip({ draft, activityType, rowErrors = [] }) {
  const { status, fieldErrors, missingRequired, error } = classifyRow(draft, activityType, rowErrors);
  const label = getRowStatusLabel(status);
  const color = getRowStatusColor(status);
  // Differentiate backend-error from client-side invalid: use a filled
  // chip for backend errors so they stand out against an outlined red
  // "Invalid" chip.
  const variant = status === ROW_STATUS.BACKEND_ERROR ? "filled" : "outlined";
  const tooltip = tooltipFor(status, fieldErrors, missingRequired, error);
  const chip = (
    <Chip
      label={label}
      color={color}
      size="small"
      variant={variant}
      sx={status === ROW_STATUS.NOT_STARTED ? { opacity: 0.55 } : undefined}
    />
  );
  return tooltip ? <Tooltip title={tooltip} arrow>{chip}</Tooltip> : chip;
}

// Chip for repeatable activity rows — aggregates across all entries for a
// facility + activity-type pair.
export function RepeatableStatusChip({ drafts, activityType, rowErrors = [] }) {
  const { status, count, error } = classifyRepeatableRow(drafts, activityType, rowErrors);
  const label = count > 0
    ? `${count} ${count === 1 ? "entry" : "entries"}${status === ROW_STATUS.NOT_STARTED ? "" : ` - ${getRowStatusLabel(status).toLowerCase()}`}`
    : getRowStatusLabel(status);
  const color = getRowStatusColor(status);
  const variant = status === ROW_STATUS.BACKEND_ERROR ? "filled" : "outlined";
  const chip = (
    <Chip
      label={label}
      color={color}
      size="small"
      variant={variant}
      sx={status === ROW_STATUS.NOT_STARTED ? { opacity: 0.55 } : undefined}
    />
  );
  if (status === ROW_STATUS.BACKEND_ERROR && error) {
    const code = error.error_code ? ` (${error.error_code})` : "";
    const tooltip = `${error.message || "Calculation failed"}${code}`;
    return <Tooltip title={tooltip} arrow>{chip}</Tooltip>;
  }
  return chip;
}

// Re-export the row-error filter helper so grid renderers can derive the
// per-row slice of errors from the full response envelope in one place.
export { filterErrorsForRow };
