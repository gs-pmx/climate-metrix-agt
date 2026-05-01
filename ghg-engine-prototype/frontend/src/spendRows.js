// Phase E3 — pure helpers for spend transaction rows.
//
// Spend rows live alongside every other activity draft in the
// project's ``activities`` array — they're just drafts whose
// ``activity_type_id`` is ``scope3_spend_based``. The Spend Inputs
// tab is a custom data-entry surface over the same state, so the
// existing calc / autosave / snapshot machinery picks them up
// without any additional wiring.

import { autofillSpendRow } from "./spendMappings.js";

export const SPEND_BASED_ACTIVITY_ID = "scope3_spend_based";

// Public field list for the spend rows table — kept here so the
// table component and any paste / import helpers iterate the same
// shape and the per-row validation knows which keys to inspect.
export const SPEND_ROW_PARAM_KEYS = Object.freeze([
  "gl_code",
  "gl_account_name",
  "supplier",
  "supplier_country",
  "description",
]);

let __spendRowSeq = 0;
export function nextSpendRowId() {
  __spendRowSeq += 1;
  // Prefix avoids collision with the global ``uid()`` used elsewhere
  // when a snapshot is reloaded into a process that already minted
  // ids, but the format is still safe to use as a React key.
  return `spend_${Date.now().toString(36)}_${__spendRowSeq.toString(36)}`;
}

export function isSpendRow(activity) {
  return Boolean(activity) && activity.activity_type_id === SPEND_BASED_ACTIVITY_ID;
}

// Build an empty spend draft scoped to ``reportingUnitId``. The empty
// activity value is "" rather than 0 so the cell renders blank and
// classifies as ``not-started`` until the user types — a 0 would
// flag as ``complete`` and silently flow into the calc.
export function createEmptySpendRow(reportingUnitId) {
  return {
    id: nextSpendRowId(),
    facility_id: reportingUnitId,
    activity_type_id: SPEND_BASED_ACTIVITY_ID,
    activity: { value: "", unit: "USD" },
    params: {
      gl_code: "",
      gl_account_name: "",
      supplier: "",
      supplier_country: "",
      description: "",
    },
  };
}

export function getSpendRowsForRu(activities, reportingUnitId) {
  if (!Array.isArray(activities) || !reportingUnitId) return [];
  return activities.filter(
    (a) => isSpendRow(a) && a.facility_id === reportingUnitId,
  );
}

// Append a fresh empty spend row for ``reportingUnitId`` to the
// activities list, returning the new array AND the newly-created
// row id (so the caller can scroll/focus to it).
export function appendSpendRow(activities, reportingUnitId) {
  const next = createEmptySpendRow(reportingUnitId);
  const list = Array.isArray(activities) ? activities : [];
  return { activities: [...list, next], newRowId: next.id };
}

export function deleteSpendRow(activities, draftId) {
  if (!Array.isArray(activities) || !draftId) return activities || [];
  return activities.filter((a) => a.id !== draftId);
}

// Apply a partial patch to a single spend row, addressed by id.
// Patches are flat keys; ``activity_value`` updates ``activity.value``
// and ``param.<key>`` updates ``params[key]``.
export function patchSpendRow(activities, draftId, patch) {
  if (!Array.isArray(activities) || !draftId || !patch) {
    return activities || [];
  }
  return activities.map((a) => {
    if (a.id !== draftId || !isSpendRow(a)) return a;
    const next = { ...a };
    const nextParams = { ...(a.params || {}) };
    let paramsTouched = false;
    let activityTouched = false;
    let nextActivity = a.activity || { value: "", unit: "USD" };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "activity_value") {
        nextActivity = { ...nextActivity, value };
        activityTouched = true;
      } else if (key === "activity_unit") {
        nextActivity = { ...nextActivity, unit: value };
        activityTouched = true;
      } else if (key.startsWith("param.")) {
        nextParams[key.slice("param.".length)] = value;
        paramsTouched = true;
      } else {
        next[key] = value;
      }
    }
    if (paramsTouched) next.params = nextParams;
    if (activityTouched) next.activity = nextActivity;
    return next;
  });
}

