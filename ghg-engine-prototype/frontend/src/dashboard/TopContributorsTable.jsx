import * as React from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { DataGrid } from "@mui/x-data-grid";
import { buildTopContributors, matchesSelection } from "./analyticsState.js";

function formatMt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 10 ? 1 : 2,
    maximumFractionDigits: n >= 10 ? 1 : 2,
  });
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

// Top-20 (Reporting Unit, Activity) pairs by CO2e. Row click toggles
// the (facility, category) pair as the dashboard's active selection —
// the other charts cross-filter against it. Clicking the same row
// again clears the selection. The Audit tab is the auditor deliverable
// surface; this dashboard does not link there.
export default function TopContributorsTable({
  rows = [],
  limit = 20,
  onRowClick = null,
  selection = null,
}) {
  const theme = useTheme();
  const data = React.useMemo(() => buildTopContributors(rows, { limit }), [rows, limit]);
  // DataGrid needs a stable id per row.
  const tableRows = React.useMemo(
    () =>
      data.map((row) => ({
        id: row.key,
        facility_id: row.facility_id,
        facility_name: row.facility_name,
        activity_type_id: row.activity_type_id,
        activity_label: row.activity_label,
        scope: row.scope,
        category: row.category,
        valueMt: row.valueMt,
        sharePct: row.sharePct,
      })),
    [data],
  );

  const columns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Reporting Unit", flex: 1.0, minWidth: 160 },
      { field: "activity_label", headerName: "Activity", flex: 1.2, minWidth: 200 },
      { field: "scope", headerName: "Scope", flex: 0.5, minWidth: 110 },
      { field: "category", headerName: "Category", flex: 0.7, minWidth: 140 },
      {
        field: "valueMt",
        headerName: "MT CO2e",
        type: "number",
        flex: 0.55,
        minWidth: 120,
        valueFormatter: (value) => formatMt(value),
      },
      {
        field: "sharePct",
        headerName: "Share",
        type: "number",
        flex: 0.45,
        minWidth: 100,
        valueFormatter: (value) => formatPct(value),
      },
    ],
    [],
  );

  // Tag rows with a selection class so we can dim unmatched rows and
  // tint the matched ones. ``getRowClassName`` is the DataGrid hook;
  // it's called per row on every render so we keep the predicate
  // shallow.
  const getRowClassName = React.useCallback(
    (params) => {
      if (!selection) return "";
      return matchesSelection(params.row, selection)
        ? "ghg-selection-match"
        : "ghg-selection-rest";
    },
    [selection],
  );

  if (!tableRows.length) {
    return <Typography color="text.secondary">No contributors yet.</Typography>;
  }

  return (
    <Box sx={{ width: "100%" }}>
      <DataGrid
        rows={tableRows}
        columns={columns}
        autoHeight
        disableRowSelectionOnClick
        pageSizeOptions={[10, 25]}
        initialState={{
          sorting: { sortModel: [{ field: "valueMt", sort: "desc" }] },
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        onRowClick={(params) => {
          if (!onRowClick) return;
          onRowClick({
            facility_id: params.row.facility_id,
            activity_type_id: params.row.activity_type_id,
            category: params.row.category,
          });
        }}
        getRowClassName={getRowClassName}
        sx={{
          "& .MuiDataGrid-row": { cursor: onRowClick ? "pointer" : "default" },
          "& .ghg-selection-match": {
            backgroundColor: alpha(theme.palette.primary.main, 0.12),
          },
          "& .ghg-selection-match:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.18),
          },
          "& .ghg-selection-rest": {
            opacity: 0.6,
          },
        }}
      />
    </Box>
  );
}
