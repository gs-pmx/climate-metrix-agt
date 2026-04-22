export const SNAPSHOT_VERSION = 2;

export const EMPTY_ACTIVITY = {
  id: "",
  facility_id: "",
  activity_type_id: "",
  activity: {
    value: "",
    unit: "",
  },
  params: {},
};

export function uid() {
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}

export function getPrimaryField(activityType) {
  return activityType?.input_schema?.fields?.find((field) => field.is_primary) || null;
}

function isBlankValue(value) {
  return value === "" || value == null;
}

export function hasMeaningfulParamValue(value) {
  if (isBlankValue(value)) return false;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulParamValue(item));
  if (typeof value === "object") {
    if ("value" in value && "unit" in value) {
      return !isBlankValue(value.value);
    }
    return Object.values(value).some((item) => hasMeaningfulParamValue(item));
  }
  return true;
}

export function sanitizeParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => hasMeaningfulParamValue(value)),
  );
}

export function getAllowedUnits(activityType) {
  const primaryField = getPrimaryField(activityType);
  if (Array.isArray(activityType?.allowed_units) && activityType.allowed_units.length) {
    return activityType.allowed_units;
  }
  if (Array.isArray(primaryField?.allowed_units) && primaryField.allowed_units.length) {
    return primaryField.allowed_units;
  }
  return [activityType?.default_unit || primaryField?.default_unit].filter(Boolean);
}

export function getDefaultUnit(activityType) {
  return getAllowedUnits(activityType)[0] || activityType?.default_unit || "";
}

export function getFieldUnits(field) {
  if (Array.isArray(field?.allowed_units) && field.allowed_units.length) {
    return field.allowed_units;
  }
  return [field?.default_unit].filter(Boolean);
}

export function withActivityTypeDefaults(draft, activityType) {
  if (!activityType) return draft;
  const allowedUnits = getAllowedUnits(activityType);
  const nextUnit = allowedUnits.includes(draft?.activity?.unit)
    ? draft.activity.unit
    : (getDefaultUnit(activityType) || draft?.activity?.unit || "");
  return {
    ...draft,
    activity_type_id: activityType.activity_type_id,
    activity: {
      value: draft?.activity?.value ?? "",
      unit: nextUnit,
    },
    params: sanitizeParams(draft?.params || {}),
  };
}

export function createEmptyDraft(activityType = null) {
  return withActivityTypeDefaults({ ...EMPTY_ACTIVITY, id: uid() }, activityType);
}

export function hydrateDraft(rawDraft, activityType = null) {
  const draft = {
    ...EMPTY_ACTIVITY,
    ...(rawDraft || {}),
    id: rawDraft?.id || uid(),
    facility_id: rawDraft?.facility_id || "",
    activity_type_id: rawDraft?.activity_type_id || "",
    activity: {
      value: rawDraft?.activity?.value == null ? "" : String(rawDraft.activity.value),
      unit: rawDraft?.activity?.unit || "",
    },
    params: sanitizeParams(rawDraft?.params || {}),
  };
  return withActivityTypeDefaults(draft, activityType);
}

export function serializeDraft(draft) {
  const rawValue = draft?.activity?.value;
  const numericValue =
    rawValue === "" || rawValue == null || !Number.isFinite(Number(rawValue))
      ? null
      : Number(rawValue);
  return {
    ...draft,
    activity: {
      value: numericValue,
      unit: draft?.activity?.unit || "",
    },
    params: sanitizeParams(draft?.params || {}),
  };
}

export function getDetailFields(activityType) {
  return (activityType?.input_schema?.fields || []).filter((field) => !field.is_primary);
}

export function activityRequiresDetails(activityType) {
  return getDetailFields(activityType).length > 0;
}

export function getPartialReason(activityType) {
  return activityType?.accounting_metadata?.partial_reason || "";
}

export function isEntryVisibleActivity(activityType) {
  return Boolean(activityType) && activityType.implementation_status !== "deferred";
}

export function isCalculableActivity(activityType) {
  return ["implemented", "partial"].includes(activityType?.implementation_status);
}

export function isRepeatableActivity(activityType) {
  return Boolean(
    activityType?.ui_metadata?.repeatable
      || activityType?.ui_metadata?.bulk_entry_mode === "repeatable_summary",
  );
}

