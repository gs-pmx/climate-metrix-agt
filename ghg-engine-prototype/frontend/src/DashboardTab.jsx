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

const DATA_VIZ_COLORS = {
  categorical: [
    "#1f77b4",
    "#2ca02c",
    "#17becf",
    "#ff7f0e",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#d62728",
  ],
};

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
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

function SourceBarChart({ rows }) {
  if (!rows.length) {
    return <Typography color="text.secondary">No CO2e data available yet.</Typography>;
  }
  const width = Math.max(760, rows.length * 110);
  const height = 320;
  const padding = { top: 24, right: 24, bottom: 92, left: 80 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const barWidth = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Emissions by source bar chart">
        {ticks.map((tick) => {
          const y = height - padding.bottom - (tick / maxValue) * plotHeight;
          return (
            <g key={`tick-${tick}`}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity="0.14" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="currentColor">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="currentColor"
          strokeOpacity="0.35"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="currentColor"
          strokeOpacity="0.35"
        />
        {rows.map((row, index) => {
          const value = Number(row.value || 0);
          const heightValue = (value / maxValue) * plotHeight;
          const x = padding.left + index * barWidth + barWidth * 0.12;
          const y = height - padding.bottom - heightValue;
          const widthValue = barWidth * 0.76;
          const color = DATA_VIZ_COLORS.categorical[index % DATA_VIZ_COLORS.categorical.length];
          return (
            <g key={row.id}>
              <rect x={x} y={y} width={widthValue} height={heightValue} fill={color} rx="4">
                <title>{`${row.activity_label}: ${formatNumber(value)} MTCO2e`}</title>
              </rect>
              <text x={x + widthValue / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="currentColor">
                {formatNumber(value)}
              </text>
              <text x={x + widthValue / 2} y={height - padding.bottom + 14} textAnchor="middle" fontSize="10" fill="currentColor">
                {wrapText(row.activity_label, 12).split("\n")[0]}
              </text>
            </g>
          );
        })}
        <text x={padding.left + plotWidth / 2} y={height - 10} textAnchor="middle" fontSize="11" fill="currentColor">
          Source
        </text>
        <text
          x={18}
          y={padding.top + plotHeight / 2}
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
          transform={`rotate(-90 18 ${padding.top + plotHeight / 2})`}
        >
          Emissions (MTCO2e)
        </text>
      </svg>
    </Box>
  );
}

function ScopeDonutChart({ rows }) {
  if (!rows.length) {
    return <Typography color="text.secondary">No CO2e scope totals available yet.</Typography>;
  }
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const cx = 170;
  const cy = 170;
  const radius = 110;
  const strokeWidth = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
      <svg width="340" height="340" viewBox="0 0 340 340" role="img" aria-label="Emissions by scope donut chart">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth={strokeWidth} />
        {rows.map((row, index) => {
          const value = Number(row.value || 0);
          const fraction = total > 0 ? value / total : 0;
          const dash = fraction * circumference;
          const color = DATA_VIZ_COLORS.categorical[index % DATA_VIZ_COLORS.categorical.length];
          const segment = (
            <circle
              key={row.id}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{`${row.scope}: ${formatNumber(value)} MTCO2e`}</title>
            </circle>
          );
          offset += dash;
          return segment;
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="12" fill="currentColor">
          Total MTCO2e
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor">
          {formatNumber(total)}
        </text>
      </svg>
      <Stack spacing={0.5}>
        {rows.map((row, index) => (
          <Stack key={row.id} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: "2px", bgcolor: DATA_VIZ_COLORS.categorical[index % DATA_VIZ_COLORS.categorical.length] }} />
            <Typography variant="body2">
              {row.scope}: {formatNumber(row.value)} MTCO2e
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function FacilitySourceTreemap({ rows }) {
  if (!rows.length) {
    return <Typography color="text.secondary">No CO2e Reporting Unit/source data available yet.</Typography>;
  }
  const width = 900;
  const height = 360;
  const facilityMap = {};
  for (const row of rows) {
    const facility = row.facility_name || row.facility_id || "Unknown";
    const source = row.activity_label || row.activity_type_id || "Unknown";
    const value = Number(row.value || 0);
    if (!facilityMap[facility]) facilityMap[facility] = {};
    facilityMap[facility][source] = (facilityMap[facility][source] || 0) + value;
  }
  const facilities = Object.entries(facilityMap).map(([facility, bySource]) => {
    const sources = Object.entries(bySource).map(([source, value]) => ({ source, value }));
    const total = sources.reduce((sum, item) => sum + item.value, 0);
    return { facility, sources, total };
  });
  const total = facilities.reduce((sum, facility) => sum + facility.total, 0) || 1;
  let xCursor = 0;

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Treemap by Reporting Unit and source">
        {facilities.map((facility, facilityIndex) => {
          const widthValue = (facility.total / total) * width;
          let yCursor = 0;
          const x0 = xCursor;
          xCursor += widthValue;
          return (
            <g key={facility.facility}>
              {facility.sources.map((source, sourceIndex) => {
                const heightValue = facility.total > 0 ? (source.value / facility.total) * height : 0;
                const y0 = yCursor;
                yCursor += heightValue;
                const color = DATA_VIZ_COLORS.categorical[(facilityIndex + sourceIndex) % DATA_VIZ_COLORS.categorical.length];
                return (
                  <g key={`${facility.facility}-${source.source}`}>
                    <rect x={x0} y={y0} width={widthValue} height={heightValue} fill={color} fillOpacity="0.78" stroke="#ffffff" strokeWidth="1" />
                    <title>{`${facility.facility} | ${source.source}: ${formatNumber(source.value)} MTCO2e`}</title>
                    {widthValue > 80 && heightValue > 44 ? (
                      <>
                        <text x={x0 + 6} y={y0 + 16} fontSize="11" fill="#ffffff" fontWeight="700">
                          {facility.facility}
                        </text>
                        <text x={x0 + 6} y={y0 + 30} fontSize="10" fill="#ffffff">
                          {wrapText(source.source, 20).split("\n")[0]}
                        </text>
                        <text x={x0 + 6} y={y0 + 42} fontSize="10" fill="#ffffff">
                          {formatNumber(source.value)} MTCO2e
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

export default function DashboardTab({
  resultRows,
  onSaveResults,
  coverage = null,
  coverageSummaryText = "",
  activityLabelById = {},
  onJumpToActivityInputs = null,
}) {
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

  const co2eRows = React.useMemo(
    () =>
      resultRows
        .filter((row) => String(row.gas).toLowerCase() === "co2e")
        .map((row) => ({ ...row, value: toMetricTons(row.value, row.unit), unit: "metric ton" })),
    [resultRows],
  );

  const dashboardByFacilityRows = React.useMemo(() => {
    const grouped = {};
    for (const row of co2eRows) {
      const key = row.facility_name || row.facility_id || "Unknown";
      grouped[key] = (grouped[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(grouped)
      .map(([facility_name, value], index) => ({ id: `f_${index}`, facility_name, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);

  const dashboardByScopeRows = React.useMemo(() => {
    const grouped = {};
    for (const row of co2eRows) {
      const key = row.scope || "Unknown";
      grouped[key] = (grouped[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(grouped)
      .map(([scope, value], index) => ({ id: `s_${index}`, scope, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);

  const dashboardBySourceRows = React.useMemo(() => {
    const grouped = {};
    for (const row of co2eRows) {
      const key = row.activity_label || row.activity_type_id || "Unknown";
      grouped[key] = (grouped[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(grouped)
      .map(([activity_label, value], index) => ({ id: `src_${index}`, activity_label, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);

  const totalCo2e = React.useMemo(
    () => co2eRows.reduce((sum, row) => sum + Number(row.value || 0), 0),
    [co2eRows],
  );

  const dashboardKpis = React.useMemo(() => {
    const topFacility = dashboardByFacilityRows[0];
    const topSource = dashboardBySourceRows[0];
    const topScope = dashboardByScopeRows[0];
    return [
      {
        id: "total",
        label: "Total Emissions",
        value: `${formatNumber(totalCo2e)} MTCO2e`,
        detail: `${co2eRows.length} CO2e result rows`,
      },
      {
        id: "facility",
        label: "Top Reporting Unit",
        value: topFacility?.facility_name || "No data",
        detail:
          topFacility && totalCo2e > 0
            ? `${formatNumber(topFacility.value)} MTCO2e (${formatPercent((topFacility.value / totalCo2e) * 100)})`
            : "No Reporting Unit totals yet",
      },
      {
        id: "source",
        label: "Top Source",
        value: topSource?.activity_label || "No data",
        detail:
          topSource && totalCo2e > 0
            ? `${formatNumber(topSource.value)} MTCO2e (${formatPercent((topSource.value / totalCo2e) * 100)})`
            : "No source totals yet",
      },
      {
        id: "scope",
        label: "Largest Scope",
        value: topScope?.scope || "No data",
        detail:
          topScope && totalCo2e > 0
            ? `${formatNumber(topScope.value)} MTCO2e (${formatPercent((topScope.value / totalCo2e) * 100)})`
            : "No scope totals yet",
      },
    ];
  }, [co2eRows.length, dashboardByFacilityRows, dashboardByScopeRows, dashboardBySourceRows, totalCo2e]);

  const dashboardTableRows = React.useMemo(
    () =>
      co2eRows
        .map((row, index) => {
          const value = Number(row.value || 0);
          return {
            id: row.id || `dashboard_${index}`,
            facility_name: row.facility_name || row.facility_id,
            activity_label: row.activity_label || row.activity_type_id,
            scope: row.scope || "Unknown",
            accounting_method: row.accounting_method || "",
            value,
            share_pct: totalCo2e > 0 ? (value / totalCo2e) * 100 : 0,
          };
        })
        .sort((a, b) => b.value - a.value),
    [co2eRows, totalCo2e],
  );

  const dashboardTableColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Reporting Unit", flex: 0.95, minWidth: 160, renderCell: renderWrappedCell },
      { field: "activity_label", headerName: "Activity", flex: 1.1, minWidth: 180, renderCell: renderWrappedCell },
      { field: "scope", headerName: "Scope", flex: 0.7, minWidth: 120 },
      { field: "accounting_method", headerName: "Accounting", flex: 0.85, minWidth: 140 },
      {
        field: "value",
        headerName: "MTCO2e",
        type: "number",
        flex: 0.6,
        minWidth: 120,
        valueFormatter: (value) => formatNumber(value),
      },
      {
        field: "share_pct",
        headerName: "Share",
        type: "number",
        flex: 0.55,
        minWidth: 110,
        valueFormatter: (value) => formatPercent(value),
      },
    ],
    [renderWrappedCell],
  );

  return (
    <Stack spacing={2}>
      {/*
        Phase D2 — Source Coverage widget. Placed at the top of the
        Dashboard so completeness lands before the user dives into
        emissions totals. Renders a friendly placeholder when no
        applicable lists are configured anywhere in the project.
      */}
      <CoverageWidget
        coverage={coverage}
        activityLabelById={activityLabelById}
        summaryText={coverageSummaryText}
        onViewMissing={onJumpToActivityInputs ? () => onJumpToActivityInputs() : null}
      />
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Dashboard Summary (MTCO2e)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Dashboard shows CO2-equivalent emissions only, in metric tons.
        </Typography>
      </Paper>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" },
        }}
      >
        {dashboardKpis.map((kpi) => (
          <Paper key={kpi.id} sx={{ p: 2 }}>
            <Typography variant="overline" color="text.secondary">
              {kpi.label}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.25 }}>
              {kpi.value}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {kpi.detail}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Paper sx={{ p: 2, minHeight: 420 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1">Emissions by Source (Column Chart)</Typography>
          <Button variant="outlined" onClick={() => onSaveResults("Saved with calculated results.")}>
            Save Results Snapshot
          </Button>
        </Stack>
        <SourceBarChart rows={dashboardBySourceRows} />
      </Paper>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 0.95fr) minmax(0, 1.25fr)" },
          alignItems: "stretch",
        }}
      >
        <Paper sx={{ p: 2, minHeight: 420 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Emissions by Scope (Donut Chart)
          </Typography>
          <ScopeDonutChart rows={dashboardByScopeRows} />
        </Paper>
        <Paper sx={{ p: 2, minHeight: 420 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Emissions by Reporting Unit and Source (Treemap)
          </Typography>
          <FacilitySourceTreemap rows={co2eRows} />
        </Paper>
      </Box>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle1">Detailed CO2e Results</Typography>
          <Typography variant="body2" color="text.secondary">
            Use sorting, pagination, and keyboard navigation to inspect the heaviest rows.
          </Typography>
        </Stack>
        <Box sx={{ height: 420 }}>
          <DataGrid
            rows={dashboardTableRows}
            columns={dashboardTableColumns}
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              sorting: { sortModel: [{ field: "value", sort: "desc" }] },
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
            }}
          />
        </Box>
      </Paper>
    </Stack>
  );
}
