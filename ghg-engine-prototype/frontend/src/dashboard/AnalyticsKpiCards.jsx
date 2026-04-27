import * as React from "react";
import { Box, Paper, Typography } from "@mui/material";
import { aggregateKpis } from "./analyticsState.js";

// Format a numeric value for the headline KPI tile. We round to 1
// decimal for >=10 MT and 2 decimals below to keep small projects
// readable without sacrificing precision on big ones.
function formatMt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const digits = n >= 10 ? 1 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Phase D3 KPI strip. Reads from filtered analytics rows so the tiles
// reflect the current filter combo. ``coverage`` is the project-level
// CoverageWidget data (already computed at App level by the D2 helpers);
// we surface its top-line percentage as the fourth KPI so the user can
// scan totals + completeness at a glance.
export default function AnalyticsKpiCards({ rows = [], coverage = null }) {
  const kpis = React.useMemo(() => aggregateKpis(rows), [rows]);

  const tiles = [
    {
      id: "total",
      label: "Total CO2e",
      value: `${formatMt(kpis.totalCo2eMt)} MT`,
      detail: `${rows.length} aggregated cell${rows.length === 1 ? "" : "s"}`,
    },
    {
      id: "ru",
      label: "RUs Reporting",
      value: String(kpis.reportingUnitsReporting),
      detail: kpis.reportingUnitsReporting === 1 ? "Reporting Unit with data" : "Reporting Units with data",
    },
    {
      id: "activities",
      label: "Activities Calculated",
      value: String(kpis.activitiesCalculated),
      detail: "Distinct (RU, activity) pairs",
    },
    {
      id: "coverage",
      label: "Coverage",
      // ``coverage.percent`` is 0-100; the CoverageWidget owns the
      // detailed breakdown. We just surface the headline number.
      value:
        coverage && Number.isFinite(Number(coverage.percent))
          ? `${Number(coverage.percent).toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 1,
            })}%`
          : "-",
      detail:
        coverage && Number.isFinite(Number(coverage.percent))
          ? "Project-level source coverage"
          : "Configure sources to see coverage",
    },
  ];

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" },
      }}
    >
      {tiles.map((tile) => (
        <Paper key={tile.id} sx={{ p: 2 }}>
          <Typography variant="overline" color="text.secondary">
            {tile.label}
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.25 }}>
            {tile.value}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {tile.detail}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}
