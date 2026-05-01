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
// reflect the current filter combo.
//
// Phase F2 PR 2 — the Coverage KPI tile moved out with the rest of the
// Source Coverage widget (now lives on the Results tab). The dashboard
// is pure outcomes; coverage status sits adjacent to result rows where
// the "what got included" framing is more natural.
//
// Title-row typography (post-D3 polish): bumped from ``overline`` to a
// 14px / 600-weight label so the labels read as proper field titles
// rather than captions. The big number still dominates the tile; the
// label just needs to be legible without leaning in.
export default function AnalyticsKpiCards({ rows = [] }) {
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
  ];

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
      }}
    >
      {tiles.map((tile) => (
        <Paper key={tile.id} sx={{ p: 2 }}>
          <Typography
            color="text.secondary"
            sx={{
              // Bumped from ``overline`` to a proper 14px label that
              // still reads as secondary (text.secondary keeps it from
              // competing with the big number). Letter-spacing gives
              // it a subtle "field title" feel without going full caps.
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.3,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
            }}
          >
            {tile.label}
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5 }}>
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
