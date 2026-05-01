// Phase F1.2 — pure helpers backing the Notifications panel.
//
// The panel surfaces two kinds of advisory material:
//
//   * Coverage status: derived elsewhere (``coverage.js``); this
//     module just exposes a small classifier for "does coverage
//     warrant a badge" and the severity level.
//   * Catalog advisories: per-activity-type notices (partial
//     support, planned/deferred not-yet-calculable). These were
//     previously surfaced as a stack-of-banners-collapsed-to-one-row
//     above the data-entry grid; the panel takes over that role.
//
// Both groups feed the unified badge count on the sidebar's
// notifications icon. Severity ordering: error > warning > info >
// success.

import { getActivitySupportNotice, hasMeaningfulParamValue } from "./activityDrafts.js";

// Inlined here (rather than re-imported from ``gridEditingHelpers.jsx``)
// so this module stays JSX-free and unit-testable under node --test.
function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => hasMeaningfulParamValue(value));
}

const SEVERITY_RANK = { error: 3, warning: 2, info: 1, success: 0 };

export function maxSeverity(severities) {
  let bestRank = -1;
  let best = null;
  for (const s of severities || []) {
    const rank = SEVERITY_RANK[s] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = s;
    }
  }
  return best;
}

// Classify the project's coverage state into a single Alert-shaped
// notice (matches the original CoverageBanner messaging). Returns
// ``null`` when the project hasn't engaged with the applicability
// model yet (totalApplicable === 0) — same opt-in semantics as the
// banner.
export function buildCoverageNotice(coverage) {
  if (!coverage || coverage.totalApplicable === 0) return null;
  const total = coverage.totalApplicable;
  const { missing = 0, errored = 0, orphaned = 0, complete = 0 } = coverage;
  if (errored > 0) {
    return {
      id: "coverage::errored",
      severity: "error",
      title: "Calculation errors",
      message: `${errored} of ${total} sources have calculation errors.`,
      detailKind: "errored",
    };
  }
  if (missing > 0) {
    return {
      id: "coverage::missing",
      severity: "warning",
      title: "Sources without data",
      message: `${missing} of ${total} sources have no data yet.`,
      detailKind: "missing",
    };
  }
  if (orphaned > 0) {
    return {
      id: "coverage::orphaned",
      severity: "info",
      // F2 PR 3 — display copy switched from "orphaned" to "excluded"
      // per the design review. ``detailKind`` stays ``"orphaned"`` so
      // the NotificationsPanel router doesn't lose track of which
      // detail list to render.
      title: "Excluded activity data",
      message: `All ${total} sources complete, ${orphaned} ${
        orphaned === 1 ? "activity has" : "activities have"
      } data that isn't included in your inventory.`,
      detailKind: "orphaned",
    };
  }
  return {
    id: "coverage::complete",
    severity: "success",
    title: "All sources complete",
    message: `All sources have data and calculate cleanly (${complete}/${total}).`,
    detailKind: null,
  };
}

// Build the catalog-advisory list (partial / planned activity types
// with user-entered data). Mirrors the previous NoticesBanner inputs
// from ``ActivityInputsPanel``; lifted here so App-level surfaces can
// consume the same data.
export function buildCatalogAdvisories(activities, activityTypesById) {
  const types = activityTypesById || {};
  const seenPartial = new Set();
  const seenPlanned = new Set();
  const partial = [];
  const planned = [];
  for (const draft of activities || []) {
    if (!hasMeaningfulData(draft)) continue;
    const at = types[draft?.activity_type_id];
    if (!at) continue;
    if (at.implementation_status === "partial" && !seenPartial.has(at.activity_type_id)) {
      seenPartial.add(at.activity_type_id);
      partial.push(at);
    } else if (
      at.implementation_status === "planned"
      && !seenPlanned.has(at.activity_type_id)
    ) {
      seenPlanned.add(at.activity_type_id);
      planned.push(at);
    }
  }
  return [
    ...partial.map((at) => ({
      id: `partial::${at.activity_type_id}`,
      severity: "warning",
      title: at.label,
      message:
        at.accounting_metadata?.partial_reason
        || "Catalog metadata marks this activity as partial support.",
    })),
    ...planned.map((at) => {
      const note = getActivitySupportNotice(at);
      return {
        id: `unsupported::${at.activity_type_id}`,
        severity: note?.severity || "info",
        title: at.label,
        message:
          note?.message
          || "Visible for draft entry and snapshotting, but not available for calculation yet.",
      };
    }),
  ];
}

// One-shot composer: returns ``{ items, badge }`` for the
// Notifications panel. ``items`` is the merged list of all notice
// objects (coverage notice first if present, then advisories).
// ``badge`` is the count to surface on the sidebar icon — it
// excludes the success-severity coverage notice so a clean inventory
// doesn't read as "1 unread".
export function buildNotifications({ coverage, activities, activityTypesById }) {
  const coverageNotice = buildCoverageNotice(coverage);
  const advisories = buildCatalogAdvisories(activities, activityTypesById);
  const items = [];
  if (coverageNotice) items.push(coverageNotice);
  for (const a of advisories) items.push(a);
  const badge = items.filter((n) => n.severity !== "success").length;
  const severity = maxSeverity(items.map((n) => n.severity));
  return { items, badge, severity };
}