// Phase F2 PR 7 — bulk-append spend rows from pasted data. Each entry
// in ``rowDataList`` is a partial row payload (gl_code, gl_account_name,
// supplier, supplier_country, spend_value, description); blanks are
// fine. The autofill rule fires on each row before append, so a paste
// of (gl_code only) auto-completes to (gl_code + gl_account_name)
// where the RU has a matching mapping.
//
// Returns ``{ activities, newRowIds }``. Callers can use ``newRowIds``
// to focus the first newly-added row.
export function appendSpendRowsWithData(
  activities,
  reportingUnitId,
  rowDataList,
  mappingsForRu = [],
) {
  const list = Array.isArray(activities) ? activities : [];
  const data = Array.isArray(rowDataList) ? rowDataList : [];
  if (!reportingUnitId || data.length === 0) {
    return { activities: list, newRowIds: [] };
  }
  const newRowIds = [];
  const additions = [];
  for (const entry of data) {
    const row = createEmptySpendRow(reportingUnitId);
    const filledParams = autofillSpendRow(
      {
        gl_code: String(entry?.gl_code ?? "").trim(),
        gl_account_name: String(entry?.gl_account_name ?? "").trim(),
        supplier: String(entry?.supplier ?? "").trim(),
        supplier_country: String(entry?.supplier_country ?? "").trim(),
        description: String(entry?.description ?? "").trim(),
      },
      mappingsForRu,
    );
    row.params = { ...row.params, ...filledParams };
    if (entry?.spend_value !== undefined && entry?.spend_value !== "") {
      row.activity = { ...row.activity, value: entry.spend_value };
    }
    additions.push(row);
    newRowIds.push(row.id);
  }
  return { activities: [...list, ...additions], newRowIds };
}

// Phase F2 PR 7 — per-RU summary of the spend rows for the card header.
//
// Surfaces a number total + per-warning roll-up so the card can show a
// single-glance summary instead of forcing the user to skim every
// status chip in the grid. ``totalSpend`` includes only rows whose
// spend value parses as a finite number (blank rows are excluded).
export function summarizeSpendRows(rows, mappingsForRu = []) {
  let totalSpend = 0;
  let countedSpend = 0;
  let missingGlCode = 0;
  let unmappedGlCode = 0;
  let missingSpend = 0;
  for (const row of rows || []) {
    const raw = row?.activity?.value;
    const num = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(num) && raw !== "" && raw !== null && raw !== undefined) {
      totalSpend += num;
      countedSpend += 1;
    }
    const warnings = validateSpendRow(row, mappingsForRu);
    if (warnings.includes("missing_gl_code")) missingGlCode += 1;
    if (warnings.includes("unmapped_gl_code")) unmappedGlCode += 1;
    if (warnings.includes("missing_spend")) missingSpend += 1;
  }
  return {
    count: (rows || []).length,
    totalSpend,
    countedSpend,
    missingGlCode,
    unmappedGlCode,
    missingSpend,
  };
}

// Per-row validation. Returns a list of warning-code strings; an empty
// list means the row is OK. Codes are stable so the UI can map them
// to localized messages or chip colours.
//
//   - ``missing_gl_code``  — gl_code is blank
//   - ``unmapped_gl_code`` — gl_code is set but no mapping exists for
//                            this RU (calc would fail with the same
//                            structured error from the backend)
//   - ``missing_spend``    — spend (activity.value) is blank
export function validateSpendRow(row, mappingsForRu = []) {
  if (!isSpendRow(row)) return [];
  const warnings = [];
  const glCode = String(row.params?.gl_code || "").trim();
  const spendRaw = row.activity?.value;
  const spendBlank = spendRaw === "" || spendRaw === null || spendRaw === undefined;

  if (!glCode) {
    warnings.push("missing_gl_code");
  } else {
    const mapped = (mappingsForRu || []).some(
      (m) => String(m?.gl_code || "").trim() === glCode,
    );
    if (!mapped) warnings.push("unmapped_gl_code");
  }
  if (spendBlank) warnings.push("missing_spend");
  return warnings;
}
