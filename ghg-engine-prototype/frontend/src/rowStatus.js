// Row status state machine (UI-only, purely derived from current draft + catalog).
//
// This module is intentionally free of React so the pure classification
// logic can be unit-tested in node's built-in test runner. The
// `useRowStatus` React hook is a thin memoized wrapper in useRowStatus.js.
//
// No 'backend-error' state here — calculation failures continue to
// surface through the existing snackbar.

import {
  getAllowedUnits,
  getDetailFields,
  getFieldUnits,
  getFieldValue,
  hasMeaningfulParamValue,
} from "./activityDrafts.js";
import { parseNumericInput } from "./numericFormat.js";

export const ROW_STATUS = Object.freeze({
  NOT_STARTED: "not-started",
  MISSING_DETAILS: "missing-details",
  INVALID: "invalid",
  COMPLETE: "complete",
  PARTIAL_SUPPORT: "partial-support",
  UNSUPPORTED: "unsupported",
});

const STATUS_LABELS = {
  [ROW_STATUS.NOT_STARTED]: "Not started",
  [ROW_STATUS.MISSING_DETAILS]: "Missing details",
  [ROW_STATUS.INVALID]: "Invalid",
  [ROW_STATUS.COMPLETE]: "Complete",
  [ROW_STATUS.PARTIAL_SUPPORT]: "Partial support",
  [ROW_STATUS.UNSUPPORTED]: "Unsupported",
};

// Chip color mapping — aligned with MUI semantic colors.
const STATUS_COLORS = {
  [ROW_STATUS.NOT_STARTED]: "default",
  [ROW_STATUS.MISSING_DETAILS]: "default",
  [ROW_STATUS.INVALID]: "error",
  [ROW_STATUS.COMPLETE]: "success",
  [ROW_STATUS.PARTIAL_SUPPORT]: "warning",
  [ROW_STATUS.UNSUPPORTED]: "default",
};

function isBlank(value) {
  return value === "" || value == null;
}

function hasAnyMeaningfulInput(draft) {
  if (!isBlank(draft?.activity?.value)) return true;
  return Object.values(draft?.params || {}).some((v) => hasMeaningfulParamValue(v));
}

