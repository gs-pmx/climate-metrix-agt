import * as React from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TuneIcon from "@mui/icons-material/Tune";
import { DataGrid, useGridApiContext } from "@mui/x-data-grid";
import ConfigureSourcesDialog from "./ConfigureSourcesDialog";
import { buildExistingPairsSet, computeReportingUnitProgress } from "./applicability";
import { isEntryVisibleActivity } from "./activityDrafts";
import { parseTSV } from "./usePasteHandler";
import { countActivitiesWithDataForUnit } from "./reportingUnits";

const US_STATE_OPTIONS = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "District of Columbia",
];

const EGRID_SUBREGION_OPTIONS = [
  "AKGD",
  "AKMS",
  "AZNM",
  "CAMX",
  "ERCT",
  "FRCC",
  "HIMS",
  "HIOA",
  "MROE",
  "MROW",
  "NEWE",
  "NWPP",
  "NYCW",
  "NYLI",
  "NYUP",
  "RFCE",
  "RFCM",
  "RFCW",
  "RMPA",
  "SPNO",
  "SPSO",
  "SRMV",
  "SRMW",
  "SRSO",
  "SRTV",
  "SRVC",
];

const RU_EDITABLE_FIELDS = [
  "facility_name",
  "location",
  "region",
  "country",
  "state",
  "egrid_subregion",
  "reporting_group",
  "owned_leased",
];

function GridAutocompleteEditCell(props) {
  const { id, field, value, hasFocus, options, normalizeValue } = props;
  const apiRef = useGridApiContext();
  const inputRef = React.useRef(null);
  const safeValue = typeof value === "string" ? value : "";

  React.useEffect(() => {
    if (hasFocus) {
      inputRef.current?.focus();
    }
  }, [hasFocus]);

  const toCellValue = React.useCallback(
    (nextRawValue) => {
      const normalized = normalizeValue ? normalizeValue(nextRawValue) : nextRawValue;
      apiRef.current.setEditCellValue({ id, field, value: normalized });
    },
    [apiRef, field, id, normalizeValue],
  );

  return (
    <Autocomplete
      freeSolo
      fullWidth
      options={options}
      value={safeValue}
      inputValue={safeValue}
      autoHighlight
      blurOnSelect
      selectOnFocus
      clearOnBlur={false}
      filterOptions={(opts, state) =>
        opts.filter((opt) => opt.toLowerCase().startsWith(state.inputValue.toLowerCase()))
      }
      onChange={(_, nextValue) => {
        const raw = typeof nextValue === "string" ? nextValue : nextValue || "";
        toCellValue(raw);
      }}
      onInputChange={(_, nextInputValue, reason) => {
        if (reason === "reset") return;
        toCellValue(nextInputValue);
      }}
      renderInput={(params) => <TextField {...params} variant="standard" inputRef={inputRef} />}
    />
  );
}

// Reporting Unit card showing progress chips and the "+ Configure sources"
// affordance. Highlighted with an onboarding accent when the unit is
// newly-created this session and has no applicable_activity_types yet.
//
// The trash-icon button on the right edge opens a confirmation dialog
// owned by the parent tab — destructive and irreversible (until the next
// snapshot save reflects the deletion), so the parent can mention the
// concrete count of activities that would be discarded.
function ReportingUnitCard({
  reportingUnit,
  activityCatalog,
  activities,
  onConfigureSources,
  onRequestDelete,
  isNewlyCreated,
}) {
  const progress = React.useMemo(
    () => computeReportingUnitProgress({
      reportingUnit,
      activityCatalog,
      activities,
    }),
    [activities, activityCatalog, reportingUnit],
  );
  const needsOnboarding = isNewlyCreated && (reportingUnit.applicable_activity_types || []).length === 0;
  const displayName = reportingUnit.facility_name?.trim() || "Untitled Reporting Unit";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderColor: needsOnboarding ? "warning.main" : "divider",
        borderWidth: needsOnboarding ? 2 : 1,
        bgcolor: needsOnboarding ? "action.hover" : "background.paper",
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
            {displayName}
          </Typography>
          {reportingUnit.state ? <Chip label={reportingUnit.state} size="small" variant="outlined" /> : null}
          {reportingUnit.egrid_subregion ? <Chip label={reportingUnit.egrid_subregion} size="small" variant="outlined" /> : null}
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center">
          <Chip
            size="small"
            variant="outlined"
            label={progress.legacyPermissive ? "All sources (legacy)" : `${progress.selected} selected`}
          />
          <Chip size="small" variant="outlined" label={`${progress.withData} with data`} />
          <Chip size="small" variant="outlined" label={`${progress.complete} complete`} />
        </Stack>

        <Tooltip title={needsOnboarding ? "Configure sources to begin" : "Configure which activity types apply to this Reporting Unit."}>
          <Button
            size="small"
            variant={needsOnboarding ? "contained" : "outlined"}
            color={needsOnboarding ? "warning" : "primary"}
            startIcon={<TuneIcon />}
            onClick={() => onConfigureSources(reportingUnit.id)}
          >
            Configure sources
          </Button>
        </Tooltip>

        {/*
          Delete affordance on the far right — small icon button rather
          than a full Button so it doesn't compete with "Configure
          sources" for attention. Confirmation lives in the parent so
          we don't fire a destructive action straight from the click.
        */}
        <Tooltip title="Delete this Reporting Unit">
          <span>
            <IconButton
              size="small"
              aria-label={`Delete Reporting Unit ${displayName}`}
              onClick={() => onRequestDelete(reportingUnit.id)}
              data-testid={`delete-reporting-unit-${reportingUnit.id}`}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {needsOnboarding ? (
        <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
          Configure sources to begin.
        </Typography>
      ) : null}
    </Paper>
  );
}

