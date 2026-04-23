import * as React from "react";
import { Chip, Tooltip } from "@mui/material";
import {
  ROW_STATUS,
  classifyRepeatableRow,
  classifyRow,
  getRowStatusColor,
  getRowStatusLabel,
} from "./rowStatus";

function tooltipFor(status, fieldErrors, missingRequired) {
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
export function StatusChip({ draft, activityType }) {
  const { status, fieldErrors, missingRequired } = classifyRow(draft, activityType);
  const label = getRowStatusLabel(status);
  const color = getRowStatusColor(status);
  const variant = status === ROW_STATUS.NOT_STARTED ? "outlined" : "outlined";
  const tooltip = tooltipFor(status, fieldErrors, missingRequired);
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
export function RepeatableStatusChip({ drafts, activityType }) {
  const { status, count } = classifyRepeatableRow(drafts, activityType);
  const label = count > 0
    ? `${count} ${count === 1 ? "entry" : "entries"}${status === ROW_STATUS.NOT_STARTED ? "" : ` - ${getRowStatusLabel(status).toLowerCase()}`}`
    : getRowStatusLabel(status);
  const color = getRowStatusColor(status);
  return (
    <Chip
      label={label}
      color={color}
      size="small"
      variant="outlined"
      sx={status === ROW_STATUS.NOT_STARTED ? { opacity: 0.55 } : undefined}
    />
  );
}
