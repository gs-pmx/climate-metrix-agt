import * as React from "react";
import { Box, Stack, Typography, useTheme } from "@mui/material";
import { aggregateByScope, applySelectionToRows } from "./analyticsState.js";

// Single horizontal stacked bar showing Scope 1 / Scope 2 / Scope 3
// shares. Implemented as a flexbox row of colored segments rather than
// a recharts stacked BarChart because we only have one bar and the
// recharts ``BarChart`` wraps things in a chart-grid we don't need
// here. Tooltip text on hover gives the exact MT value for each
// scope.
//
// Selection (post-D3 polish): when a selection is active each scope
// segment is split into two side-by-side blocks — the "selected" share
// (full saturation) and the "rest" share (dimmed). The widths are
// proportional so the eye reads "X% of Scope 2 is from the selection"
// at a glance. The segment border keeps the scope band readable as a
// whole even when the dim partner is small.

const SCOPE_COLORS = {
  // Picked from the MUI palette so they harmonize with the chips and
  // the rest of the dashboard. Scope 1 is the warmest (orange/red
  // intuition for direct emissions), Scope 2 cooler, Scope 3 neutral.
  "Scope 1": "#d84315",
  "Scope 2": "#1565c0",
  "Scope 3": "#6a1b9a",
};

const REST_OPACITY = 0.35;

function formatMt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 10 ? 0 : 2,
    maximumFractionDigits: n >= 10 ? 1 : 2,
  });
}

export default function ScopeStackBar({ rows = [], selection = null }) {
  const theme = useTheme();
  const buckets = React.useMemo(() => aggregateByScope(rows), [rows]);
  // Compute the selected-only scope totals so each scope segment can
  // render a "highlighted share" sub-segment overlaid on the dim rest.
  const selectedBuckets = React.useMemo(() => {
    if (!selection) return null;
    const { selected } = applySelectionToRows(rows, selection);
    if (selected.length === 0) return null;
    return aggregateByScope(selected);
  }, [rows, selection]);
  const selectedByScope = React.useMemo(() => {
    if (!selectedBuckets) return null;
    return Object.fromEntries(selectedBuckets.map((b) => [b.scope, b.valueMt]));
  }, [selectedBuckets]);

  const total = buckets.reduce((sum, b) => sum + b.valueMt, 0);

  if (total <= 0) {
    return (
      <Typography color="text.secondary">
        No CO2e data to split by Scope yet.
      </Typography>
    );
  }

  const hasSelection = selectedByScope != null;

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
          // Selection split: the selected slice within this scope
          // renders bright; the rest of the scope renders dim. When
          // there's no selection (or the scope has no selected share),
          // the full scope band renders bright.
          const selectedMt = hasSelection ? selectedByScope[bucket.scope] || 0 : 0;
          const selectedShareWithinScope = bucket.valueMt > 0 ? selectedMt / bucket.valueMt : 0;
          const selectedSubPct = selectedShareWithinScope * 100;
          const restSubPct = 100 - selectedSubPct;
          const tooltipText = hasSelection
            ? `${bucket.scope}: ${formatMt(bucket.valueMt)} MT (${bucket.pct.toFixed(1)}%) — selected share: ${formatMt(selectedMt)} MT`
            : `${bucket.scope}: ${formatMt(bucket.valueMt)} MT (${bucket.pct.toFixed(1)}%)`;
          return (
            <Box
              key={bucket.scope}
              title={tooltipText}
              sx={{
                width: `${widthPct}%`,
                display: "flex",
                position: "relative",
                color: theme.palette.getContrastText(color),
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {/* Selected sub-segment (bright). Rendered first so it
                  sits on the left of the scope band. */}
              {hasSelection && selectedSubPct > 0 ? (
                <Box
                  sx={{
                    width: `${selectedSubPct}%`,
                    bgcolor: color,
                    opacity: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    px: selectedSubPct >= 8 ? 1 : 0,
                  }}
                >
                  {selectedSubPct >= 18
                    ? `${bucket.scope.replace("Scope ", "S")} ${selectedShareWithinScope.toLocaleString(undefined, {
                        style: "percent",
                        maximumFractionDigits: 0,
                      })}`
                    : ""}
                </Box>
              ) : null}
              {/* Rest sub-segment (dimmed when there's a selection,
                  full saturation otherwise). */}
              {restSubPct > 0 ? (
                <Box
                  sx={{
                    width: `${restSubPct}%`,
                    bgcolor: color,
                    opacity: hasSelection ? REST_OPACITY : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    px: restSubPct >= 8 ? 1 : 0,
                  }}
                >
                  {!hasSelection && widthPct >= 8
                    ? `${bucket.scope.replace("Scope ", "S")} ${bucket.pct.toFixed(0)}%`
                    : ""}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        {buckets.map((bucket) => {
          const color = SCOPE_COLORS[bucket.scope] || theme.palette.grey[500];
          const selectedMt = hasSelection ? selectedByScope[bucket.scope] || 0 : 0;
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
                {hasSelection && selectedMt > 0
                  ? ` — selected ${formatMt(selectedMt)} MT`
                  : ""}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}
