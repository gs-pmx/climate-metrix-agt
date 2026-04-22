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
  const handleFacilityCellKeyDown = React.useCallback(
    (params, event) => {
      if (event.key !== "Tab") return;

      const rowIds =
        typeof params.api.getSortedRowIds === "function"
          ? params.api.getSortedRowIds()
          : facilities.map((facility) => facility.id);
      const rowIndex = rowIds.findIndex((rowId) => rowId === params.id);
      const fieldIndex = FACILITY_EDITABLE_FIELDS.indexOf(params.field);
      if (rowIndex < 0 || fieldIndex < 0) return;

      const isShiftTab = event.shiftKey;
      const atFirstCell = rowIndex === 0 && fieldIndex === 0;
      const atLastCell = rowIndex === rowIds.length - 1 && fieldIndex === FACILITY_EDITABLE_FIELDS.length - 1;
      if ((isShiftTab && atFirstCell) || (!isShiftTab && atLastCell)) {
        return;
      }

      event.preventDefault();
      event.defaultMuiPrevented = true;

      let nextRowIndex = rowIndex;
      let nextFieldIndex = fieldIndex;

      if (isShiftTab) {
        if (fieldIndex === 0) {
          nextRowIndex -= 1;
          nextFieldIndex = FACILITY_EDITABLE_FIELDS.length - 1;
        } else {
          nextFieldIndex -= 1;
        }
      } else if (fieldIndex === FACILITY_EDITABLE_FIELDS.length - 1) {
        nextRowIndex += 1;
        nextFieldIndex = 0;
      } else {
        nextFieldIndex += 1;
      }

      const nextRowId = rowIds[nextRowIndex];
      const nextField = FACILITY_EDITABLE_FIELDS[nextFieldIndex];
      if (nextRowId === undefined || !nextField) return;

      if (params.cellMode === "edit") {
        params.api.stopCellEditMode({ id: params.id, field: params.field });
      }
      params.api.setCellFocus(nextRowId, nextField);
      params.api.startCellEditMode({ id: nextRowId, field: nextField });
    },
    [facilities],
  );

  const processFacilityUpdate = React.useCallback(
    (newRow) => {
      setFacilities((prev) => prev.map((row) => (row.id === newRow.id ? newRow : row)));
      return newRow;
    },
    [setFacilities],
  );

  const facilityColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Facility Name", flex: 1, editable: true },
      { field: "location", headerName: "Location", flex: 1, editable: true },
      { field: "region", headerName: "Region", flex: 0.7, editable: true },
      { field: "country", headerName: "Country", flex: 0.6, editable: true },
      {
        field: "state",
        headerName: "State",
        flex: 0.6,
        editable: true,
        renderEditCell: (params) => <GridAutocompleteEditCell {...params} options={US_STATE_OPTIONS} />,
      },
      {
        field: "egrid_subregion",
        headerName: "eGRID Subregion",
        flex: 0.8,
        editable: true,
        renderEditCell: (params) => (
          <GridAutocompleteEditCell
            {...params}
            options={EGRID_SUBREGION_OPTIONS}
            normalizeValue={(value) => String(value || "").toUpperCase()}
          />
        ),
      },
      { field: "reporting_group", headerName: "Group", flex: 0.6, editable: true },
      {
        field: "owned_leased",
        headerName: "Owned/Leased",
        flex: 0.7,
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
      <Box sx={{ height: 520 }}>
        <DataGrid
          rows={facilities}
          columns={facilityColumns}
          processRowUpdate={processFacilityUpdate}
          onProcessRowUpdateError={() => {}}
          onCellKeyDown={handleFacilityCellKeyDown}
          disableRowSelectionOnClick
        />
      </Box>
    </Paper>
  );
}