// Confirmation dialog for delete. We surface:
//   1. The unit's display name in the body so users can't misclick.
//   2. A list of what gets removed (activity data, source config).
//   3. An italic disclaimer that the action is destructive until the
//      next snapshot save reflects the deletion.
//   4. A pointed warning if the unit has any draft data attached.
// Cancel is the default; Delete is `color="error"` and explicitly NOT
// the default.
function DeleteReportingUnitDialog({
  open,
  reportingUnit,
  draftDataCount,
  onCancel,
  onConfirm,
}) {
  const displayName = reportingUnit?.facility_name?.trim() || "Untitled Reporting Unit";
  return (
    <Dialog open={Boolean(open)} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Delete this Reporting Unit?</DialogTitle>
      <DialogContent dividers>
        <DialogContentText component="div">
          <Typography paragraph>
            <strong>{displayName}</strong> and the following will be removed:
          </Typography>
          <ul style={{ marginTop: 0 }}>
            <li>All activity data entered for this unit</li>
            <li>The unit&apos;s source configuration (applicable activity types)</li>
          </ul>
          {draftDataCount > 0 ? (
            <Typography sx={{ mt: 1, fontWeight: 600, color: "warning.dark" }}>
              This unit has {draftDataCount} {draftDataCount === 1 ? "activity" : "activities"} with data — they will all be deleted.
            </Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: "italic" }}>
            This action cannot be undone from the Configure Sources dialog. The next snapshot you save will reflect the deletion.
          </Typography>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ReportingUnitsTab({
  reportingUnits,
  setReportingUnits,
  onAddReportingUnit,
  onRemoveReportingUnit,
  activityCatalog = [],
  activities = [],
  newlyCreatedIds,
}) {
  const [configureUnitId, setConfigureUnitId] = React.useState("");
  const [pendingDeleteId, setPendingDeleteId] = React.useState("");
  const configureUnit = reportingUnits.find((ru) => ru.id === configureUnitId) || null;
  const pendingDeleteUnit = pendingDeleteId
    ? reportingUnits.find((ru) => ru.id === pendingDeleteId) || null
    : null;
  const pendingDeleteDataCount = React.useMemo(
    () => (pendingDeleteId ? countActivitiesWithDataForUnit(activities, pendingDeleteId) : 0),
    [activities, pendingDeleteId],
  );

  const handleRequestDelete = React.useCallback((id) => {
    setPendingDeleteId(id);
  }, []);

  const handleCancelDelete = React.useCallback(() => {
    setPendingDeleteId("");
  }, []);

  const handleConfirmDelete = React.useCallback(() => {
    if (pendingDeleteId && typeof onRemoveReportingUnit === "function") {
      // Close the Configure Sources dialog if it happens to point at the
      // unit we're about to remove — otherwise it'd render with a null
      // reportingUnit on the next frame.
      if (configureUnitId === pendingDeleteId) {
        setConfigureUnitId("");
      }
      onRemoveReportingUnit(pendingDeleteId);
    }
    setPendingDeleteId("");
  }, [configureUnitId, onRemoveReportingUnit, pendingDeleteId]);

  // Deferred activity types are omitted from the checklist — showing them
  // would invite users to apply types they cannot actually calculate with.
  // Progress numbers also use this filtered list so "total" matches what
  // the By Reporting Unit grid will render.
  const selectableActivities = React.useMemo(
    () => (activityCatalog || []).filter((at) => isEntryVisibleActivity(at)),
    [activityCatalog],
  );

  const existingPairsSet = React.useMemo(() => buildExistingPairsSet(activities), [activities]);

  const handleSaveConfigureSources = React.useCallback(
    (newApplicableList) => {
      if (!configureUnitId) return;
      setReportingUnits((prev) => prev.map((ru) => (
        ru.id === configureUnitId
          ? { ...ru, applicable_activity_types: newApplicableList }
          : ru
      )));
      setConfigureUnitId("");
    },
    [configureUnitId, setReportingUnits],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      setReportingUnits((prev) => prev.map((row) => (row.id === newRow.id ? newRow : row)));
      return newRow;
    },
    [setReportingUnits],
  );

  // Paste + Tab navigation — unchanged from the legacy Facilities grid.
  const handleCellKeyDown = React.useCallback(
    (params, event) => {
      const key = String(event.key || "");

      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "v") {
        event.preventDefault();
        event.defaultMuiPrevented = true;

        navigator.clipboard.readText().then((text) => {
          const parsed = parseTSV(text);
          if (!parsed.length) return;

          const rowIds =
            typeof params.api.getSortedRowIds === "function"
              ? params.api.getSortedRowIds()
              : reportingUnits.map((ru) => ru.id);
          const startRowIndex = rowIds.indexOf(params.id);
          if (startRowIndex < 0) return;

          let startColumnIndex = RU_EDITABLE_FIELDS.indexOf(params.field);
          if (startColumnIndex < 0) startColumnIndex = 0;

          setReportingUnits((prev) => {
            const byId = new Map(prev.map((row) => [row.id, row]));
            let touched = 0;
            for (let rowOffset = 0; rowOffset < parsed.length; rowOffset += 1) {
              const rowIndex = startRowIndex + rowOffset;
              if (rowIndex >= rowIds.length) break;
              const rowId = rowIds[rowIndex];
              const current = byId.get(rowId);
              if (!current) continue;
              const next = { ...current };
              let changed = false;
              for (let columnOffset = 0; columnOffset < parsed[rowOffset].length; columnOffset += 1) {
                const columnIndex = startColumnIndex + columnOffset;
                if (columnIndex >= RU_EDITABLE_FIELDS.length) break;
                const field = RU_EDITABLE_FIELDS[columnIndex];
                const cellValue = parsed[rowOffset][columnOffset];
                if (cellValue === "") continue;
                next[field] = cellValue;
                changed = true;
              }
              if (changed) {
                byId.set(rowId, next);
                touched += 1;
              }
            }
            if (touched === 0) return prev;
            return prev.map((row) => byId.get(row.id) || row);
          });
        }).catch(() => { /* clipboard may be denied — silently ignore */ });
        return;
      }

      let direction = null;
      if (key === "Tab") direction = event.shiftKey ? "left" : "right";
      else if (key === "Enter") direction = event.shiftKey ? "up" : "down";
      else if (key === "ArrowUp" && params.cellMode === "edit") direction = "up";
      else if (key === "ArrowDown" && params.cellMode === "edit") direction = "down";
      if (!direction) return;

      const rowIds =
        typeof params.api.getSortedRowIds === "function"
          ? params.api.getSortedRowIds()
          : reportingUnits.map((ru) => ru.id);
      const rowIndex = rowIds.findIndex((rowId) => rowId === params.id);
      const fieldIndex = RU_EDITABLE_FIELDS.indexOf(params.field);
      if (rowIndex < 0 || fieldIndex < 0) return;

      let nextRowIndex = rowIndex;
      let nextFieldIndex = fieldIndex;
      switch (direction) {
        case "up": nextRowIndex -= 1; break;
        case "down": nextRowIndex += 1; break;
        case "left":
          if (fieldIndex === 0) {
            nextRowIndex -= 1;
            nextFieldIndex = RU_EDITABLE_FIELDS.length - 1;
          } else {
            nextFieldIndex -= 1;
          }
          break;
        case "right":
          if (fieldIndex === RU_EDITABLE_FIELDS.length - 1) {
            nextRowIndex += 1;
            nextFieldIndex = 0;
          } else {
            nextFieldIndex += 1;
          }
          break;
        default: break;
      }

      const nextRowId = rowIds[nextRowIndex];
      const nextField = RU_EDITABLE_FIELDS[nextFieldIndex];
      if (nextRowId === undefined || !nextField) return;

      event.preventDefault();
      event.defaultMuiPrevented = true;

      if (params.cellMode === "edit") {
        params.api.stopCellEditMode({ id: params.id, field: params.field });
      }
      params.api.setCellFocus(nextRowId, nextField);
      params.api.startCellEditMode({ id: nextRowId, field: nextField });
    },
    [reportingUnits, setReportingUnits],
  );

  const columns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Reporting Unit Name", flex: 1, minWidth: 180, editable: true },
      { field: "location", headerName: "Location", flex: 1, minWidth: 160, editable: true },
      { field: "region", headerName: "Region", flex: 0.7, minWidth: 120, editable: true },
      { field: "country", headerName: "Country", flex: 0.6, minWidth: 100, editable: true },
      {
        field: "state",
        headerName: "State",
        flex: 0.6,
        minWidth: 130,
        editable: true,
        renderEditCell: (params) => <GridAutocompleteEditCell {...params} options={US_STATE_OPTIONS} />,
      },
      {
        field: "egrid_subregion",
        headerName: "eGRID Subregion",
        flex: 0.8,
        minWidth: 150,
        editable: true,
        renderEditCell: (params) => (
          <GridAutocompleteEditCell
            {...params}
            options={EGRID_SUBREGION_OPTIONS}
            normalizeValue={(value) => String(value || "").toUpperCase()}
          />
        ),
      },
      { field: "reporting_group", headerName: "Group", flex: 0.6, minWidth: 120, editable: true },
      {
        field: "owned_leased",
        headerName: "Owned/Leased",
        flex: 0.7,
        minWidth: 130,
        editable: true,
        type: "singleSelect",
        valueOptions: ["Owned", "Leased"],
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Reporting Units</Typography>
          <Button variant="contained" onClick={onAddReportingUnit}>
            Add Reporting Unit
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Each Reporting Unit is a location, entity, or activity bucket you track. Configure the set of applicable activity types per unit to shape the data-entry grids.
        </Typography>
        <Stack spacing={1}>
          {reportingUnits.length === 0 ? (
            <Typography color="text.secondary">No Reporting Units yet. Add one above.</Typography>
          ) : reportingUnits.map((ru) => (
            <ReportingUnitCard
              key={ru.id}
              reportingUnit={ru}
              activityCatalog={selectableActivities}
              activities={activities}
              onConfigureSources={(id) => setConfigureUnitId(id)}
              onRequestDelete={handleRequestDelete}
              isNewlyCreated={Boolean(newlyCreatedIds && newlyCreatedIds.has(ru.id))}
            />
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">Reporting Unit Details (Geo Context)</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Paste a block of cells with Ctrl+V from a spreadsheet to fill multiple rows at once.
        </Typography>
        <Box sx={{ width: "100%", overflowX: "auto" }}>
          <Box sx={{ height: 420, minWidth: 1100 }}>
            <DataGrid
              rows={reportingUnits}
              columns={columns}
              processRowUpdate={processRowUpdate}
              onProcessRowUpdateError={() => {}}
              onCellKeyDown={handleCellKeyDown}
              disableRowSelectionOnClick
            />
          </Box>
        </Box>
      </Paper>

      <ConfigureSourcesDialog
        open={Boolean(configureUnit)}
        onClose={() => setConfigureUnitId("")}
        reportingUnit={configureUnit}
        activityCatalog={selectableActivities}
        existingActivitiesByPair={existingPairsSet}
        onSave={handleSaveConfigureSources}
      />

      <DeleteReportingUnitDialog
        open={Boolean(pendingDeleteUnit)}
        reportingUnit={pendingDeleteUnit}
        draftDataCount={pendingDeleteDataCount}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </Stack>
  );
}
