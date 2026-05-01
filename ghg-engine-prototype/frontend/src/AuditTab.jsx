import * as React from "react";
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function toMetricTons(value, unit = "kg") {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalizedUnit = String(unit || "").toLowerCase().trim();
  if (normalizedUnit === "kg" || normalizedUnit === "kilogram" || normalizedUnit === "kilograms") return number / 1000;
  if (normalizedUnit === "g" || normalizedUnit === "gram" || normalizedUnit === "grams") return number / 1_000_000;
  if (normalizedUnit === "metric ton" || normalizedUnit === "metric tons" || normalizedUnit === "tonne" || normalizedUnit === "tonnes" || normalizedUnit === "t") return number;
  return number / 1000;
}

function toMetricTonFactor(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number) || !unit || !String(unit).includes("/")) return { value: null, unit: "" };
  const [numeratorRaw, denominatorRaw] = String(unit).split("/", 2).map((item) => item.trim());
  const numerator = numeratorRaw.toLowerCase();
  let metricTonValue = null;
  if (["kg", "kilogram", "kilograms"].includes(numerator)) metricTonValue = number / 1000;
  else if (["g", "gram", "grams"].includes(numerator)) metricTonValue = number / 1_000_000;
  else if (["metric ton", "metric tons", "tonne", "tonnes", "t"].includes(numerator)) metricTonValue = number;
  return {
    value: metricTonValue,
    unit: metricTonValue == null ? "" : `metric ton/${denominatorRaw}`,
  };
}

// Phase F2 PR 2 — Audit grid sizing.
//
// Pre-PR-2 every text column used ``flex`` and the grid was set to
// ``getRowHeight={() => "auto"}``. Combined with a custom 30-char
// ``wrapText`` helper that hand-inserted newlines, long content
// (factor IDs, conversion notes, EQM step traces) produced extremely
// tall rows that pushed neighbors off-screen. Per Stephen's backlog:
// "add width to the audit output columns, and limit the text wrap so
// we don't end up with completely illegible, super tall rows."
//
// Fix: explicit per-column ``width`` + a fixed row height + CSS
// ``line-clamp`` on text cells. Two lines of wrapped content fits
// comfortably in the row; longer values truncate with a tooltip
// surfacing the full string.
const ROW_HEIGHT = 64;
const TEXT_LINE_CLAMP = 2;

function WrappedTextCell({ value }) {
  const text = String(value ?? "");
  return (
    <Box
      title={text}
      sx={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: TEXT_LINE_CLAMP,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        lineHeight: 1.35,
        py: 0.5,
        width: "100%",
      }}
    >
      {text}
    </Box>
  );
}

const renderWrappedCell = (params) => <WrappedTextCell value={params.value} />;

export default function AuditTab({ auditRows, onExportAuditCsv }) {
  const columns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Reporting Unit", width: 160, renderCell: renderWrappedCell },
      { field: "activity_label", headerName: "Activity", width: 200, renderCell: renderWrappedCell },
      { field: "scope", headerName: "Scope", width: 90, renderCell: renderWrappedCell },
      { field: "accounting_method", headerName: "Accounting", width: 130, renderCell: renderWrappedCell },
      {
        field: "input_activity_value",
        headerName: "Input Value",
        type: "number",
        width: 110,
        valueFormatter: (value) => formatNumber(value),
      },
      { field: "input_activity_unit", headerName: "Input Unit", width: 110, renderCell: renderWrappedCell },
      { field: "eqm_method", headerName: "EQM", width: 130, renderCell: renderWrappedCell },
      { field: "factor_co2_id", headerName: "CO2 Factor ID", width: 180, renderCell: renderWrappedCell },
      { field: "factor_co2_value", headerName: "CO2 Factor", type: "number", width: 110, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_co2_unit", headerName: "CO2 Unit", width: 130, renderCell: renderWrappedCell },
      {
        field: "factor_co2_mt",
        headerName: "CO2 Factor (MT)",
        type: "number",
        width: 130,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_co2_mt_unit",
        headerName: "CO2 Factor MT Unit",
        width: 160,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_co2_source", headerName: "CO2 Source", width: 140, renderCell: renderWrappedCell },
      { field: "factor_ch4_id", headerName: "CH4 Factor ID", width: 180, renderCell: renderWrappedCell },
      { field: "factor_ch4_value", headerName: "CH4 Factor", type: "number", width: 110, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_ch4_unit", headerName: "CH4 Unit", width: 130, renderCell: renderWrappedCell },
      {
        field: "factor_ch4_mt",
        headerName: "CH4 Factor (MT)",
        type: "number",
        width: 130,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_ch4_mt_unit",
        headerName: "CH4 Factor MT Unit",
        width: 160,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_ch4_source", headerName: "CH4 Source", width: 140, renderCell: renderWrappedCell },
      { field: "factor_n2o_id", headerName: "N2O Factor ID", width: 180, renderCell: renderWrappedCell },
      { field: "factor_n2o_value", headerName: "N2O Factor", type: "number", width: 110, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_n2o_unit", headerName: "N2O Unit", width: 130, renderCell: renderWrappedCell },
      {
        field: "factor_n2o_mt",
        headerName: "N2O Factor (MT)",
        type: "number",
        width: 130,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_n2o_mt_unit",
        headerName: "N2O Factor MT Unit",
        width: 160,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_n2o_source", headerName: "N2O Source", width: 140, renderCell: renderWrappedCell },
      {
        field: "co2_result_kg",
        headerName: "CO2 mt",
        type: "number",
        width: 110,
        valueGetter: (_, row) => toMetricTons(row.co2_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "ch4_result_kg",
        headerName: "CH4 mt",
        type: "number",
        width: 110,
        valueGetter: (_, row) => toMetricTons(row.ch4_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "n2o_result_kg",
        headerName: "N2O mt",
        type: "number",
        width: 110,
        valueGetter: (_, row) => toMetricTons(row.n2o_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "co2e_result_kg",
        headerName: "CO2e mt",
        type: "number",
        width: 120,
        valueGetter: (_, row) => toMetricTons(row.co2e_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "activity_conversion_notes",
        headerName: "Activity Conversions",
        width: 240,
        valueGetter: (_, row) => (Array.isArray(row.activity_conversion_notes) ? row.activity_conversion_notes.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
      {
        field: "factor_conversion_notes",
        headerName: "Factor Conversions",
        width: 240,
        valueGetter: (_, row) => (Array.isArray(row.factor_conversion_notes) ? row.factor_conversion_notes.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
      {
        field: "eqm_steps",
        headerName: "EQM Steps",
        width: 240,
        valueGetter: (_, row) => (Array.isArray(row.eqm_steps) ? row.eqm_steps.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
    ],
    [],
  );

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Audit Pathway</Typography>
        <Button variant="outlined" onClick={onExportAuditCsv}>
          Export Audit CSV
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Linear audit rows by facility and source with inputs, selected factors, conversions, and gas-level outputs. Hover a clamped cell for the full value.
      </Typography>
      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={auditRows}
          columns={columns}
          // Fixed row height with line-clamp on text cells. The auto
          // height pre-PR-2 produced rows that grew to fit the longest
          // content in the row — a single trace string could push a
          // row to several hundred pixels. ``ROW_HEIGHT`` (64) fits
          // two lines of wrapped 14px text comfortably; longer values
          // ellipsize and reveal in tooltip.
          rowHeight={ROW_HEIGHT}
          disableRowSelectionOnClick
        />
      </Box>
    </Paper>
  );
}
