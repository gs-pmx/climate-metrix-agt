import * as React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { buildTreemapData } from "./analyticsState.js";
import { colorForActivity } from "../categoryColors.js";

// Stable per-category colors so a "Stationary Energy" cell looks
// the same in F1 as it does in F2. We derive a representative color
// for each category by taking the color associated with the first
// activity_type_id we see for that category, then falling back to a
// fixed map for activity types that aren't in ``categoryColors``.
//
// The original ``categoryColors`` keys off subcategory (TOC bucket).
// For the analytics treemap we keyed off the catalog ``category``
// field ("Stationary Energy", "Transportation", "Fugitive Emissions",
// "Solid Waste"). We map those to subcategory-style ids that
// ``categoryColors`` already covers, with a sensible default for
// anything we miss.

const CATEGORY_TO_COLOR_KEY = {
  "Stationary Energy": "stationary_combustion",
  Transportation: "mobile_combustion",
  "Fugitive Emissions": "fugitive_emissions",
  "Solid Waste": "waste_generated_in_operations",
};

function colorForCategory(category) {
  const key = CATEGORY_TO_COLOR_KEY[category] || "scope3_other";
  // Reuse the existing palette by spoofing an activity-type-shaped
  // object. ``colorForActivity`` calls ``categorizeForTOC`` to derive
  // the subcategory; we feed it directly via a synthetic activity that
  // hits the fallback "other" path, then override with our key map.
  return colorForActivity({
    activity_type_id: `__${key}`,
    scope: "Scope 1",
    metric_subgroup: key,
    category: "",
    method_id: "",
    factor_query_templates: [],
  });
}

// recharts gives the content renderer a flat node descriptor; depth=0
// is the root, depth=1 is per-RU, depth=2 is per-category. We render
// labels for both layers when the cell is large enough.
function TreemapCell(props) {
  const {
    x,
    y,
    width,
    height,
    depth,
    name,
    value,
    facility_id: cellFacilityId,
    facility_name: cellFacilityName,
    category: cellCategory,
    onLeafClick,
    onParentClick,
    palette,
    theme,
  } = props;

  if (width <= 0 || height <= 0) return null;

  // Top-level (RU) parent cells: draw a translucent border outline; the
  // colored leaves show through.
  if (depth === 1) {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="transparent"
          stroke={theme.palette.grey[400]}
          strokeWidth={2}
          cursor={onParentClick ? "pointer" : "default"}
          onClick={() => {
            if (onParentClick) onParentClick(cellFacilityId);
          }}
        />
        {width > 80 && height > 24 ? (
          <text
            x={x + 8}
            y={y + 18}
            fill={theme.palette.text.primary}
            fontSize={13}
            fontWeight={700}
            style={{ pointerEvents: "none" }}
          >
            {String(cellFacilityName || name || "").slice(0, Math.max(8, Math.floor(width / 8)))}
          </text>
        ) : null}
      </g>
    );
  }

  // Leaf (category) cell.
  const colorTuple = palette[cellCategory] || colorForCategory(cellCategory);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={colorTuple.bg}
        stroke="#ffffff"
        strokeWidth={1}
        cursor={onLeafClick ? "pointer" : "default"}
        onClick={() => {
          if (onLeafClick) onLeafClick({ facility_id: cellFacilityId, category: cellCategory });
        }}
      />
      {width > 60 && height > 28 ? (
        <text
          x={x + 6}
          y={y + 16}
          fill={colorTuple.fg}
          fontSize={11}
          fontWeight={600}
          style={{ pointerEvents: "none" }}
        >
          {String(cellCategory || name || "").slice(0, Math.max(6, Math.floor(width / 7)))}
        </text>
      ) : null}
      {width > 60 && height > 44 ? (
        <text
          x={x + 6}
          y={y + 30}
          fill={colorTuple.fg}
          fontSize={10}
          style={{ pointerEvents: "none" }}
        >
          {Number(value).toLocaleString(undefined, {
            minimumFractionDigits: value >= 10 ? 0 : 2,
            maximumFractionDigits: value >= 10 ? 1 : 2,
          })}{" "}
          MT
        </text>
      ) : null}
    </g>
  );
}

export default function EmissionsTreemap({ rows = [], onCategoryClick = null, onReportingUnitClick = null }) {
  const theme = useTheme();
  const data = React.useMemo(() => buildTreemapData(rows), [rows]);

  const palette = React.useMemo(() => {
    const seen = new Set();
    const out = {};
    for (const ru of data) {
      for (const child of ru.children || []) {
        if (seen.has(child.category)) continue;
        seen.add(child.category);
        out[child.category] = colorForCategory(child.category);
      }
    }
    return out;
  }, [data]);

  if (!data.length) {
    return (
      <Typography color="text.secondary">
        No CO2e data to render in the treemap yet. Enter activities and calculate to populate.
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", height: 380 }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="value"
          stroke="#ffffff"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={
            <TreemapCell
              onLeafClick={onCategoryClick}
              onParentClick={onReportingUnitClick}
              palette={palette}
              theme={theme}
            />
          }
        >
          <Tooltip
            formatter={(value, _name, payload) => {
              const node = payload?.payload || {};
              const labelParts = [];
              if (node.facility_name) labelParts.push(node.facility_name);
              if (node.category) labelParts.push(node.category);
              return [
                `${Number(value).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} MT`,
                labelParts.join(" / ") || node.name || "",
              ];
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </Box>
  );
}
