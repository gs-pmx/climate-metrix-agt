import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DataGrid } from "@mui/x-data-grid";
import ActivityDetailDialog from "./ActivityDetailDialog";
import CatalogCoverageBrowser from "./CatalogCoverageBrowser";
import RepeatableActivityDialog from "./RepeatableActivityDialog";
import {
  EMPTY_ACTIVITY,
  activityRequiresDetails,
  createEmptyDraft,
  getAllowedUnits,
  getCompletionState,
  getDefaultUnit,
  getPartialReason,
  isRepeatableActivity,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";
import { parseTSV } from "./usePasteHandler";

function CompletionChip({ draft, activityType }) {
  const completion = getCompletionState(draft, activityType);
  return <Chip label={completion.label} color={completion.color} size="small" variant="outlined" />;
}

function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => value !== "" && value != null);
}

function pairKey(facilityId, activityTypeId) {
  return `${facilityId}::${activityTypeId}`;
}

function RepeatableCompletionChip({ drafts, activityType }) {
  const meaningfulDrafts = drafts.filter(hasMeaningfulData);
  if (!meaningfulDrafts.length) {
    return <Chip label="No entries" color="default" size="small" variant="outlined" />;
  }
  const invalidCount = meaningfulDrafts.filter((draft) => {
    const state = getCompletionState(draft, activityType).state;
    return !["complete", "partial"].includes(state);
  }).length;
  if (invalidCount > 0) {
    return <Chip label={`${meaningfulDrafts.length} entries, ${invalidCount} incomplete`} color="warning" size="small" variant="outlined" />;
  }
  if (activityType?.implementation_status === "partial") {
    return <Chip label={`${meaningfulDrafts.length} entries, partial`} color="warning" size="small" variant="outlined" />;
  }
  return <Chip label={`${meaningfulDrafts.length} entries`} color="success" size="small" variant="outlined" />;
}

function makePasteAndNavigationHandler({ getRows, editableFields, onPasteApply, show, canEditCell = () => true }) {
  function advancePosition(rowIndex, fieldIndex, isReverse, key) {
    let nextRowIndex = rowIndex;
    let nextFieldIndex = fieldIndex;
    if (key === "Enter") {
      nextRowIndex += isReverse ? -1 : 1;
    } else if (isReverse) {
      if (fieldIndex === 0) {
        nextRowIndex -= 1;
        nextFieldIndex = editableFields.length - 1;
      } else {
        nextFieldIndex -= 1;
      }
    } else if (fieldIndex === editableFields.length - 1) {
      nextRowIndex += 1;
      nextFieldIndex = 0;
    } else {
      nextFieldIndex += 1;
    }
    return { nextRowIndex, nextFieldIndex };
  }

  return (params, event) => {
    const key = String(event.key || "");

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "v") {
      event.preventDefault();
      event.defaultMuiPrevented = true;

      navigator.clipboard.readText().then((text) => {
        const parsed = parseTSV(text);
        if (!parsed.length) return;

        const gridRows = getRows();
        const rowIds = gridRows.map((row) => row.id);
        const startRowIndex = rowIds.indexOf(params.id);
        if (startRowIndex < 0) return;

        let startColumnIndex = editableFields.indexOf(params.field);
        if (startColumnIndex < 0) startColumnIndex = 0;

        const updates = [];
        for (let rowOffset = 0; rowOffset < parsed.length; rowOffset += 1) {
          const rowIndex = startRowIndex + rowOffset;
          if (rowIndex >= gridRows.length) break;
          const nextRow = { ...gridRows[rowIndex] };
          let changed = false;
          for (let columnOffset = 0; columnOffset < parsed[rowOffset].length; columnOffset += 1) {
            const columnIndex = startColumnIndex + columnOffset;
            if (columnIndex >= editableFields.length) break;
            const field = editableFields[columnIndex];
            if (!canEditCell(nextRow, field)) continue;
            const cellValue = parsed[rowOffset][columnOffset];
            if (cellValue === "") continue;
            nextRow[field] = cellValue;
            changed = true;
          }
          if (changed) updates.push(nextRow);
        }

        if (updates.length) {
          onPasteApply(updates);
          show(`Pasted ${updates.length} row(s).`, "success");
        }
      }).catch(() => {
        show("Could not read clipboard. Check browser permissions.", "warning");
      });
      return;
    }

    if (key !== "Tab" && key !== "Enter") return;

    const rowIds = getRows().map((row) => row.id);
    const rowIndex = rowIds.indexOf(params.id);
    const fieldIndex = editableFields.indexOf(params.field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    const isReverse = event.shiftKey;
    let { nextRowIndex, nextFieldIndex } = advancePosition(rowIndex, fieldIndex, isReverse, key);

    let attempts = 0;
    const rows = getRows();
    while (rows[nextRowIndex] && editableFields[nextFieldIndex] && !canEditCell(rows[nextRowIndex], editableFields[nextFieldIndex])) {
      ({ nextRowIndex, nextFieldIndex } = advancePosition(nextRowIndex, nextFieldIndex, isReverse, key));
      attempts += 1;
      if (attempts > rows.length * Math.max(editableFields.length, 1)) return;
    }

    const nextRowId = rowIds[nextRowIndex];
    const nextField = editableFields[nextFieldIndex];
    if (nextRowId === undefined || !nextField) return;

    event.preventDefault();
    event.defaultMuiPrevented = true;

    if (params.cellMode === "edit") {
      params.api.stopCellEditMode({ id: params.id, field: params.field });
    }
    params.api.setCellFocus(nextRowId, nextField);
    params.api.startCellEditMode({ id: nextRowId, field: nextField });
  };
}

