import * as React from "react";
import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ActivityDetailDialog from "./ActivityDetailDialog";
import CatalogCoverageBrowser from "./CatalogCoverageBrowser";
import RepeatableActivityDialog from "./RepeatableActivityDialog";
import ByActivityTable from "./ByActivityTable";
import ByFacilityTable from "./ByFacilityTable";
import RowByRowView from "./RowByRowView";
import {
  EMPTY_ACTIVITY,
  createEmptyDraft,
  getActivitySupportNotice,
  getDefaultUnit,
  isEntryVisibleActivity,
  isRepeatableActivity,
  getPartialReason,
  sanitizeParams,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";
import { hasMeaningfulData, pairKey } from "./gridEditingHelpers";

// Thin orchestrator: owns shared state, passes it down to the three view
// components. All heavy rendering lives in ByActivityTable, ByFacilityTable,
// and RowByRowView.
export default function ActivityInputsPanel({
  activities,
  setActivities,
  facilities,
  activityCatalog,
  activityTypesById,
  facilityOptions,
  inventoryYear,
  setInventoryYear,
  gwpSet,
  setGwpSet,
  includeTrace,
  setIncludeTrace,
  runCalculation,
  calculating,
  saveCurrentVersion,
  catalogError,
  calcErrors = [],
  show = () => {},
}) {
  const [viewMode, setViewMode] = React.useState("byActivity");
  const [detailDraftId, setDetailDraftId] = React.useState("");
  const [repeatableDialog, setRepeatableDialog] = React.useState(null);

  const selectableActivities = React.useMemo(
    () => activityCatalog.filter((activityType) => isEntryVisibleActivity(activityType)),
    [activityCatalog],
  );
  const visibleFacilityIds = React.useMemo(() => new Set(facilities.map((facility) => facility.id)), [facilities]);
  const visibleActivities = React.useMemo(
    () => activities.filter((draft) => !draft.facility_id || visibleFacilityIds.has(draft.facility_id)),
    [activities, visibleFacilityIds],
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

  const activePartialActivities = React.useMemo(() => {
    const seen = new Set();
    return visibleActivities
      .filter((draft) => hasMeaningfulData(draft))
      .map((draft) => activityTypesById[draft.activity_type_id])
      .filter((activityType) => activityType?.implementation_status === "partial")
      .filter((activityType) => {
        if (!activityType || seen.has(activityType.activity_type_id)) return false;
        seen.add(activityType.activity_type_id);
        return true;
      });
  }, [activityTypesById, visibleActivities]);

  const activeUnsupportedActivities = React.useMemo(() => {
    const seen = new Set();
    return visibleActivities
      .filter((draft) => hasMeaningfulData(draft))
      .map((draft) => activityTypesById[draft.activity_type_id])
      .filter((activityType) => activityType?.implementation_status === "planned")
      .filter((activityType) => {
        if (!activityType || seen.has(activityType.activity_type_id)) return false;
        seen.add(activityType.activity_type_id);
        return true;
      });
  }, [activityTypesById, visibleActivities]);

  const unsupportedActivityNotices = React.useMemo(
    () => activeUnsupportedActivities.map((activityType) => ({
      activityType,
      notice: getActivitySupportNotice(activityType),
    })),
    [activeUnsupportedActivities],
  );

  const activityOptions = React.useMemo(
    () => selectableActivities.map((activityType) => ({
      value: activityType.activity_type_id,
      label: `${activityType.label}${activityType.implementation_status === "partial" ? " (partial)" : activityType.implementation_status === "planned" ? " (unsupported)" : ""}`,
    })),
    [selectableActivities],
  );

  const addActivity = () => setActivities((prev) => [...prev, createEmptyDraft()]);
  const removeActivity = (id) => setActivities((prev) => prev.filter((draft) => draft.id !== id));

  const updateDraft = React.useCallback(
    (id, patch) => {
      setActivities((prev) => prev.map((draft) => {
        if (draft.id !== id) return draft;
        const nextDraft = {
          ...draft,
          ...patch,
          activity: patch.activity ? patch.activity : draft.activity,
          params: patch.params ? sanitizeParams(patch.params) : draft.params,
        };
        if (patch.activity_type_id) {
          const activityType = activityTypesById[patch.activity_type_id];
          return withActivityTypeDefaults(nextDraft, activityType);
        }
        return nextDraft;
      }));
    },
    [activityTypesById, setActivities],
  );

  const upsertActivity = React.useCallback(
    (facilityId, activityType, value, unit) => {
      setActivities((prev) => {
        const existingIndex = prev.findIndex(
          (draft) => draft.facility_id === facilityId && draft.activity_type_id === activityType.activity_type_id,
        );
        const normalizedValue = value === "" || value == null ? "" : String(value);
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
    [setActivities],
  );

  const replaceActivitiesForPair = React.useCallback(
    (facilityId, activityType, nextDrafts) => {
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
    [setActivities],
  );

  const openDetails = React.useCallback((draftId) => {
    setDetailDraftId(draftId);
  }, []);

  const openDetailsForPair = React.useCallback(
    (facilityId, activityTypeId) => {
      const activityType = activityTypesById[activityTypeId];
      if (isRepeatableActivity(activityType)) {
        setRepeatableDialog({ facilityId, activityTypeId });
        return;
      }
      setActivities((prev) => {
        const existing = prev.find(
          (draft) => draft.facility_id === facilityId && draft.activity_type_id === activityTypeId,
        );
        if (existing) {
          setDetailDraftId(existing.id);
          return prev;
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
        setDetailDraftId(draft.id);
        return [...prev, draft];
      });
    },
    [activityTypesById, setActivities],
  );

  const detailDraft = visibleActivities.find((draft) => draft.id === detailDraftId) || null;
  const detailActivityType = detailDraft ? activityTypesById[detailDraft.activity_type_id] : null;
  const repeatableActivityType = repeatableDialog ? activityTypesById[repeatableDialog.activityTypeId] : null;
  const repeatableFacility = repeatableDialog
    ? facilities.find((facility) => facility.id === repeatableDialog.facilityId) || null
    : null;
  const repeatableDrafts = React.useMemo(
    () => (repeatableDialog
      ? activitiesByPair.get(pairKey(repeatableDialog.facilityId, repeatableDialog.activityTypeId)) || []
      : []),
    [activitiesByPair, repeatableDialog],
  );

  const saveDetailParams = React.useCallback(
    (params) => {
      // Close the dialog first (single-click save), then update the draft.
      // Sequencing matters: if we update then close, the intermediate render
      // can leave the dialog in a half-closed state requiring a second click.
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
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="center">
          <TextField
            label="Inventory Year"
            value={inventoryYear}
            onChange={(event) => setInventoryYear(event.target.value)}
            sx={{ width: 150 }}
          />
          <Select value={gwpSet} onChange={(event) => setGwpSet(event.target.value)} sx={{ width: 150 }}>
            <MenuItem value="AR6">AR6</MenuItem>
            <MenuItem value="AR5">AR5</MenuItem>
          </Select>
          <Select
            value={String(includeTrace)}
            onChange={(event) => setIncludeTrace(event.target.value === "true")}
            sx={{ width: 170 }}
          >
            <MenuItem value="true">Include Trace</MenuItem>
            <MenuItem value="false">No Trace</MenuItem>
          </Select>
          <Typography variant="body2" color="text.secondary">
            Facility geo context still drives geography-sensitive factor selection.
          </Typography>
        </Stack>
      </Paper>

      {facilities.length === 0 ? (
        <Alert severity="info">
          Add at least one named facility in the Facilities tab before entering activity data.
        </Alert>
      ) : null}

      {activePartialActivities.map((activityType) => (
        <Alert key={activityType.activity_type_id} severity="warning">
          <strong>{activityType.label}:</strong> {getPartialReason(activityType) || "Catalog metadata marks this activity as partial support."}
        </Alert>
      ))}
      {unsupportedActivityNotices.map(({ activityType, notice }) => (
        <Alert key={activityType.activity_type_id} severity={notice?.severity || "info"}>
          <strong>{activityType.label}:</strong> {notice?.message || "Visible for draft entry and snapshotting, but not available for calculation yet."}
        </Alert>
      ))}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
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
            <ToggleButton value="byFacility">By Facility</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => saveCurrentVersion("Checkpoint before calculation.")}>
              Save Checkpoint
            </Button>
            <Button variant="contained" onClick={runCalculation} disabled={calculating}>
              {calculating ? "Calculating..." : "Run Calculation"}
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Paste from spreadsheets in the By Activity and By Facility views with Ctrl+V, use Tab to move across, and use Enter to move down to the next row in the same column. ArrowUp/ArrowDown also move between rows.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Implemented and partial rows are calculable in this phase. Planned rows remain visible for draft entry, save/load, and completeness tracking, but are skipped during calculation.
        </Typography>
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
          facilities={facilities}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          calcErrors={calcErrors}
          show={show}
        />
      ) : null}

      {viewMode === "byFacility" ? (
        <ByFacilityTable
          activitiesByPair={activitiesByPair}
          facilities={facilities}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          calcErrors={calcErrors}
          show={show}
        />
      ) : null}

      <CatalogCoverageBrowser activityCatalog={activityCatalog} />

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
        facilityName={repeatableFacility?.facility_name || ""}
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
