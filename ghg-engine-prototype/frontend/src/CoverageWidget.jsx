import * as React from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

// Phase D2 — Source Coverage widget for the Dashboard tab.
//
// Card layout:
//   - Header "Source Coverage" + a one-line status string.
//   - Big-number tiles: applicable / complete / errors / missing.
//   - Stacked horizontal bar showing the breakdown
//     (complete | with-data-no-calc | errored | missing) using MUI
//     palette colors. Hover/title tags name each band's count.
//   - Top-N detail rows: up to 5 missing pairs by display name. We
//     surface missing first because that's the typical user concern;
//     errors get their own row group when present.
//
// When `totalApplicable === 0` (no applicable lists configured anywhere
// in the project) we render a friendly placeholder explaining the
// planning-tool feature and pointing the user back to Reporting Units.

function PlaceholderCard() {
  return (
    <Paper sx={{ p: 2 }} data-testid="coverage-widget-empty">
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        Source Coverage
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Configure sources on each Reporting Unit to track coverage. Once you
        select which activity types apply to a unit, this widget will show how
        many sources are complete, missing data, or producing errors.
      </Typography>
    </Paper>
  );
}

// Stacked coverage bar — pure SVG, no extra deps. Each band reads its
// theme color via inline `palette.*` lookups so dark/light mode picks
// up automatically. Bands shorter than ~5% width still render but
// without a label, mirrored by the band's title attribute on hover.
function CoverageBar({ counts, total }) {
  // Percentages add to total. We never divide by zero — the widget's
  // parent only renders this when total > 0.
  const segments = [
    { key: "complete", count: counts.complete, color: "success.main", label: "Complete" },
    { key: "with_data", count: Math.max(0, counts.withData - counts.complete - counts.errored), color: "info.main", label: "With data" },
    { key: "errored", count: counts.errored, color: "error.main", label: "Errored" },
    { key: "missing", count: counts.missing, color: "warning.main", label: "Missing" },
  ].filter((seg) => seg.count > 0);

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          display: "flex",
          width: "100%",
          height: 18,
          borderRadius: 1,
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
        }}
        data-testid="coverage-widget-bar"
      >
        {segments.map((seg) => {
          const pct = (seg.count / total) * 100;
          return (
            <Box
              key={seg.key}
              title={`${seg.label}: ${seg.count}`}
              sx={{
                width: `${pct}%`,
                bgcolor: seg.color,
              }}
            />
          );
        })}
      </Box>
      <Stack direction="row" spacing={1.5} sx={{ mt: 0.75, flexWrap: "wrap" }}>
        {segments.map((seg) => (
          <Stack key={seg.key} direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "2px",
                bgcolor: seg.color,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {seg.label}: {seg.count}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function NumberTile({ label, value, accent }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 100 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.1 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ mt: 0.25, color: accent || "text.primary" }}>
        {value}
      </Typography>
    </Paper>
  );
}

export default function CoverageWidget({
  coverage,
  activityLabelById = {},
  summaryText = "",
  onViewMissing = null,
}) {
  if (!coverage || coverage.totalApplicable === 0) {
    return <PlaceholderCard />;
  }

  const { totalApplicable, complete, missing, errored, orphaned } = coverage;
  const topMissing = (coverage.missingPairs || []).slice(0, 5);
  const topErrored = (coverage.erroredPairs || []).slice(0, 5);

  return (
    <Paper sx={{ p: 2 }} data-testid="coverage-widget">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="baseline" justifyContent="space-between">
          <Typography variant="h6">Source Coverage</Typography>
          {summaryText ? (
            <Typography variant="body2" color="text.secondary">
              {summaryText}
            </Typography>
          ) : null}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
          }}
        >
          <NumberTile label="Applicable" value={totalApplicable} />
          <NumberTile label="Complete" value={complete} accent="success.main" />
          <NumberTile label="Errors" value={errored} accent={errored > 0 ? "error.main" : undefined} />
          <NumberTile label="Missing" value={missing} accent={missing > 0 ? "warning.main" : undefined} />
        </Box>

        <CoverageBar counts={coverage} total={totalApplicable} />

        {orphaned > 0 ? (
          <Chip
            label={`${orphaned} orphaned ${orphaned === 1 ? "activity" : "activities"} (data preserved but not in inventory)`}
            size="small"
            variant="outlined"
            color="default"
            sx={{ alignSelf: "flex-start" }}
            data-testid="coverage-widget-orphaned-chip"
          />
        ) : null}

        {topMissing.length > 0 ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Top missing sources
            </Typography>
            <Stack spacing={0.25}>
              {topMissing.map((pair, idx) => {
                const unitName = pair.unit?.facility_name?.trim() || "Untitled Reporting Unit";
                const activityLabel = activityLabelById[pair.activityTypeId] || pair.activityTypeId;
                return (
                  <Typography
                    key={`${pair.unit?.id || idx}::${pair.activityTypeId}`}
                    variant="body2"
                    color="text.secondary"
                    component={onViewMissing ? "button" : "span"}
                    onClick={onViewMissing ? () => onViewMissing(pair) : undefined}
                    sx={onViewMissing ? {
                      background: "none",
                      border: "none",
                      p: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      color: "text.secondary",
                      "&:hover": { color: "primary.main", textDecoration: "underline" },
                    } : undefined}
                  >
                    {unitName}: {activityLabel}
                  </Typography>
                );
              })}
            </Stack>
            {missing > topMissing.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                ...and {missing - topMissing.length} more.
              </Typography>
            ) : null}
          </Box>
        ) : null}

        {topErrored.length > 0 ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5, color: "error.main" }}>
              Sources with calculation errors
            </Typography>
            <Stack spacing={0.25}>
              {topErrored.map((pair, idx) => {
                const unitName = pair.unit?.facility_name?.trim() || "Untitled Reporting Unit";
                const activityLabel = activityLabelById[pair.activityTypeId] || pair.activityTypeId;
                return (
                  <Typography
                    key={`${pair.unit?.id || idx}::${pair.activityTypeId}`}
                    variant="body2"
                    color="text.secondary"
                  >
                    {unitName}: {activityLabel}
                  </Typography>
                );
              })}
            </Stack>
            {errored > topErrored.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                ...and {errored - topErrored.length} more.
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
