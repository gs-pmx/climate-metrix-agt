import * as React from "react";
import { Chip, Tooltip } from "@mui/material";

import { AUTOSAVE_STATUS } from "./autosaveLogic";

// Phase D1 — small status chip rendered next to "Save Snapshot" so the
// user can see autosave state at a glance.
//
// Copy is intentionally human-readable rather than technical: the user
// shouldn't have to know what "debounce" or "draft buffer" means.

const STATUS_LABELS = {
  [AUTOSAVE_STATUS.IDLE]: "No changes",
  [AUTOSAVE_STATUS.PENDING]: "Unsaved changes",
  [AUTOSAVE_STATUS.SAVING]: "Saving...",
  [AUTOSAVE_STATUS.SAVED]: "All changes saved",
  [AUTOSAVE_STATUS.ERROR]: "Save failed - will retry",
};

const STATUS_COLORS = {
  [AUTOSAVE_STATUS.IDLE]: "default",
  [AUTOSAVE_STATUS.PENDING]: "warning",
  [AUTOSAVE_STATUS.SAVING]: "info",
  [AUTOSAVE_STATUS.SAVED]: "success",
  [AUTOSAVE_STATUS.ERROR]: "error",
};

export default function AutosaveStatusChip({ status, lastSavedAt }) {
  const label = STATUS_LABELS[status] || STATUS_LABELS[AUTOSAVE_STATUS.IDLE];
  const color = STATUS_COLORS[status] || "default";
  const tooltipText = lastSavedAt
    ? `Last autosave: ${lastSavedAt.toLocaleTimeString()}`
    : "Autosave runs about 30 seconds after each edit and on tab close.";
  return (
    <Tooltip title={tooltipText}>
      <Chip
        size="small"
        color={color}
        variant={status === AUTOSAVE_STATUS.IDLE ? "outlined" : "filled"}
        label={label}
        data-testid="autosave-status-chip"
      />
    </Tooltip>
  );
}
