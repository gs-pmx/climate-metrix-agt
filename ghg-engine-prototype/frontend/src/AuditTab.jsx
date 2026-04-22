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

function wrapText(value, maxChars = 30) {
  const text = String(value ?? "");
  if (!text) return "";
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + (line ? " " : "") + word).length <= maxChars) {
      line = line ? `${line} ${word}` : word;
      continue;
    }
    if (line) lines.push(line);
    if (word.length <= maxChars) {
      line = word;
    } else {
      const chunks = word.match(new RegExp(`.{1,${maxChars}}`, "g")) || [word];
      lines.push(...chunks.slice(0, -1));
      line = chunks[chunks.length - 1];
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export default function AuditTab({ auditRows, onExportAuditCsv }) {
  const renderWrappedCell = React.useCallback(
    (params) => (
      <Box
        title={String(params.value ?? "")}
        sx={{
          whiteSpace: "pre-wrap",
          lineHeight: 1.25,
          maxWidth: "30ch",
          overflowWrap: "anywhere",
          py: 0.5,
        }}
      >
        {wrapText(params.value, 30)}
      </Box>
    ),
    [],
  );

  const columns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Facility", flex: 0.85, renderCell: renderWrappedCell },
      { field: "activity_label", headerName: "Activity", flex: 1.1, renderCell: renderWrappedCell },
      { field: "scope", headerName: "Scope", flex: 0.55, renderCell: renderWrappedCell },
      { field: "accounting_method", headerName: "Accounting", flex: 0.7, renderCell: renderWrappedCell },
      {
        field: "input_activity_value",
        headerName: "Input Value",
        type: "number",
        flex: 0.65,
        valueFormatter: (value) => formatNumber(value),
      },
      { field: "input_activity_unit", headerName: "Input Unit", flex: 0.65, renderCell: renderWrappedCell },
      { field: "eqm_method", headerName: "EQM", flex: 0.65, renderCell: renderWrappedCell },
      { field: "factor_co2_id", headerName: "CO2 Factor ID", flex: 0.85, renderCell: renderWrappedCell },
      { field: "factor_co2_value", headerName: "CO2 Factor", type: "number", flex: 0.65, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_co2_unit", headerName: "CO2 Unit", flex: 0.7, renderCell: renderWrappedCell },
      {
        field: "factor_co2_mt",
        headerName: "CO2 Factor (MT)",
        type: "number",
        flex: 0.75,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_co2_mt_unit",
        headerName: "CO2 Factor MT Unit",
        flex: 0.85,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_co2_source", headerName: "CO2 Source", flex: 0.75, renderCell: renderWrappedCell },
      { field: "factor_ch4_id", headerName: "CH4 Factor ID", flex: 0.85, renderCell: renderWrappedCell },
      { field: "factor_ch4_value", headerName: "CH4 Factor", type: "number", flex: 0.65, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_ch4_unit", headerName: "CH4 Unit", flex: 0.7, renderCell: renderWrappedCell },
      {
        field: "factor_ch4_mt",
        headerName: "CH4 Factor (MT)",
        type: "number",
        flex: 0.75,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_ch4_mt_unit",
        headerName: "CH4 Factor MT Unit",
        flex: 0.85,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_ch4_source", headerName: "CH4 Source", flex: 0.75, renderCell: renderWrappedCell },
      { field: "factor_n2o_id", headerName: "N2O Factor ID", flex: 0.85, renderCell: renderWrappedCell },
      { field: "factor_n2o_value", headerName: "N2O Factor", type: "number", flex: 0.65, valueFormatter: (value) => formatNumber(value) },
      { field: "factor_n2o_unit", headerName: "N2O Unit", flex: 0.7, renderCell: renderWrappedCell },
      {
        field: "factor_n2o_mt",
        headerName: "N2O Factor (MT)",
        type: "number",
        flex: 0.75,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).value,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "factor_n2o_mt_unit",
        headerName: "N2O Factor MT Unit",
        flex: 0.85,
        valueGetter: (_, row) => toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).unit,
        renderCell: renderWrappedCell,
      },
      { field: "factor_n2o_source", headerName: "N2O Source", flex: 0.75, renderCell: renderWrappedCell },
      {
        field: "co2_result_kg",
        headerName: "CO2 mt",
        type: "number",
        flex: 0.55,
        valueGetter: (_, row) => toMetricTons(row.co2_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "ch4_result_kg",
        headerName: "CH4 mt",
        type: "number",
        flex: 0.55,
        valueGetter: (_, row) => toMetricTons(row.ch4_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "n2o_result_kg",
        headerName: "N2O mt",
        type: "number",
        flex: 0.55,
        valueGetter: (_, row) => toMetricTons(row.n2o_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "co2e_result_kg",
        headerName: "CO2e mt",
        type: "number",
        flex: 0.6,
        valueGetter: (_, row) => toMetricTons(row.co2e_result_kg, "kg"),
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "activity_conversion_notes",
        headerName: "Activity Conversions",
        flex: 1.2,
        valueGetter: (_, row) => (Array.isArray(row.activity_conversion_notes) ? row.activity_conversion_notes.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
      {
        field: "factor_conversion_notes",
        headerName: "Factor Conversions",
        flex: 1.2,
        valueGetter: (_, row) => (Array.isArray(row.factor_conversion_notes) ? row.factor_conversion_notes.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
      {
        field: "eqm_steps",
        headerName: "EQM Steps",
        flex: 1.25,
        valueGetter: (_, row) => (Array.isArray(row.eqm_steps) ? row.eqm_steps.join("; ") : ""),
        renderCell: renderWrappedCell,
      },
    ],
    [renderWrappedCell],
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
        Linear audit rows by facility and source with inputs, selected factors, conversions, and gas-level outputs.
      </Typography>
      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={auditRows}
          columns={columns}
          getRowHeight={() => "auto"}
          sx={{
            "& .MuiDataGrid-cell": {
              alignItems: "flex-start",
              py: 0.4,
            },
          }}
          disableRowSelectionOnClick
        />
      </Box>
    </Paper>
  );
}
