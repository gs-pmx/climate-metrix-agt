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
    params: draft?.params || {},
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
    params: rawDraft?.params || {},
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
    params: draft?.params || {},
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

export function isRepeatableActivity(activityType) {
  return Boolean(
    activityType?.ui_metadata?.repeatable
      || activityType?.ui_metadata?.bulk_entry_mode === "repeatable_summary",
  );
}

export function getFieldValue(draft, field) {
  const key = field.param_key || field.field_id;
  return draft?.params?.[key];
}

export function validateDraft(draft, activityType) {
  const errors = [];
  if (!draft?.facility_id) errors.push("facility");
  if (!draft?.activity_type_id) errors.push("activity");
  if (draft?.activity?.value === "" || draft?.activity?.value == null) errors.push("activity value");
  const numericValue = Number(draft?.activity?.value);
  if (draft?.activity?.value !== "" && !Number.isFinite(numericValue)) {
    errors.push("activity value must be numeric");
  }
  const allowedUnits = getAllowedUnits(activityType);
  if (allowedUnits.length && !allowedUnits.includes(draft?.activity?.unit)) {
    errors.push("activity unit");
  }
  for (const field of getDetailFields(activityType)) {
    const key = field.param_key || field.field_id;
    const value = draft?.params?.[key];
    if (field.required && (value === "" || value == null)) {
      errors.push(field.label);
      continue;
    }
    if (value === "" || value == null) continue;
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
  if (activityType.implementation_status === "planned" || activityType.implementation_status === "deferred") {
    return {
      state: activityType.implementation_status,
      label: activityType.implementation_status,
      color: activityType.implementation_status === "planned" ? "warning" : "default",
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
    params: draft.params || {},
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
