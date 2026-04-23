import * as React from "react";
import {
  Autocomplete,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid, useGridApiContext } from "@mui/x-data-grid";
import { parseTSV } from "./usePasteHandler";

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

const FACILITY_EDITABLE_FIELDS = [
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

export default function FacilitiesTab({ facilities, setFacilities, onAddFacility }) {
  const processFacilityUpdate = React.useCallback(
    (newRow) => {
      setFacilities((prev) => prev.map((row) => (row.id === newRow.id ? newRow : row)));
      return newRow;
    },
    [setFacilities],
  );

  // Paste + Tab navigation. Tab moves left/right, Enter moves down (same
  // column), ArrowUp/ArrowDown also navigate between rows while in edit mode.
  const handleFacilityCellKeyDown = React.useCallback(
    (params, event) => {
      const key = String(event.key || "");

      // Clipboard paste: accept spreadsheet-style multi-cell data.
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "v") {
        event.preventDefault();
        event.defaultMuiPrevented = true;

        navigator.clipboard.readText().then((text) => {
          const parsed = parseTSV(text);
          if (!parsed.length) return;

          const rowIds =
            typeof params.api.getSortedRowIds === "function"
              ? params.api.getSortedRowIds()
              : facilities.map((facility) => facility.id);
          const startRowIndex = rowIds.indexOf(params.id);
          if (startRowIndex < 0) return;

          let startColumnIndex = FACILITY_EDITABLE_FIELDS.indexOf(params.field);
          if (startColumnIndex < 0) startColumnIndex = 0;

          setFacilities((prev) => {
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
                if (columnIndex >= FACILITY_EDITABLE_FIELDS.length) break;
                const field = FACILITY_EDITABLE_FIELDS[columnIndex];
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
        }).catch(() => { /* clipboard may be denied — silently ignore here */ });
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
          : facilities.map((facility) => facility.id);
      const rowIndex = rowIds.findIndex((rowId) => rowId === params.id);
      const fieldIndex = FACILITY_EDITABLE_FIELDS.indexOf(params.field);
      if (rowIndex < 0 || fieldIndex < 0) return;

      let nextRowIndex = rowIndex;
      let nextFieldIndex = fieldIndex;
      switch (direction) {
        case "up": nextRowIndex -= 1; break;
        case "down": nextRowIndex += 1; break;
        case "left":
          if (fieldIndex === 0) {
            nextRowIndex -= 1;
            nextFieldIndex = FACILITY_EDITABLE_FIELDS.length - 1;
          } else {
            nextFieldIndex -= 1;
          }
          break;
        case "right":
          if (fieldIndex === FACILITY_EDITABLE_FIELDS.length - 1) {
            nextRowIndex += 1;
            nextFieldIndex = 0;
          } else {
            nextFieldIndex += 1;
          }
          break;
        default: break;
      }

      const nextRowId = rowIds[nextRowIndex];
      const nextField = FACILITY_EDITABLE_FIELDS[nextFieldIndex];
      if (nextRowId === undefined || !nextField) return;

      event.preventDefault();
      event.defaultMuiPrevented = true;

      if (params.cellMode === "edit") {
        params.api.stopCellEditMode({ id: params.id, field: params.field });
      }
      params.api.setCellFocus(nextRowId, nextField);
      params.api.startCellEditMode({ id: nextRowId, field: nextField });
    },
    [facilities, setFacilities],
  );

  const facilityColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Facility Name", flex: 1, minWidth: 160, editable: true },
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
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">Facilities (with Geo Context)</Typography>
        <Button variant="contained" onClick={onAddFacility}>
          Add Facility
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Paste a block of cells with Ctrl+V from a spreadsheet to fill multiple rows at once.
      </Typography>
      <Box sx={{ width: "100%", overflowX: "auto" }}>
        <Box sx={{ height: 520, minWidth: 1100 }}>
          <DataGrid
            rows={facilities}
            columns={facilityColumns}
            processRowUpdate={processFacilityUpdate}
            onProcessRowUpdateError={() => {}}
            onCellKeyDown={handleFacilityCellKeyDown}
            disableRowSelectionOnClick
          />
        </Box>
      </Box>
    </Paper>
  );
}