// Returns { status, fieldErrors, missingRequired }.
// - fieldErrors: keyed by human label for invalid values (parse/unit/enum).
// - missingRequired: labels of required fields with no value (no user error).
export function classifyRow(draft, activityType) {
  if (!activityType) {
    return { status: ROW_STATUS.NOT_STARTED, fieldErrors: {}, missingRequired: [] };
  }

  if (activityType.implementation_status === "deferred") {
    return { status: ROW_STATUS.UNSUPPORTED, fieldErrors: {}, missingRequired: [] };
  }
  if (activityType.implementation_status === "planned") {
    return { status: ROW_STATUS.UNSUPPORTED, fieldErrors: {}, missingRequired: [] };
  }

  const hasInput = hasAnyMeaningfulInput(draft);

  const fieldErrors = {};
  const missingRequired = [];

  // Primary activity value validation — distinguish "missing" vs "invalid".
  const primaryValueBlank = isBlank(draft?.activity?.value);
  if (!primaryValueBlank) {
    const parsed = parseNumericInput(draft?.activity?.value);
    if (parsed == null) {
      fieldErrors["Activity value"] = "not a valid number";
    }
  }

  // Primary unit validation — only an error if user typed something.
  const allowedUnits = getAllowedUnits(activityType);
  const primaryUnit = draft?.activity?.unit;
  if (!isBlank(primaryUnit) && allowedUnits.length && !allowedUnits.includes(primaryUnit)) {
    fieldErrors["Activity unit"] = `must be one of ${allowedUnits.join(", ")}`;
  }

  // Detail fields.
  for (const field of getDetailFields(activityType)) {
    const value = getFieldValue(draft, field);
    if (field.kind === "quantity") {
      const qv = value && typeof value === "object" ? value : null;
      const rawQ = qv?.value;
      const unit = qv?.unit || "";
      const hasQ = !isBlank(rawQ);
      const hasU = !isBlank(unit);
      if (!hasQ && !hasU) {
        if (field.required) missingRequired.push(field.label);
        continue;
      }
      if (hasQ && parseNumericInput(rawQ) == null) {
        fieldErrors[field.label] = "not a valid number";
      }
      if (!hasU) {
        // Only surface a unit error if the user entered a value already.
        if (hasQ) fieldErrors[`${field.label} unit`] = "unit required";
      } else {
        const fieldUnits = getFieldUnits(field);
        if (fieldUnits.length && !fieldUnits.includes(String(unit))) {
          fieldErrors[`${field.label} unit`] = `must be one of ${fieldUnits.join(", ")}`;
        }
      }
      continue;
    }

    if (isBlank(value)) {
      if (field.required) missingRequired.push(field.label);
      continue;
    }
    if (field.kind === "number" && parseNumericInput(value) == null) {
      fieldErrors[field.label] = "not a valid number";
    }
    if (field.kind === "enum" && Array.isArray(field.options) && !field.options.includes(String(value))) {
      fieldErrors[field.label] = `must be one of ${field.options.join(", ")}`;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: ROW_STATUS.INVALID, fieldErrors, missingRequired };
  }

  if (primaryValueBlank) {
    missingRequired.unshift("Activity value");
  }
  // Primary unit is required when allowed_units is non-empty.
  if (allowedUnits.length && isBlank(primaryUnit)) {
    missingRequired.push("Activity unit");
  }

  if (!hasInput && missingRequired.length > 0) {
    return { status: ROW_STATUS.NOT_STARTED, fieldErrors, missingRequired };
  }
  if (missingRequired.length > 0) {
    return { status: ROW_STATUS.MISSING_DETAILS, fieldErrors, missingRequired };
  }

  if (activityType.implementation_status === "partial") {
    return { status: ROW_STATUS.PARTIAL_SUPPORT, fieldErrors, missingRequired };
  }
  return { status: ROW_STATUS.COMPLETE, fieldErrors, missingRequired };
}

export function getRowStatusLabel(status) {
  return STATUS_LABELS[status] || "";
}

export function getRowStatusColor(status) {
  return STATUS_COLORS[status] || "default";
}

// Aggregate classification for repeatable entries (multiple drafts against
// one activity type). Returns a single status that captures the worst-case
// state across drafts plus an entry count.
export function classifyRepeatableRow(drafts, activityType) {
  const meaningful = (drafts || []).filter((draft) => hasAnyMeaningfulInput(draft));
  if (!activityType) {
    return { status: ROW_STATUS.NOT_STARTED, count: 0 };
  }
  if (activityType.implementation_status === "deferred" || activityType.implementation_status === "planned") {
    return { status: ROW_STATUS.UNSUPPORTED, count: meaningful.length };
  }
  if (meaningful.length === 0) {
    return { status: ROW_STATUS.NOT_STARTED, count: 0 };
  }
  let anyInvalid = false;
  let anyMissing = false;
  for (const draft of meaningful) {
    const { status } = classifyRow(draft, activityType);
    if (status === ROW_STATUS.INVALID) {
      anyInvalid = true;
      break;
    }
    if (status === ROW_STATUS.MISSING_DETAILS || status === ROW_STATUS.NOT_STARTED) {
      anyMissing = true;
    }
  }
  if (anyInvalid) return { status: ROW_STATUS.INVALID, count: meaningful.length };
  if (anyMissing) return { status: ROW_STATUS.MISSING_DETAILS, count: meaningful.length };
  if (activityType.implementation_status === "partial") {
    return { status: ROW_STATUS.PARTIAL_SUPPORT, count: meaningful.length };
  }
  return { status: ROW_STATUS.COMPLETE, count: meaningful.length };
}
