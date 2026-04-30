// Phase E1.5 follow-up — pure builder for the ``/calculate`` request
// body. Extracted from ``App.jsx::runCalculation`` so node --test can
// assert the exact wire shape without rendering the React tree.
//
// The ``project_id`` field is the load-bearing piece: the backend
// route uses it to look up GL mappings + FX rates + inflation
// indices and compose the ``EQMContext`` the spend-based plugin
// needs. The field is optional on the backend, so non-spend calcs
// don't strictly need it — but we always include it when an active
// project is set so a spend row added later doesn't silently fall
// into ``validation_error``.
//
// PR B — the payload now carries the project's applicability map
// (``{reporting_unit_id: applicable_activity_type_ids[] | null}``) so
// the backend can drop inapplicable rows even when the frontend filter
// misses or a direct API caller skipped it. The existing client-side
// filter (``filterRowsApplicable``) stays in place as a UX/bandwidth
// pre-filter; the backend is now the source of truth for enforcement.

// Explicit ``.js`` extension so node --test resolves through ESM
// (Vite is happy either way; node ESM requires it).
import { normalizeActivityForSubmit } from "./activityDrafts.js";

// Build the on-wire applicability map from the project's reporting
// units. Each RU contributes one entry:
//   - non-empty ``applicable_activity_types``: the explicit checklist
//   - empty / missing list: ``null`` (legacy permissive for that RU)
// Returns ``undefined`` when there are no reporting units at all so
// the field is dropped from the payload entirely (callers without RU
// state still produce minimal requests).
export function buildApplicabilityMap(reportingUnits) {
  if (!Array.isArray(reportingUnits) || reportingUnits.length === 0) {
    return undefined;
  }
  const out = {};
  for (const ru of reportingUnits) {
    if (!ru?.id) continue;
    const list = Array.isArray(ru.applicable_activity_types)
      ? ru.applicable_activity_types
      : [];
    out[ru.id] = list.length > 0 ? [...list] : null;
  }
  return out;
}

export function buildCalculationPayload({
  projectId,
  inventoryYear,
  gwpSet,
  includeTrace,
  facility,
  rows,
  activityTypesById,
  reportingUnits,
}) {
  const numericYear = Number(inventoryYear);
  return {
    // ``undefined`` (not ``null``) so JSON serialization drops the
    // field entirely when no project is active. The backend Pydantic
    // model accepts both as "not provided", but historic snapshots
    // and replay logs read cleaner without an explicit ``"project_id":
    // null`` on every payload.
    project_id: projectId || undefined,
    context: {
      inventory_year: Number.isFinite(numericYear)
        ? numericYear
        : new Date().getFullYear(),
      gwp_set: gwpSet,
      include_trace: includeTrace,
      source_attributes: {
        region: facility?.region || undefined,
        country: facility?.country || undefined,
        state: facility?.state || undefined,
        egrid_subregion: facility?.egrid_subregion || undefined,
      },
    },
    activities: (rows || []).map((draft) =>
      normalizeActivityForSubmit(
        draft,
        activityTypesById?.[draft.activity_type_id],
      ),
    ),
    applicability: buildApplicabilityMap(reportingUnits),
  };
}
