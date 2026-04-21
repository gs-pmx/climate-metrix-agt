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
import { EMPTY_ACTIVITY, uid, unitOptionsForSource } from "./constants";
import { parseTSV } from "./usePasteHandler";

/* ------------------------------------------------------------------ */
/*  Clipboard paste handler for DataGrid                               */
/* ------------------------------------------------------------------ */

function makePasteHandler({ gridRows, columns, onPasteApply, show }) {
  return (params, event) => {
    if (!((event.ctrlKey || event.metaKey) && event.key === "v")) return;
    event.preventDefault();
    event.defaultMuiPrevented = true;

    navigator.clipboard.readText().then((text) => {
      const parsed = parseTSV(text);
      if (!parsed.length) return;

      const editableFields = columns.filter((c) => c.editable).map((c) => c.field);
      if (!editableFields.length) return;

      const rowIds = gridRows.map((r) => r.id);
      const startRowIdx = rowIds.indexOf(params.id);
      if (startRowIdx < 0) return;

      // If focused on a read-only column, start from the first editable column
      let startColIdx = editableFields.indexOf(params.field);
      if (startColIdx < 0) startColIdx = 0;

      const updates = [];
      for (let r = 0; r < parsed.length; r++) {
        const rowIdx = startRowIdx + r;
        if (rowIdx >= gridRows.length) break;
        const targetRow = { ...gridRows[rowIdx] };
        let changed = false;
        for (let c = 0; c < parsed[r].length; c++) {
          const colIdx = startColIdx + c;
          if (colIdx >= editableFields.length) break;
          const field = editableFields[colIdx];
          const cellValue = parsed[r][c];
          if (cellValue !== "") {
            targetRow[field] = cellValue;
            changed = true;
          }
        }
        if (changed) updates.push(targetRow);
      }

      if (updates.length) {
        onPasteApply(updates);
        show(`Pasted ${updates.length} row(s).`, "success");
      }
    }).catch(() => {
      show("Could not read clipboard. Check browser permissions.", "warning");
    });
  };
}

/* ------------------------------------------------------------------ */
/*  Row-by-Row View (port of existing code)                            */
/* ------------------------------------------------------------------ */

