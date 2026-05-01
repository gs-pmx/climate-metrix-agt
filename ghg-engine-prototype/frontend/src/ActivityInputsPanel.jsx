import * as React from "react";
import {
  Alert,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import ActivityDetailDialog from "./ActivityDetailDialog";
import RepeatableActivityDialog from "./RepeatableActivityDialog";
import ByActivityTable from "./ByActivityTable";
import ByReportingUnitTable from "./ByReportingUnitTable";
import RowByRowView from "./RowByRowView";
import ScopeChips, { SCOPE_CHIP_DEFS } from "./ScopeChips";
import { groupByTOC } from "./categorizeForTOC";
import {
  EMPTY_ACTIVITY,
  createEmptyDraft,
  getDefaultUnit,
  isEntryVisibleActivity,
  isRepeatableActivity,
  sanitizeParams,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";
import { hasMeaningfulData, pairKey } from "./gridEditingHelpers";
import { buildExistingPairsSet, ensureActivityApplicable } from "./applicability";
import { makeApplyPerActivityUpdate, makeApplyPerReportingUnitUpdate } from "./configureSources";

// Thin orchestrator: owns shared state, passes it down to the three view
// components. All heavy rendering lives in ByActivityTable,
// ByReportingUnitTable, and RowByRowView.
export default function ActivityInputsPanel({
  activities,
  setActivities,
  reportingUnits,
  setReportingUnits,
  activityCatalog,
  activityTypesById,
  activityLabelById = {},
  facilityOptions,
  runCalculation,
  calculating,
  saveCurrentVersion,
  catalogError,
  calcErrors = [],
  coverage = null,
  show = () => {},
}) {
  const [viewMode, setViewMode] = React.useState("byActivity");
  const [detailDraftId, setDetailDraftId] = React.useState("");
  const [repeatableDialog, setRepeatableDialog] = React.useState(null);
  // F2 PR 3 — active scope tracked via IntersectionObserver below so the
  // ScopeChips in the sticky toolbar highlight the scope currently in
  // view. Decoupled from ``ByActivityTable`` so the table can stay
  // focused on rendering rows.
  const [activeScopeId, setActiveScopeId] = React.useState("");

  // Bug 2 mitigation: whenever a calculation begins, force-close every
  // detail dialog (which is where the Emission Factor Override field
  // lives). Prior phases left it possible for a dialog to remain open
  // across a Run Calculation click -- most obviously when a row-button
  // dispatched `openDetailsForPair` synchronously with the calculate
  // click. Explicitly resetting here prevents the dialog from showing
  // up unexpectedly at calc time. See phased-development-plan.md Phase
  // C3 Bug 2 for the diagnostic trace.
  React.useEffect(() => {
    if (calculating) {
      setDetailDraftId("");
      setRepeatableDialog(null);
    }
  }, [calculating]);

  const selectableActivities = React.useMemo(
    () => activityCatalog.filter((activityType) => isEntryVisibleActivity(activityType)),
    [activityCatalog],
  );

  // F2 PR 3 — scope set to feed the ScopeChips, derived from the same
  // catalog tree the table uses. The chips only render scopes that
  // actually exist in the current catalog so we don't show "Scope 3"
  // when there are no Scope 3 rows.
  const availableScopeIds = React.useMemo(() => {
    const tree = groupByTOC(selectableActivities);
    return new Set(
      tree
        .filter((scope) => scope.subcategories.some((sub) => sub.activities.length > 0))
        .map((scope) => scope.id),
    );
  }, [selectableActivities]);

  // Active-scope scroll-spy. Watches the scope anchor Boxes
  // ``ByActivityTable`` registers under ``id="scope-${scope.id}"`` and
  // sets ``activeScopeId`` to the topmost scope intersecting the
  // viewport. Only runs when "By Activity" is active so we don't burn
  // observer cycles in the other view modes.
  React.useEffect(() => {
    if (viewMode !== "byActivity") {
      setActiveScopeId("");
      return undefined;
    }
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const id = visible[0].target.id || "";
        const scopeId = id.startsWith("scope-") ? id.slice("scope-".length) : "";
        if (scopeId) setActiveScopeId(scopeId);
      },
      {
        root: null,
        // Anchor lands just below the sticky stack; offset accordingly
        // so the spy flags the scope right under the toolbar.
        rootMargin: "-220px 0px -65% 0px",
        threshold: [0, 0.1],
      },
    );
    // Attach to every present scope anchor. Any not-yet-mounted scopes
    // (e.g. before the table renders) get picked up on a re-run when
    // ``availableScopeIds`` changes.
    SCOPE_CHIP_DEFS.forEach((scope) => {
      const node = document.getElementById(`scope-${scope.id}`);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [viewMode, availableScopeIds]);
  const visibleReportingUnitIds = React.useMemo(
    () => new Set(reportingUnits.map((ru) => ru.id)),
    [reportingUnits],
  );
  const visibleActivities = React.useMemo(
    () => activities.filter((draft) => !draft.facility_id || visibleReportingUnitIds.has(draft.facility_id)),
    [activities, visibleReportingUnitIds],
  );
  const activitiesByPair = React.useMemo(() => {
    const next = new Map();
    visibleActivities.forEach((draft) => {
      if (draft.facility_id && draft.activity_type_id) {
        const key = pairKey(draft.facility_id, draft.activity_type_id);
        if (!next.has(key)) next.set(key, []);
        next.get(key).push(draft);
      }
    });
    return next;
  }, [visibleActivities]);

  const existingActivitiesByPair = React.useMemo(
    () => buildExistingPairsSet(visibleActivities),
    [visibleActivities],
  );

  // Phase F1.2 — partial / planned advisories are now computed at App
  // level via ``buildCatalogAdvisories`` (in ``notices.js``) and
  // surfaced through the sidebar Notifications panel. The per-tab
  // memos that used to drive the inline NoticesBanner are gone.

  const activityOptions = React.useMemo(
    () => selectableActivities.map((activityType) => ({
      value: activityType.activity_type_id,
      label: `${activityType.label}${activityType.implementation_status === "partial" ? " (partial)" : activityType.implementation_status === "planned" ? " (unsupported)" : ""}`,
    })),
    [selectableActivities],
  );

  const addActivity = () => setActivities((prev) => [...prev, createEmptyDraft()]);
  const removeActivity = (id) => setActivities((prev) => prev.filter((draft) => draft.id !== id));

  // Bug 1: when a draft gets created for a (reporting_unit_id,
  // activity_type_id) pair that falls outside the RU's configured
  // applicable list, auto-append the activity type to that RU's list
  // and fire a toast. Without this guard the backend canonicalization
  // filter drops the data at calculation time with no user feedback.
  const ensureApplicable = React.useCallback(
    (facilityId, activityTypeId) => {
      if (!facilityId || !activityTypeId || !setReportingUnits) return;
      setReportingUnits((prev) => {
        const { reportingUnits: next, wasAdded } = ensureActivityApplicable({
          reportingUnits: prev,
          reportingUnitId: facilityId,
          activityTypeId,
        });
        if (wasAdded) {
          const ru = next.find((r) => r?.id === facilityId);
          const activityType = activityTypesById[activityTypeId];
          const ruLabel = ru?.facility_name?.trim() || "this Reporting Unit";
          const activityLabel = activityType?.label || activityTypeId;
          show(`Added "${activityLabel}" to ${ruLabel}'s sources.`, "info");
        }
        return next;
      });
    },
    [activityTypesById, setReportingUnits, show],
  );

  const updateDraft = React.useCallback(
    (id, patch) => {
      let nextSnapshot = null;
      setActivities((prev) => prev.map((draft) => {
        if (draft.id !== id) return draft;
        const nextDraft = {
          ...draft,
          ...patch,
          activity: patch.activity ? patch.activity : draft.activity,
          params: patch.params ? sanitizeParams(patch.params) : draft.params,
        };
        const finalDraft = patch.activity_type_id
          ? withActivityTypeDefaults(nextDraft, activityTypesById[patch.activity_type_id])
          : nextDraft;
        nextSnapshot = finalDraft;
        return finalDraft;
      }));
      // Row-by-row view sets facility_id, activity_type_id, and activity
      // value independently. Fire the auto-add guard whenever both
      // ids are set and the draft has meaningful data — this is the
      // moment the canonicalization filter would otherwise silently
      // drop the row on save (Bug 1).
      if (
        nextSnapshot
        && nextSnapshot.facility_id
        && nextSnapshot.activity_type_id
        && hasMeaningfulData(nextSnapshot)
      ) {
        ensureApplicable(nextSnapshot.facility_id, nextSnapshot.activity_type_id);
      }
    },
    [activityTypesById, ensureApplicable, setActivities],
  );

  const upsertActivity = React.useCallback(
    (facilityId, activityType, value, unit) => {
      const normalizedValue = value === "" || value == null ? "" : String(value);
      // Auto-add the pair to the RU's applicable list on creation so
      // the canonicalization filter does not silently drop the data
      // (Bug 1). No-op when the RU's list is empty (legacy permissive)
      // or already includes the activity type.
      if (normalizedValue !== "") {
        ensureApplicable(facilityId, activityType?.activity_type_id);
      }
      setActivities((prev) => {
        const existingIndex = prev.findIndex(
          (draft) => draft.facility_id === facilityId && draft.activity_type_id === activityType.activity_type_id,
        );
        if (normalizedValue === "") {
          if (existingIndex >= 0) return prev.filter((_, index) => index !== existingIndex);
          return prev;
        }
        const baseDraft = existingIndex >= 0 ? prev[existingIndex] : { ...EMPTY_ACTIVITY, id: uid(), params: {} };
        const nextDraft = withActivityTypeDefaults(
          {
            ...baseDraft,
            facility_id: facilityId,
            activity_type_id: activityType.activity_type_id,
            activity: {
              value: normalizedValue,
              unit: unit || getDefaultUnit(activityType),
            },
          },
          activityType,
        );
        if (existingIndex >= 0) {
          return prev.map((draft, index) => (index === existingIndex ? nextDraft : draft));
        }
        return [...prev, nextDraft];
      });
    },
    [ensureApplicable, setActivities],
  );

  const replaceActivitiesForPair = React.useCallback(
    (facilityId, activityType, nextDrafts) => {
      const hasAnyMeaningful = (nextDrafts || []).some((draft) => hasMeaningfulData(draft));
      if (hasAnyMeaningful) {
        ensureApplicable(facilityId, activityType?.activity_type_id);
      }
      setActivities((prev) => {
        const filtered = prev.filter(
          (draft) => !(draft.facility_id === facilityId && draft.activity_type_id === activityType.activity_type_id),
        );
        const normalized = nextDrafts
          .filter((draft) => hasMeaningfulData(draft))
          .map((draft) => withActivityTypeDefaults(
            {
              ...draft,
              id: draft.id || uid(),
              facility_id: facilityId,
              activity_type_id: activityType.activity_type_id,
            },
            activityType,
          ));
        return [...filtered, ...normalized];
      });
    },
    [ensureApplicable, setActivities],
  );

  const openDetails = React.useCallback((draftId) => {
    setDetailDraftId(draftId);
  }, []);

  // Ref-backed snapshot of the current activities list. Used below so the
  // callback reads activities synchronously without capturing a stale
  // closure, and without the anti-pattern of calling setState inside a
  // setState updater (which re-runs twice under React strict mode and
  // risked transiently opening the detail dialog on a ghost draft).
  const activitiesRef = React.useRef(activities);
  activitiesRef.current = activities;

  const openDetailsForPair = React.useCallback(
    (facilityId, activityTypeId) => {
      const activityType = activityTypesById[activityTypeId];
      if (isRepeatableActivity(activityType)) {
        setRepeatableDialog({ facilityId, activityTypeId });
        return;
      }
      const currentActivities = activitiesRef.current;
      const existing = currentActivities.find(
        (draft) => draft.facility_id === facilityId && draft.activity_type_id === activityTypeId,
      );
      if (existing) {
        setDetailDraftId(existing.id);
        return;
      }
      const draft = withActivityTypeDefaults(
        {
          ...EMPTY_ACTIVITY,
          id: uid(),
          facility_id: facilityId,
          activity_type_id: activityTypeId,
        },
        activityType,
      );
      setActivities((prev) => [...prev, draft]);
      setDetailDraftId(draft.id);
    },
    [activityTypesById, setActivities],
  );

  // Per-activity "+ Add Reporting Unit" save handler. Mutates each listed
  // RU's applicable_activity_types based on the checked map coming back
  // from the dialog.
  const applyAddReportingUnit = React.useCallback(
    (activityTypeId, checkedById) => {
      if (!setReportingUnits) return;
      const updater = makeApplyPerActivityUpdate({ activityTypeId, checkedById });
      setReportingUnits((prev) => updater(prev));
    },
    [setReportingUnits],
  );

  // Symmetric per-RU "+ Add Activity" save handler. Mutates the single
  // target RU's applicable_activity_types based on the activity-type map
  // the dialog hands back.
  const applyAddActivity = React.useCallback(
    (reportingUnitId, checkedById) => {
      if (!setReportingUnits) return;
      const updater = makeApplyPerReportingUnitUpdate({ reportingUnitId, checkedById });
      setReportingUnits((prev) => updater(prev));
    },
    [setReportingUnits],
  );

  const detailDraft = visibleActivities.find((draft) => draft.id === detailDraftId) || null;
  const detailActivityType = detailDraft ? activityTypesById[detailDraft.activity_type_id] : null;
  const repeatableActivityType = repeatableDialog ? activityTypesById[repeatableDialog.activityTypeId] : null;
  const repeatableReportingUnit = repeatableDialog
    ? reportingUnits.find((ru) => ru.id === repeatableDialog.facilityId) || null
    : null;
  const repeatableDrafts = React.useMemo(
    () => (repeatableDialog
      ? activitiesByPair.get(pairKey(repeatableDialog.facilityId, repeatableDialog.activityTypeId)) || []
      : []),
    [activitiesByPair, repeatableDialog],
  );

  const saveDetailParams = React.useCallback(
    (params) => {
      const idToUpdate = detailDraftId;
      setDetailDraftId("");
      if (idToUpdate) {
        updateDraft(idToUpdate, { params });
      }
    },
    [detailDraftId, updateDraft],
  );

  return (
    <Stack spacing={2}>
      {/*
        Phase F1.2 — coverage status and catalog advisories used to be
        rendered as inline banners here (CoverageBanner + the
        consolidated NoticesBanner row). Both moved to the sidebar's
        Notifications panel so the data-entry surface stops being
        crowded by persistent advisories. The same data still reaches
        the user; it's just one click away instead of always-visible.

        Phase F1.4 — the Inventory Year / GWP / Include Trace inputs
        moved out of this panel. They now surface read-only in the
        non-sticky project header sub-line and edit through the
        EditProjectSetupDialog opened from the top bar. Reporting Unit
        geo context still drives geography-sensitive factor selection
        (handled per-RU in the Reporting Units tab).
      */}
      {reportingUnits.length === 0 ? (
        <Alert severity="info">
          Add at least one named Reporting Unit in the Reporting Units tab before entering activity data.
        </Alert>
      ) : null}

      {/*
        Post-C4 item 2: the view-selector + save/run bar sticks just
        below the app-level top bar (Layer 1 -> Layer 2 stack). The
        bar's zIndex stays under the app nav's so the dropdown shadows
        don't punch through. `--sticky-top-height` is set in main.jsx
        root styles.
        Post-C4 polish items 4 + 5: the bar is now fully opaque
        (bgcolor instead of a blur layer) so rows don't bleed through,
        and carries a subtle bottom shadow so the flowing data rows
        below it feel visually distinct. The sticky `top` sits flush
        with the nav bar's bottom edge so there is no see-through gap
        between the two layers.
      */}
      <Paper
        sx={{
          // F2 PR 4 — view-selector bar lightened. Padding from 16
          // to 12 and the heavy ``0 3px 10px`` override shadow
          // dropped in favor of a single-line bottom border that
          // reads as a clean separation without the "floating
          // obstruction" the design review flagged. Combined with
          // the bar living flush below the app's sticky tabs, the
          // user sees a contiguous command band rather than two
          // stacked floating panels.
          p: 1.5,
          position: "sticky",
          top: "var(--sticky-top-height)",
          zIndex: (theme) => theme.zIndex.appBar - 1,
          bgcolor: "background.paper",
          boxShadow: "none",
          borderRadius: 0,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        }}
        data-testid="view-selector-bar"
      >
        <Stack
          direction="row"
          justifyContent="flex-start"
          alignItems="center"
          spacing={2}
          sx={{ flexWrap: "wrap", rowGap: 1 }}
        >
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, nextValue) => {
              if (nextValue) setViewMode(nextValue);
            }}
            size="small"
          >
            <ToggleButton value="rowByRow">Row-by-Row</ToggleButton>
            <ToggleButton value="byActivity">By Activity</ToggleButton>
            <ToggleButton value="byFacility">By Reporting Unit</ToggleButton>
          </ToggleButtonGroup>
          {/* F2 PR 3 — Scope chips render only when "By Activity" is the
              active view; in Row-by-Row and By-Reporting-Unit the
              chips have no scope anchors to jump to. The chips read
              from a memoized scope set computed downstream and call
              ``scrollToScope`` (anchor-based navigation, decoupled
              from the table). Active-scope highlight is driven by
              the scroll-spy in the Activity Inputs container. */}
          {viewMode === "byActivity" ? (
            <ScopeChips
              activeScopeId={activeScopeId}
              availableScopeIds={availableScopeIds}
            />
          ) : null}
          {/* Phase F1: Save Version + Run Calculation moved to App.jsx
              top bar so they're reachable from any tab.
              Phase F2 PR 3: dropped the inline "how to paste" + the
              "implemented/planned" status copy that used to sit
              beneath this toggle — daily users know how to paste, and
              the implementation-status framing isn't customer-facing
              language. */}
        </Stack>
      </Paper>

      {viewMode === "rowByRow" ? (
        <RowByRowView
          activities={visibleActivities}
          activityTypesById={activityTypesById}
          facilityOptions={facilityOptions}
          activityOptions={activityOptions}
          updateDraft={updateDraft}
          addActivity={addActivity}
          removeActivity={removeActivity}
          openDetails={openDetails}
          catalogError={catalogError}
          calcErrors={calcErrors}
        />
      ) : null}

      {viewMode === "byActivity" ? (
        <ByActivityTable
          activitiesByPair={activitiesByPair}
          reportingUnits={reportingUnits}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          calcErrors={calcErrors}
          onApplyAddReportingUnit={applyAddReportingUnit}
          existingActivitiesByPair={existingActivitiesByPair}
          show={show}
        />
      ) : null}

      {viewMode === "byFacility" ? (
        <ByReportingUnitTable
          activitiesByPair={activitiesByPair}
          reportingUnits={reportingUnits}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          calcErrors={calcErrors}
          onApplyAddActivity={applyAddActivity}
          existingActivitiesByPair={existingActivitiesByPair}
          show={show}
        />
      ) : null}

      <ActivityDetailDialog
        open={Boolean(detailDraft && detailActivityType)}
        draft={detailDraft}
        activityType={detailActivityType}
        onClose={() => setDetailDraftId("")}
        onSave={saveDetailParams}
      />

      <RepeatableActivityDialog
        open={Boolean(repeatableDialog && repeatableActivityType)}
        activityType={repeatableActivityType}
        facilityId={repeatableDialog?.facilityId || ""}
        facilityName={repeatableReportingUnit?.facility_name || ""}
        drafts={repeatableDrafts}
        onClose={() => setRepeatableDialog(null)}
        onSave={(nextDrafts) => {
          if (!repeatableDialog || !repeatableActivityType) return;
          replaceActivitiesForPair(repeatableDialog.facilityId, repeatableActivityType, nextDrafts);
          setRepeatableDialog(null);
        }}
      />
    </Stack>
  );
}