function RowByRowView({
  activities,
  activityTypesById,
  facilityOptions,
  activityOptions,
  updateDraft,
  addActivity,
  removeActivity,
  openDetails,
  catalogError,
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">Activity Inputs</Typography>
        <Button variant="outlined" onClick={addActivity}>
          Add Activity Row
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Use this view for one-off edits. Bulk paste, spreadsheet-style entry, and Enter-to-next-row navigation are available in the By Activity and By Facility views.
      </Typography>
      {catalogError ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          Failed to load activity catalog: {catalogError}
        </Alert>
      ) : null}
      <TableContainer sx={{ maxHeight: 520, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Facility</TableCell>
              <TableCell>Activity</TableCell>
              <TableCell>Activity Value</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Details</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {activities.map((draft) => {
              const activityType = activityTypesById[draft.activity_type_id];
              const unitOptions = getAllowedUnits(activityType);
              return (
                <TableRow key={draft.id}>
                  <TableCell sx={{ minWidth: 210 }}>
                    <Select
                      size="small"
                      value={draft.facility_id}
                      onChange={(event) => updateDraft(draft.id, { facility_id: event.target.value })}
                      fullWidth
                    >
                      {facilityOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 280 }}>
                    <Select
                      size="small"
                      value={draft.activity_type_id}
                      onChange={(event) => updateDraft(draft.id, { activity_type_id: event.target.value })}
                      fullWidth
                    >
                      {activityOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <TextField
                      size="small"
                      type="number"
                      value={draft.activity.value}
                      onChange={(event) => updateDraft(draft.id, { activity: { ...draft.activity, value: event.target.value } })}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    <Select
                      size="small"
                      value={draft.activity.unit}
                      onChange={(event) => updateDraft(draft.id, { activity: { ...draft.activity, unit: event.target.value } })}
                      fullWidth
                    >
                      {unitOptions.map((unit) => (
                        <MenuItem key={unit} value={unit}>
                          {unit}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <CompletionChip draft={draft} activityType={activityType} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!activityType}
                      onClick={() => openDetails(draft.id)}
                    >
                      {isRepeatableActivity(activityType) ? "Entry Details" : activityRequiresDetails(activityType) ? "Edit" : "View"}
                    </Button>
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Button color="error" size="small" onClick={() => removeActivity(draft.id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function BulkByActivityView({
  activitiesByPair,
  facilities,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  return (
    <Stack spacing={1}>
      {selectableActivities.map((activityType) => (
        <ActivityAccordion
          key={activityType.activity_type_id}
          activityType={activityType}
          activitiesByPair={activitiesByPair}
          facilities={facilities}
          totalActivities={selectableActivities.length}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          show={show}
        />
      ))}
    </Stack>
  );
}

function ActivityAccordion({
  activityType,
  activitiesByPair,
  facilities,
  totalActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  const repeatable = isRepeatableActivity(activityType);
  const unitOptions = getAllowedUnits(activityType);
  const gridRows = React.useMemo(
    () => facilities.map((facility) => {
      const drafts = activitiesByPair.get(pairKey(facility.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: facility.id }, activityType);
      return {
        id: `${activityType.activity_type_id}__${facility.id}`,
        facility_id: facility.id,
        facility_name: facility.facility_name,
        activity_value: draft.activity.value,
        activity_unit: draft.activity.unit || getDefaultUnit(activityType),
        draft,
        drafts,
        draft_count: drafts.filter(hasMeaningfulData).length,
        _repeatable: repeatable,
        _unitOptions: unitOptions,
      };
    }),
    [activitiesByPair, activityType, facilities, repeatable, unitOptions],
  );

  const filledCount = gridRows.filter((row) => (repeatable ? row.draft_count > 0 : row.activity_value !== "")).length;
  const columns = React.useMemo(
    () => repeatable
      ? [
        { field: "facility_name", headerName: "Facility", flex: 1, editable: false },
        {
          field: "draft_count",
          headerName: "Entries",
          flex: 0.7,
          editable: false,
          sortable: false,
          renderCell: (params) => (
            <Typography variant="body2">
              {params.row.draft_count ? `${params.row.draft_count} entries` : "No entries"}
            </Typography>
          ),
        },
        {
          field: "status",
          headerName: "Status",
          flex: 0.85,
          editable: false,
          sortable: false,
          renderCell: (params) => <RepeatableCompletionChip drafts={params.row.drafts} activityType={activityType} />,
        },
        {
          field: "details",
          headerName: "Details",
          flex: 0.7,
          editable: false,
          sortable: false,
          renderCell: (params) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => openDetailsForPair(params.row.facility_id, activityType.activity_type_id)}
            >
              Manage
            </Button>
          ),
        },
      ]
      : [
        { field: "facility_name", headerName: "Facility", flex: 1, editable: false },
        { field: "activity_value", headerName: "Activity Value", flex: 0.8, editable: true, type: "number" },
        {
          field: "activity_unit",
          headerName: "Unit",
          flex: 0.6,
          editable: true,
          type: "singleSelect",
          valueOptions: unitOptions,
        },
        {
          field: "status",
          headerName: "Status",
          flex: 0.75,
          editable: false,
          sortable: false,
          renderCell: (params) => <CompletionChip draft={params.row.draft} activityType={activityType} />,
        },
        {
          field: "details",
          headerName: "Details",
          flex: 0.6,
          editable: false,
          sortable: false,
          renderCell: (params) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => openDetailsForPair(params.row.facility_id, activityType.activity_type_id)}
            >
              {activityRequiresDetails(activityType) ? "Edit" : "View"}
            </Button>
          ),
        },
      ],
    [activityType, openDetailsForPair, repeatable, unitOptions],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      upsertActivity(newRow.facility_id, activityType, newRow.activity_value, newRow.activity_unit);
      return newRow;
    },
    [activityType, upsertActivity],
  );

  const rowsRef = React.useRef(gridRows);
  rowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () => (repeatable ? null : makePasteAndNavigationHandler({
      getRows: () => rowsRef.current,
      editableFields: ["activity_value", "activity_unit"],
      onPasteApply: (updatedRows) => {
        updatedRows.forEach((row) => {
          upsertActivity(row.facility_id, activityType, row.activity_value, row.activity_unit);
        });
      },
      show,
    })),
    [activityType, repeatable, show, upsertActivity],
  );

  return (
    <Accordion defaultExpanded={totalActivities <= 8}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {activityType.label}
          </Typography>
          <Chip label={activityType.scope} size="small" variant="outlined" />
          <Chip label={activityType.implementation_status} size="small" variant="outlined" />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{facilities.length} facilities
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <Box sx={{ width: "100%" }}>
          <DataGrid
            rows={gridRows}
            columns={columns}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={() => {}}
            onCellKeyDown={handleCellKeyDown || undefined}
            disableRowSelectionOnClick
            autoHeight
            density="compact"
            hideFooter={facilities.length <= 25}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

function BulkByFacilityView({
  activitiesByPair,
  facilities,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  return (
    <Stack spacing={1}>
      {facilities.map((facility) => (
        <FacilityAccordion
          key={facility.id}
          facility={facility}
          activitiesByPair={activitiesByPair}
          selectableActivities={selectableActivities}
          facilityCount={facilities.length}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          show={show}
        />
      ))}
    </Stack>
  );
}

function FacilityAccordion({
  facility,
  activitiesByPair,
  selectableActivities,
  facilityCount,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  const gridRows = React.useMemo(
    () => selectableActivities.map((activityType) => {
      const drafts = activitiesByPair.get(pairKey(facility.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: facility.id }, activityType);
      return {
        id: `${facility.id}__${activityType.activity_type_id}`,
        facility_id: facility.id,
        activity_type_id: activityType.activity_type_id,
        activity_label: activityType.label,
        scope: activityType.scope,
        activity_value: draft.activity.value,
        activity_unit: draft.activity.unit || getDefaultUnit(activityType),
        draft,
        drafts,
        draft_count: drafts.filter(hasMeaningfulData).length,
        _repeatable: isRepeatableActivity(activityType),
        _unitOptions: getAllowedUnits(activityType),
        _activityType: activityType,
      };
    }),
    [activitiesByPair, facility.id, selectableActivities],
  );

  const filledCount = gridRows.filter((row) => (row._repeatable ? row.draft_count > 0 : row.activity_value !== "")).length;
  const columns = React.useMemo(
    () => [
      { field: "activity_label", headerName: "Activity", flex: 1, editable: false },
      { field: "scope", headerName: "Scope", flex: 0.55, editable: false },
      {
        field: "activity_value",
        headerName: "Activity Value",
        flex: 0.8,
        editable: true,
        type: "number",
        renderCell: (params) => (
          params.row._repeatable ? (
            <Typography variant="body2" color="text.secondary">
              {params.row.draft_count ? `${params.row.draft_count} entries` : "Manage in details"}
            </Typography>
          ) : params.value
        ),
      },
      {
        field: "activity_unit",
        headerName: "Unit",
        flex: 0.6,
        editable: true,
        type: "singleSelect",
        valueOptions: ({ row }) => row?._unitOptions || [],
        renderCell: (params) => (
          params.row._repeatable ? (
            <Typography variant="body2" color="text.secondary">Details</Typography>
          ) : params.value
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 0.75,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          params.row._repeatable
            ? <RepeatableCompletionChip drafts={params.row.drafts} activityType={params.row._activityType} />
            : <CompletionChip draft={params.row.draft} activityType={params.row._activityType} />
        ),
      },
      {
        field: "details",
        headerName: "Details",
        flex: 0.6,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          <Button
            size="small"
            variant="outlined"
            onClick={() => openDetailsForPair(facility.id, params.row.activity_type_id)}
          >
            {params.row._repeatable ? "Manage" : activityRequiresDetails(params.row._activityType) ? "Edit" : "View"}
          </Button>
        ),
      },
    ],
    [facility.id, openDetailsForPair],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      upsertActivity(newRow.facility_id, newRow._activityType, newRow.activity_value, newRow.activity_unit);
      return newRow;
    },
    [upsertActivity],
  );

  const rowsRef = React.useRef(gridRows);
  rowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () => makePasteAndNavigationHandler({
      getRows: () => rowsRef.current,
      editableFields: ["activity_value", "activity_unit"],
      onPasteApply: (updatedRows) => {
        updatedRows.forEach((row) => {
          if (row._repeatable) return;
          upsertActivity(row.facility_id, row._activityType, row.activity_value, row.activity_unit);
        });
      },
      canEditCell: (row) => !row._repeatable,
      show,
    }),
    [show, upsertActivity],
  );

  return (
    <Accordion defaultExpanded={facilityCount <= 8}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {facility.facility_name}
          </Typography>
          {facility.state ? <Chip label={facility.state} size="small" variant="outlined" /> : null}
          {facility.egrid_subregion ? <Chip label={facility.egrid_subregion} size="small" variant="outlined" /> : null}
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{selectableActivities.length} activities
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <Box sx={{ width: "100%" }}>
          <DataGrid
            rows={gridRows}
            columns={columns}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={() => {}}
            onCellKeyDown={handleCellKeyDown}
            isCellEditable={(params) => !params.row._repeatable && ["activity_value", "activity_unit"].includes(params.field)}
            disableRowSelectionOnClick
            autoHeight
            density="compact"
            hideFooter
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

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
  show = () => {},
}) {
  const [viewMode, setViewMode] = React.useState("byActivity");
  const [detailDraftId, setDetailDraftId] = React.useState("");
  const [repeatableDialog, setRepeatableDialog] = React.useState(null);

  const selectableActivities = React.useMemo(
    () => activityCatalog.filter((activityType) => ["implemented", "partial"].includes(activityType.implementation_status)),
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

  const activityOptions = React.useMemo(
    () => selectableActivities.map((activityType) => ({ value: activityType.activity_type_id, label: activityType.label })),
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
          params: patch.params ? patch.params : draft.params,
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

  const saveDetailParams = (params) => {
    if (!detailDraftId) return;
    updateDraft(detailDraftId, { params });
    setDetailDraftId("");
  };

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
          Paste from spreadsheets in the By Activity and By Facility views with `Ctrl+V`, use `Tab` to move across, and use `Enter` to move down the next row in the same column.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Only catalog rows marked implemented or partial are available for calculation in this phase.
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
        />
      ) : null}

      {viewMode === "byActivity" ? (
        <BulkByActivityView
          activitiesByPair={activitiesByPair}
          facilities={facilities}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          show={show}
        />
      ) : null}

      {viewMode === "byFacility" ? (
        <BulkByFacilityView
          activitiesByPair={activitiesByPair}
          facilities={facilities}
          selectableActivities={selectableActivities}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
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
