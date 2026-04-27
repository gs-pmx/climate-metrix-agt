import * as React from "react";
import { Box, Stack, Typography, useTheme } from "@mui/material";
import { aggregateByScope } from "./analyticsState.js";

// Single horizontal stacked bar showing Scope 1 / Scope 2 / Scope 3
// shares. Implemented as a flexbox row of colored segments rather than
// a recharts stacked BarChart because we only have one bar and the
// recharts ``BarChart`` wraps things in a chart-grid we don't need
// here. Tooltip text on hover gives the exact MT value for each
// scope.

const SCOPE_COLORS = {
  // Picked from the MUI palette so they harmonize with the chips and
  // the rest of the dashboard. Scope 1 is the warmest (orange/red
  // intuition for direct emissions), Scope 2 cooler, Scope 3 neutral.
  "Scope 1": "#d84315",
  "Scope 2": "#1565c0",
  "Scope 3": "#6a1b9a",
};

function formatMt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 10 ? 0 : 2,
    maximumFractionDigits: n >= 10 ? 1 : 2,
  });
}

export default function ScopeStackBar({ rows = [] }) {
  const theme = useTheme();
  const buckets = React.useMemo(() => aggregateByScope(rows), [rows]);
  const total = buckets.reduce((sum, b) => sum + b.valueMt, 0);

  if (total <= 0) {
    return (
      <Typography color="text.secondary">
        No CO2e data to split by Scope yet.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      <Box
        sx={{
          display: "flex",
          width: "100%",
          height: 28,
          borderRadius: 1,
          overflow: "hidden",
          border: `1px solid ${theme.palette.divider}`,
        }}
        role="img"
        aria-label="Stacked emissions by Scope"
      >
        {buckets.map((bucket) => {
          if (bucket.valueMt <= 0) return null;
          const widthPct = (bucket.valueMt / total) * 100;
          const color = SCOPE_COLORS[bucket.scope] || theme.palette.grey[500];
          return (
            <Box
              key={bucket.scope}
              title={`${bucket.scope}: ${formatMt(bucket.valueMt)} MT (${bucket.pct.toFixed(1)}%)`}
              sx={{
                width: `${widthPct}%`,
                bgcolor: color,
                color: theme.palette.getContrastText(color),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                px: 1,
                whiteSpace: "nowrap",
              }}
            >
              {widthPct >= 8 ? `${bucket.scope.replace("Scope ", "S")} ${bucket.pct.toFixed(0)}%` : ""}
            </Box>
          );
        })}
      </Box>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        {buckets.map((bucket) => {
          const color = SCOPE_COLORS[bucket.scope] || theme.palette.grey[500];
          return (
            <Stack key={bucket.scope} direction="row" spacing={0.75} alignItems="center">
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: 0.5,
                  bgcolor: color,
                }}
              />
              <Typography variant="body2">
                {bucket.scope}: {formatMt(bucket.valueMt)} MT
                {total > 0 ? ` (${bucket.pct.toFixed(1)}%)` : ""}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}
