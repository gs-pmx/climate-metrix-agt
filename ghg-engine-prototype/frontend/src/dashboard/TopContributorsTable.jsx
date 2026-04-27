import * as React from "react";
import { Box, Typography } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { buildTopContributors } from "./analyticsState.js";

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

// Top-20 (Reporting Unit, Activity) pairs by CO2e. The user clicks a
// row to drill through to the Audit tab; the parent wires the click
// handler so this component stays presentation-only.
export default function TopContributorsTable({ rows = [], limit = 20, onJumpToAudit = null }) {
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
          if (!onJumpToAudit) return;
          onJumpToAudit({
            facility_id: params.row.facility_id,
            activity_type_id: params.row.activity_type_id,
          });
        }}
        sx={{
          "& .MuiDataGrid-row": { cursor: onJumpToAudit ? "pointer" : "default" },
        }}
      />
    </Box>
  );
}
