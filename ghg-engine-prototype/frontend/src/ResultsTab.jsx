import * as React from "react";
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import CoverageWidget from "./CoverageWidget";

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Phase F2 PR 2 — Source Coverage moved from the Dashboard top to the
// Results tab. Dashboard reads as pure outcomes (charts + KPIs);
// coverage status sits adjacent to results, where the "what got
// included" framing is more natural and where future export
// configuration will live too.
export default function ResultsTab({
  resultRows,
  summaryRows,
  traceRows,
  onSaveResults,
  coverage = null,
  coverageSummaryText = "",
  activityLabelById = {},
  onJumpToActivityInputs = null,
}) {
  const resultColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Reporting Unit", flex: 1 },
      { field: "activity_label", headerName: "Activity", flex: 1 },
      { field: "scope", headerName: "Scope", flex: 0.6 },
      { field: "accounting_method", headerName: "Accounting", flex: 0.8 },
      { field: "gas", headerName: "Gas", flex: 0.4 },
      { field: "value", headerName: "Value", type: "number", flex: 0.7, valueFormatter: (value) => formatNumber(value) },
      { field: "unit", headerName: "Unit", flex: 0.4 },
    ],
    [],
  );

  const summaryColumns = React.useMemo(
    () => [
      { field: "key", headerName: "Key", flex: 1.5 },
      {
        field: "value",
        headerName: "Value (metric tons)",
        type: "number",
        flex: 0.5,
        valueFormatter: (value) => formatNumber(value),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <CoverageWidget
        coverage={coverage}
        activityLabelById={activityLabelById}
        summaryText={coverageSummaryText}
        onViewMissing={onJumpToActivityInputs ? () => onJumpToActivityInputs() : null}
      />
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Results</Typography>
          <Button variant="outlined" onClick={() => onSaveResults("Saved with calculated results.")}>
            Save Results Snapshot
          </Button>
        </Stack>
        <Box sx={{ height: 420 }}>
          <DataGrid rows={resultRows} columns={resultColumns} disableRowSelectionOnClick />
        </Box>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Summary Totals
        </Typography>
        <Box sx={{ height: 240 }}>
          <DataGrid rows={summaryRows} columns={summaryColumns} disableRowSelectionOnClick />
        </Box>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Trace
        </Typography>
        <Box sx={{ maxHeight: 220, overflow: "auto", background: "rgba(0,0,0,0.04)", borderRadius: 1, p: 1 }}>
          <pre style={{ margin: 0 }}>{JSON.stringify(traceRows, null, 2)}</pre>
        </Box>
      </Paper>
    </Stack>
  );
}