export function getActivitySupportNotice(activityType) {
  if (!activityType) return null;
  if (activityType.implementation_status === "partial") {
    return {
      severity: "warning",
      message: getPartialReason(activityType)
        || "This activity is usable, but catalog metadata marks it as partial support. Review the notes below before finalizing.",
    };
  }
  if (activityType.implementation_status === "planned") {
    return {
      severity: "info",
      message: "This activity is visible for draft entry and snapshotting, but calculation is not supported yet.",
    };
  }
  if (activityType.implementation_status === "deferred") {
    return {
      severity: "warning",
      message: "This activity is deferred and not available for calculation yet.",
    };
  }
  return null;
}

export function getFieldValue(draft, field) {
  const key = field.param_key || field.field_id;
  return draft?.params?.[key];
}

export function validateDraft(draft, activityType) {
  const errors = [];
  if (!draft?.facility_id) errors.push("facility");
  if (!draft?.activity_type_id) errors.push("activity");
  if (isBlankValue(draft?.activity?.value)) errors.push("activity value");
  const numericValue = Number(draft?.activity?.value);
  if (!isBlankValue(draft?.activity?.value) && !Number.isFinite(numericValue)) {
    errors.push("activity value must be numeric");
  }
  const allowedUnits = getAllowedUnits(activityType);
  if (allowedUnits.length && !allowedUnits.includes(draft?.activity?.unit)) {
    errors.push("activity unit");
  }
  for (const field of getDetailFields(activityType)) {
    const key = field.param_key || field.field_id;
    const value = draft?.params?.[key];
    if (field.kind === "quantity") {
      const quantityValue = value && typeof value === "object" ? value : null;
      const rawQuantityValue = quantityValue?.value;
      const quantityUnit = quantityValue?.unit || "";
      const hasQuantityValue = !isBlankValue(rawQuantityValue);
      const hasQuantityUnit = !isBlankValue(quantityUnit);
      if (field.required && !hasQuantityValue) {
        errors.push(field.label);
        continue;
      }
      if (!hasQuantityValue && !hasQuantityUnit) continue;
      if (!hasQuantityValue) {
        errors.push(`${field.label} must be numeric`);
        continue;
      }
      if (!Number.isFinite(Number(rawQuantityValue))) {
        errors.push(`${field.label} must be numeric`);
      }
      const quantityUnits = getFieldUnits(field);
      if (!hasQuantityUnit) {
        errors.push(`${field.label} unit`);
      } else if (quantityUnits.length && !quantityUnits.includes(String(quantityUnit))) {
        errors.push(`${field.label} unit`);
      }
      continue;
    }
    if (field.required && isBlankValue(value)) {
      errors.push(field.label);
      continue;
    }
    if (isBlankValue(value)) continue;
    if (field.kind === "number" && !Number.isFinite(Number(value))) {
      errors.push(`${field.label} must be numeric`);
    }
    if (field.kind === "enum" && !field.options.includes(String(value))) {
      errors.push(`${field.label} must be one of ${field.options.join(", ")}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getCompletionState(draft, activityType) {
  if (!activityType) {
    return { state: "unconfigured", label: "Select activity", color: "default" };
  }
  if (activityType.implementation_status === "planned") {
    return {
      state: "unsupported",
      label: "Unsupported",
      color: "info",
    };
  }
  if (activityType.implementation_status === "deferred") {
    return {
      state: "deferred",
      label: "Deferred",
      color: "default",
    };
  }
  const validation = validateDraft(draft, activityType);
  if (validation.valid) {
    return {
      state: activityType.implementation_status === "partial" ? "partial" : "complete",
      label: activityType.implementation_status === "partial" ? "Partial support" : "Complete",
      color: activityType.implementation_status === "partial" ? "warning" : "success",
      errors: validation.errors,
    };
  }
  return {
    state: "incomplete",
    label: "Missing details",
    color: "warning",
    errors: validation.errors,
  };
}

export function normalizeActivityForSubmit(draft, activityType) {
  if (!isCalculableActivity(activityType)) {
    throw new Error(
      `${activityType?.label || draft?.activity_type_id || "Selected activity"} is not available for calculation yet`,
    );
  }
  const validation = validateDraft(draft, activityType);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }
  return {
    facility_id: draft.facility_id,
    activity_type_id: draft.activity_type_id,
    activity: {
      value: Number(draft.activity.value),
      unit: draft.activity.unit,
    },
    params: sanitizeParams(draft.params || {}),
  };
}

export function buildSnapshot({ facilities, activities, resultRows, summaryRows, traceRows, auditRows }) {
  return {
    snapshot_version: SNAPSHOT_VERSION,
    facilities,
    activities: activities.map(serializeDraft),
    result_rows: resultRows,
    summary_rows: summaryRows,
    trace_rows: traceRows,
    audit_rows: auditRows,
  };
}