function RowByRowView({
  activities,
  routingById,
  facilityOptions,
  sourceOptions,
  updateActivityField,
  addActivity,
  removeActivity,
  routingError,
  routing,
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
        Multi-input travel rows collect MPG only when the selected EQM requires it.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Loaded sources from routing table: {routing.length}
      </Typography>
      {routingError ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          Failed to load routing sources: {routingError}
        </Alert>
      ) : null}
      <TableContainer sx={{ maxHeight: 520, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Facility</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Activity Value</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {activities.map((row) => {
              const src = routingById[row.source_id];
              const unitOptions = unitOptionsForSource(src);
              return (
                <TableRow key={row.id}>
                  <TableCell sx={{ minWidth: 210 }}>
                    <Select
                      size="small"
                      value={row.facility_id}
                      onChange={(e) => updateActivityField(row.id, "facility_id", e.target.value)}
                      fullWidth
                    >
                      {facilityOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 260 }}>
                    <Select
                      size="small"
                      value={row.source_id}
                      onChange={(e) => updateActivityField(row.id, "source_id", e.target.value)}
                      fullWidth
                    >
                      {sourceOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <TextField
                      size="small"
                      type="number"
                      value={row.activity_value}
                      onChange={(e) => updateActivityField(row.id, "activity_value", e.target.value)}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    <Select
                      size="small"
                      value={row.activity_unit}
                      onChange={(e) => updateActivityField(row.id, "activity_unit", e.target.value)}
                      fullWidth
                    >
                      {unitOptions.map((u) => (
                        <MenuItem key={u} value={u}>
                          {u}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Button color="error" size="small" onClick={() => removeActivity(row.id)}>
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

/* ------------------------------------------------------------------ */
/*  Helpers shared by bulk views                                       */
/* ------------------------------------------------------------------ */

function hydrateFromSource(src) {
  return {
    activity_type_id: src.activity_type_id || "",
    source_id: src.source_id || "",
    source_label: src.label || src.source_type,
    source_type: src.source_type,
    scope: src.scope,
    metric_group: src.metric_group,
    metric_subgroup: src.metric_subgroup || "",
    method_id: src.method_id || "",
  };
}

function defaultUnitForSource(src) {
  const units = unitOptionsForSource(src);
  return units[0] || src.default_unit || "";
}

function sourceNeedsMpg(source, unit) {
  return source?.method_id === "miles_to_fuel" && String(unit).toLowerCase().startsWith("mile");
}

/* ------------------------------------------------------------------ */
/*  By Source View                                                     */
/* ------------------------------------------------------------------ */

function BySourceView({ activities, setActivities, facilities, routing, show }) {
  const upsertActivity = React.useCallback(
    (facilityId, source, value, unit, mpg) => {
      setActivities((prev) => {
        const idx = prev.findIndex((a) => a.facility_id === facilityId && a.source_id === source.source_id);
        if (value === "" || value == null) {
          if (idx >= 0) return prev.filter((_, i) => i !== idx);
          return prev;
        }
        const base = {
          ...EMPTY_ACTIVITY,
          id: idx >= 0 ? prev[idx].id : uid(),
          facility_id: facilityId,
          source_id: source.source_id,
          ...hydrateFromSource(source),
          activity_value: value,
          activity_unit: unit || defaultUnitForSource(source),
        };
        if (mpg && sourceNeedsMpg(source, base.activity_unit)) {
          base.params = { mpg: Number(mpg), fuel_type: source.source_type };
        }
        if (idx >= 0) {
          return prev.map((r, i) => (i === idx ? { ...prev[idx], ...base } : r));
        }
        return [...prev, base];
      });
    },
    [setActivities],
  );

  return (
    <Stack spacing={1}>
      {routing.map((source) => (
        <SourceAccordion
          key={source.source_id}
          source={source}
          activities={activities}
          facilities={facilities}
          upsertActivity={upsertActivity}
          show={show}
        />
      ))}
    </Stack>
  );
}

function SourceAccordion({ source, activities, facilities, upsertActivity, show }) {
  const unitOptions = unitOptionsForSource(source);
  const [sectionUnit, setSectionUnit] = React.useState(unitOptions[0] || source.default_unit || "");
  const showMpg = sourceNeedsMpg(source, sectionUnit);

  const gridRows = React.useMemo(() => {
    return facilities.map((fac) => {
      const existing = activities.find(
        (a) => a.facility_id === fac.id && a.source_id === source.source_id,
      );
      return {
        id: `${source.source_id}__${fac.id}`,
        facility_id: fac.id,
        facility_name: fac.facility_name || fac.id,
        activity_value: existing?.activity_value ?? "",
        activity_unit: existing?.activity_unit || sectionUnit,
        mpg: existing?.params?.mpg ?? "",
      };
    });
  }, [facilities, activities, source.source_id, sectionUnit]);

  const filledCount = gridRows.filter((r) => r.activity_value !== "").length;

  const columns = React.useMemo(() => {
    const cols = [
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
    ];
    if (showMpg) {
      cols.push({
        field: "mpg",
        headerName: "MPG",
        flex: 0.4,
        editable: true,
        type: "number",
      });
    }
    return cols;
  }, [unitOptions, showMpg]);

  const processRowUpdate = React.useCallback(
    (newRow) => {
      upsertActivity(
        newRow.facility_id,
        source,
        newRow.activity_value === "" || newRow.activity_value == null ? "" : String(newRow.activity_value),
        newRow.activity_unit,
        newRow.mpg,
      );
      return newRow;
    },
    [upsertActivity, source],
  );

  // Keep a ref so the async paste handler always sees current rows
  const gridRowsRef = React.useRef(gridRows);
  gridRowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () =>
      makePasteHandler({
        get gridRows() { return gridRowsRef.current; },
        columns,
        onPasteApply: (updatedRows) => {
          for (const row of updatedRows) {
            upsertActivity(
              row.facility_id,
              source,
              row.activity_value === "" || row.activity_value == null ? "" : String(row.activity_value),
              row.activity_unit,
              row.mpg,
            );
          }
        },
        show,
      }),
    [columns, upsertActivity, source, show],
  );

  return (
    <Accordion defaultExpanded={facilities.length <= 8}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {source.label}
          </Typography>
          <Chip label={source.scope} size="small" variant="outlined" />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{facilities.length} facilities
          </Typography>
          <Select
            size="small"
            value={sectionUnit}
            onChange={(e) => {
              e.stopPropagation();
              setSectionUnit(e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            sx={{ minWidth: 120 }}
          >
            {unitOptions.map((u) => (
              <MenuItem key={u} value={u}>
                {u}
              </MenuItem>
            ))}
          </Select>
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
            disableRowSelectionOnClick
            autoHeight
            hideFooter={facilities.length <= 25}
            density="compact"
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

/* ------------------------------------------------------------------ */
/*  By Facility View                                                   */
/* ------------------------------------------------------------------ */

function ByFacilityView({ activities, setActivities, facilities, routing, show }) {
  const upsertActivity = React.useCallback(
    (facilityId, source, value, unit, mpg) => {
      setActivities((prev) => {
        const idx = prev.findIndex((a) => a.facility_id === facilityId && a.source_id === source.source_id);
        if (value === "" || value == null) {
          if (idx >= 0) return prev.filter((_, i) => i !== idx);
          return prev;
        }
        const base = {
          ...EMPTY_ACTIVITY,
          id: idx >= 0 ? prev[idx].id : uid(),
          facility_id: facilityId,
          source_id: source.source_id,
          ...hydrateFromSource(source),
          activity_value: value,
          activity_unit: unit || defaultUnitForSource(source),
        };
        if (mpg && sourceNeedsMpg(source, base.activity_unit)) {
          base.params = { mpg: Number(mpg), fuel_type: source.source_type };
        }
        if (idx >= 0) {
          return prev.map((r, i) => (i === idx ? { ...prev[idx], ...base } : r));
        }
        return [...prev, base];
      });
    },
    [setActivities],
  );

  return (
    <Stack spacing={1}>
      {facilities.map((facility) => (
        <FacilityAccordion
          key={facility.id}
          facility={facility}
          activities={activities}
          routing={routing}
          upsertActivity={upsertActivity}
          show={show}
        />
      ))}
    </Stack>
  );
}

function FacilityAccordion({ facility, activities, routing, upsertActivity, show }) {
  const gridRows = React.useMemo(() => {
    return routing.map((source) => {
      const existing = activities.find(
        (a) => a.facility_id === facility.id && a.source_id === source.source_id,
      );
      const unitOptions = unitOptionsForSource(source);
      return {
        id: `${facility.id}__${source.source_id}`,
        source_id: source.source_id,
        source_label: source.label,
        scope: source.scope,
        source_type: source.source_type,
        method_id: source.method_id || "",
        activity_value: existing?.activity_value ?? "",
        activity_unit: existing?.activity_unit || unitOptions[0] || source.default_unit || "",
        mpg: existing?.params?.mpg ?? "",
        _unitOptions: unitOptions,
      };
    });
  }, [routing, activities, facility.id]);

  const filledCount = gridRows.filter((r) => r.activity_value !== "").length;

  const columns = React.useMemo(
    () => [
      { field: "source_label", headerName: "Source", flex: 1, editable: false },
      { field: "scope", headerName: "Scope", flex: 0.5, editable: false },
      { field: "activity_value", headerName: "Activity Value", flex: 0.8, editable: true, type: "number" },
      {
        field: "activity_unit",
        headerName: "Unit",
        flex: 0.6,
        editable: true,
        type: "singleSelect",
        valueOptions: ({ row }) => row?._unitOptions || [],
      },
      {
        field: "mpg",
        headerName: "MPG",
        flex: 0.4,
        editable: true,
        type: "number",
        valueGetter: (_, row) => (row?.method_id === "miles_to_fuel" ? row.mpg : ""),
      },
    ],
    [],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      const source = routing.find((r) => r.source_id === newRow.source_id);
      if (!source) return newRow;
      upsertActivity(
        facility.id,
        source,
        newRow.activity_value === "" || newRow.activity_value == null ? "" : String(newRow.activity_value),
        newRow.activity_unit,
        newRow.mpg,
      );
      return newRow;
    },
    [upsertActivity, facility.id, routing],
  );

  const gridRowsRef = React.useRef(gridRows);
  gridRowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () =>
      makePasteHandler({
        get gridRows() { return gridRowsRef.current; },
        columns,
        onPasteApply: (updatedRows) => {
          for (const row of updatedRows) {
            const source = routing.find((r) => r.source_id === row.source_id);
            if (!source) continue;
            upsertActivity(
              facility.id,
              source,
              row.activity_value === "" || row.activity_value == null ? "" : String(row.activity_value),
              row.activity_unit,
              row.mpg,
            );
          }
        },
        show,
      }),
    [columns, upsertActivity, facility.id, routing, show],
  );

  return (
    <Accordion defaultExpanded={routing.length <= 10}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {facility.facility_name || facility.id}
          </Typography>
          {facility.state && <Chip label={facility.state} size="small" variant="outlined" />}
          {facility.egrid_subregion && (
            <Chip label={facility.egrid_subregion} size="small" variant="outlined" />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{routing.length} sources
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
            isCellEditable={(params) => params.field !== "mpg" || params.row.method_id === "miles_to_fuel"}
            disableRowSelectionOnClick
            autoHeight
            hideFooter
            density="compact"
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Panel                                                         */
/* ------------------------------------------------------------------ */

export default function ActivityInputsPanel({
  activities,
  setActivities,
  facilities,
  routing,
  routingById,
  facilityOptions,
  sourceOptions,
  inventoryYear,
  setInventoryYear,
  gwpSet,
  setGwpSet,
  includeTrace,
  setIncludeTrace,
  runCalculation,
  calculating,
  saveCurrentVersion,
  routingError,
  show,
}) {
  const [viewMode, setViewMode] = React.useState("bySource");

  const addActivity = () => setActivities((prev) => [...prev, { ...EMPTY_ACTIVITY, id: uid() }]);
  const removeActivity = (id) => setActivities((prev) => prev.filter((r) => r.id !== id));

  const hydrateActivityFromSource = (row) => {
    const src = routingById[row.source_id];
    if (!src) return row;
    const units = unitOptionsForSource(src);
    return {
      ...row,
      activity_type_id: src.activity_type_id || row.activity_type_id || "",
      source_id: src.source_id || row.source_id || "",
      source_label: src.label || src.source_type,
      source_type: src.source_type,
      scope: src.scope,
      metric_group: src.metric_group,
      metric_subgroup: src.metric_subgroup || "",
      method_id: src.method_id || row.method_id || "",
      activity_unit: units.includes(row.activity_unit) ? row.activity_unit : units[0] || row.activity_unit,
    };
  };

  const maybeCollectEqmParams = (row) => {
    if (row.method_id !== "miles_to_fuel") return row;
    const existingMpg = row.params?.mpg;
    if (existingMpg && Number(existingMpg) > 0) return row;
    const mpgInput = window.prompt(
      `Source "${row.source_label}" entered in miles requires mpg. Enter mpg value:`,
      "25",
    );
    const mpg = Number(mpgInput);
    if (!Number.isFinite(mpg) || mpg <= 0) {
      throw new Error("Miles-based fuel activity requires positive mpg.");
    }
    return { ...row, params: { ...(row.params || {}), mpg, fuel_type: row.source_type } };
  };

  const processActivityUpdate = async (newRow) => {
    let row = newRow;
    if (row.source_id) row = hydrateActivityFromSource(row);
    try {
      row = maybeCollectEqmParams(row);
    } catch (err) {
      show(String(err.message || err), "error");
      return newRow;
    }
    setActivities((prev) => prev.map((r) => (r.id === row.id ? row : r)));
    return row;
  };

  const updateActivityField = async (id, field, value) => {
    const row = activities.find((r) => r.id === id);
    if (!row) return;
    return processActivityUpdate({ ...row, [field]: value });
  };

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="center">
          <TextField
            label="Inventory Year"
            value={inventoryYear}
            onChange={(e) => setInventoryYear(e.target.value)}
            sx={{ width: 150 }}
          />
          <Select value={gwpSet} onChange={(e) => setGwpSet(e.target.value)} sx={{ width: 150 }}>
            <MenuItem value="AR6">AR6</MenuItem>
            <MenuItem value="AR5">AR5</MenuItem>
          </Select>
          <Select
            value={String(includeTrace)}
            onChange={(e) => setIncludeTrace(e.target.value === "true")}
            sx={{ width: 170 }}
          >
            <MenuItem value="true">Include Trace</MenuItem>
            <MenuItem value="false">No Trace</MenuItem>
          </Select>
          <Typography variant="body2" color="text.secondary">
            Source geo context is pulled from each facility row.
          </Typography>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => {
              if (v) setViewMode(v);
            }}
            size="small"
          >
            <ToggleButton value="rowByRow">Row-by-Row</ToggleButton>
            <ToggleButton value="bySource">By Source</ToggleButton>
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
        {viewMode !== "rowByRow" && (
          <Typography variant="body2" color="text.secondary">
            Click a cell then Ctrl+V to paste tabular data from a spreadsheet. Values fill down from the selected cell.
          </Typography>
        )}
      </Paper>

      {viewMode === "rowByRow" && (
        <RowByRowView
          activities={activities}
          routingById={routingById}
          facilityOptions={facilityOptions}
          sourceOptions={sourceOptions}
          updateActivityField={updateActivityField}
          addActivity={addActivity}
          removeActivity={removeActivity}
          routingError={routingError}
          routing={routing}
        />
      )}

      {viewMode === "bySource" && (
        <BySourceView
          activities={activities}
          setActivities={setActivities}
          facilities={facilities}
          routing={routing}
          show={show}
        />
      )}

      {viewMode === "byFacility" && (
        <ByFacilityView
          activities={activities}
          setActivities={setActivities}
          facilities={facilities}
          routing={routing}
          show={show}
        />
      )}
    </Stack>
  );
}
