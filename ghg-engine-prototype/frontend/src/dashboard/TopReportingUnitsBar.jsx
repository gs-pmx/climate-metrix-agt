import * as React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { aggregateByReportingUnit } from "./analyticsState.js";

const SCOPE_COLORS = {
  "Scope 1": "#d84315",
  "Scope 2": "#1565c0",
  "Scope 3": "#6a1b9a",
};

const SCOPE_KEYS = ["Scope 1", "Scope 2", "Scope 3"];

const DIM_OPACITY = 0.35;

// Top-N Reporting Units, stacked by Scope. The user can click a bar to
// pivot the dashboard's RU selection (highlight, not filter); the
// click handler is wired on the parent so the chart stays purely
// presentational.
//
// Selection (post-D3 polish): when a selection is set, every RU bar
// other than the selected facility renders at reduced opacity. Each
// stack segment uses a per-bar ``Cell`` so we can dim individual bars
// while keeping the recharts stacking math intact.
export default function TopReportingUnitsBar({
  rows = [],
  limit = 10,
  onBarClick = null,
  selection = null,
}) {
  const theme = useTheme();
  const data = React.useMemo(() => aggregateByReportingUnit(rows, { limit }), [rows, limit]);

  const selectedFacilityId = selection?.facility_id || null;

  if (!data.length) {
    return (
      <Typography color="text.secondary">
        No Reporting Unit totals yet.
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", height: 380 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, left: 8, bottom: 56 }}
          onClick={(state) => {
            const datum = state?.activePayload?.[0]?.payload;
            if (datum && onBarClick) onBarClick(datum.facility_id);
          }}
        >
          <CartesianGrid stroke={theme.palette.divider} strokeDasharray="3 3" />
          <XAxis
            dataKey="facility_name"
            stroke={theme.palette.text.secondary}
            interval={0}
            angle={-32}
            textAnchor="end"
            height={70}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            stroke={theme.palette.text.secondary}
            tick={{ fontSize: 11 }}
            label={{
              value: "MT CO2e",
              angle: -90,
              position: "insideLeft",
              fill: theme.palette.text.secondary,
              fontSize: 11,
            }}
          />
          <Tooltip
            formatter={(value) =>
              `${Number(value).toLocaleString(undefined, {
                minimumFractionDigits: value >= 10 ? 0 : 2,
                maximumFractionDigits: value >= 10 ? 1 : 2,
              })} MT`
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          {/* Bars are explicit so we can color each scope independently;
              dataKey strings match the keys produced by
              ``aggregateByReportingUnit``. Per-bar ``Cell`` lets us
              dim the unselected facilities in cross-filter mode. */}
          {SCOPE_KEYS.map((scope) => (
            <Bar
              key={scope}
              dataKey={scope}
              stackId="scope"
              fill={SCOPE_COLORS[scope]}
              cursor="pointer"
            >
              {data.map((entry) => {
                const dim =
                  selectedFacilityId && entry.facility_id !== selectedFacilityId;
                return (
                  <Cell
                    key={`${scope}-${entry.facility_id}`}
                    fill={SCOPE_COLORS[scope]}
                    fillOpacity={dim ? DIM_OPACITY : 1}
                  />
                );
              })}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
