import * as React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { buildTreemapData, matchesSelection } from "./analyticsState.js";
import { colorForActivity, saturatedFallbackColor } from "../categoryColors.js";

// ----- Color helpers -------------------------------------------------------

// The Configure Sources palette is keyed by subcategory id, but the
// dashboard treemap groups by catalog ``category`` ("Stationary
// Energy", "Transportation", etc.). Map each category to a color via
// a representative subcategory; fall back to a saturated mid-tone
// palette for any category we haven't catalogued. Saturated, opaque
// fills are intentional — pastel washes make the treemap unreadable.
const CATEGORY_TO_COLOR_KEY = {
  "Stationary Energy": "stationary_combustion",
  Transportation: "mobile_combustion",
  "Fugitive Emissions": "fugitive_emissions",
  "Solid Waste": "waste_generated_in_operations",
};

function colorForCategory(category) {
  const key = CATEGORY_TO_COLOR_KEY[category];
  if (!key) {
    // Hash-keyed saturated fallback so unknown categories still get a
    // distinguishable, non-washed-out fill.
    return saturatedFallbackColor(category || "other");
  }
  return colorForActivity({
    activity_type_id: `__${key}`,
    scope: "Scope 1",
    metric_subgroup: key,
    category: "",
    method_id: "",
    factor_query_templates: [],
  });
}

// YIQ luminance check — colors above the threshold read as "light" and
// need dark text; otherwise white text. Threshold tuned so the Configure
// Sources border colors fall on the dark side and pick up white text.
function isLight(hex) {
  if (typeof hex !== "string") return true;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return true;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

// ----- Number formatting ---------------------------------------------------

function formatMt(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 10 ? 0 : 2,
    maximumFractionDigits: n >= 10 ? 1 : 2,
  });
}

// ----- ResizeObserver hook -------------------------------------------------

// Track the rendered size of an element. We need actual pixel
// dimensions for the inner SVG slice-and-dice math because flex sizes
// the outer RU columns based on the total emissions ratio, and we need
// each column's resolved width to know how many pixels are available
// for the embedded category treemap.
function useElementSize() {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof ResizeObserver === "undefined") {
      // Fallback for very old browsers / SSR — sample once via
      // getBoundingClientRect. The treemap will still render but
      // won't reflow until the next mount.
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize((prev) => {
          if (prev.width === width && prev.height === height) return prev;
          return { width, height };
        });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

// ----- Layout constants ----------------------------------------------------

// Header height for each RU band. Big enough for a 14px bold label
// with comfortable padding without eating too much body height.
const HEADER_HEIGHT = 26;

// Minimum cell footprint for label visibility. Cells smaller than this
// hide their label / value text rather than rendering a clipped string
// that's noise more than signal.
const MIN_LABEL_WIDTH = 70;
const MIN_LABEL_HEIGHT = 28;
const MIN_VALUE_HEIGHT = 46;

// ----- Inner category SVG --------------------------------------------------

// Render the categories inside one RU's body as a vertical stack of
// horizontal slices, each sized by its share of the RU total. The
// outer flex layout already split the available width between RUs, so
// the inner direction is perpendicular: stacked rows.
function CategoryStack({
  categories,
  width,
  height,
  facilityId,
  onCategoryClick,
  selection,
  theme,
  onCellHover,
  onCellLeave,
  clipIdPrefix,
}) {
  if (width <= 0 || height <= 0 || categories.length === 0) {
    return <svg width="100%" height="100%" />;
  }
  const total = categories.reduce((sum, c) => sum + (c.value || 0), 0);
  if (total <= 0) return <svg width="100%" height="100%" />;

  const hasSelection = selection != null && selection.facility_id;

  // Pre-compute each cell's y/h so rounding errors stack at the bottom.
  const layout = [];
  let cursor = 0;
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    const isLast = i === categories.length - 1;
    const share = c.value / total;
    const cellHeight = isLast ? height - cursor : Math.max(0, share * height);
    layout.push({ category: c, y: cursor, height: cellHeight });
    cursor += cellHeight;
  }

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block" }}
      // Disable pointer events at the SVG level — cells re-enable.
      // This lets the outer column's mouseleave fire correctly when
      // the cursor exits a gap between cells.
    >
      <defs>
        {layout.map((cell, idx) => (
          <clipPath key={`${clipIdPrefix}-clip-${idx}`} id={`${clipIdPrefix}-clip-${idx}`}>
            <rect x={0} y={cell.y} width={width} height={cell.height} />
          </clipPath>
        ))}
      </defs>
      {layout.map((cell, idx) => {
        const c = cell.category;
        const colorTuple = colorForCategory(c.category);
        const fill = colorTuple.border;
        const labelFill = isLight(fill) ? "#1f1f1f" : "#ffffff";
        const cellRow = { facility_id: facilityId, category: c.category };
        const isSelected = hasSelection && matchesSelection(cellRow, selection);
        const cellOpacity = !hasSelection || isSelected ? 1 : 0.35;
        const strokeColor = isSelected ? theme.palette.text.primary : "#ffffff";
        const strokeWidth = isSelected ? 2.5 : 1;
        const showLabel = width >= MIN_LABEL_WIDTH && cell.height >= MIN_LABEL_HEIGHT;
        const showValue = width >= MIN_LABEL_WIDTH && cell.height >= MIN_VALUE_HEIGHT;
        const labelX = 8;
        const labelY = cell.y + 18;
        const valueY = cell.y + 34;
        return (
          <g key={`${clipIdPrefix}-cell-${idx}`} opacity={cellOpacity}>
            <rect
              x={0}
              y={cell.y}
              width={width}
              height={cell.height}
              fill={fill}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              cursor={onCategoryClick ? "pointer" : "default"}
              onMouseEnter={(e) =>
                onCellHover?.(e, {
                  facility_name: c.facility_name,
                  category: c.category,
                  value: c.value,
                })
              }
              onMouseMove={(e) =>
                onCellHover?.(e, {
                  facility_name: c.facility_name,
                  category: c.category,
                  value: c.value,
                })
              }
              onMouseLeave={onCellLeave}
              onClick={() => {
                if (onCategoryClick) {
                  onCategoryClick({ facility_id: facilityId, category: c.category });
                }
              }}
            />
            {showLabel ? (
              <g
                clipPath={`url(#${clipIdPrefix}-clip-${idx})`}
                style={{ pointerEvents: "none" }}
              >
                <text
                  x={labelX}
                  y={labelY}
                  fill={labelFill}
                  fontSize={13}
                  fontWeight={700}
                  style={{
                    paintOrder: "stroke",
                    stroke: "rgba(0,0,0,0.45)",
                    strokeWidth: 2,
                    strokeLinejoin: "round",
                  }}
                >
                  {c.category}
                </text>
                {showValue ? (
                  <text
                    x={labelX}
                    y={valueY}
                    fill={labelFill}
                    fontSize={11}
                    fontWeight={500}
                    opacity={0.9}
                    style={{
                      paintOrder: "stroke",
                      stroke: "rgba(0,0,0,0.45)",
                      strokeWidth: 2,
                      strokeLinejoin: "round",
                    }}
                  >
                    {formatMt(c.value)} MT
                  </text>
                ) : null}
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// ----- Per-RU column -------------------------------------------------------

function ReportingUnitColumn({
  ru,
  flexBasisPct,
  onCategoryClick,
  onReportingUnitClick,
  selection,
  theme,
  onCellHover,
  onCellLeave,
  clipIdPrefix,
}) {
  const [bodyRef, bodySize] = useElementSize();

  const hasSelection = selection != null && selection.facility_id;
  const isHeaderSelected =
    hasSelection &&
    selection.facility_id === ru.facility_id &&
    !selection.category;

  // When a category-level selection is active for THIS RU, the header
  // shouldn't dim. When a selection is active for a DIFFERENT RU, the
  // whole column (header + body) dims so the eye lands on the chosen
  // RU column. We dim the body via the per-cell opacity inside the SVG
  // and dim the header here.
  const isOtherRuSelected =
    hasSelection && selection.facility_id !== ru.facility_id;
  const headerOpacity = isOtherRuSelected ? 0.5 : 1;
  const headerBg = isHeaderSelected
    ? theme.palette.action.selected
    : theme.palette.grey[200];
  const headerBorder = isHeaderSelected
    ? `1px solid ${theme.palette.text.primary}`
    : `1px solid ${theme.palette.divider}`;

  return (
    <Box
      sx={{
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: `${flexBasisPct}%`,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        // Subtle gap between RU columns is just the white stroke from
        // each cell border. A 1px outer border defines the RU envelope
        // independently of category cell strokes.
        boxSizing: "border-box",
        borderRight: `1px solid ${theme.palette.divider}`,
        // The last column gets the right border via the parent clamp;
        // suppress here to avoid a double-line. The container handles
        // it by trimming its own padding.
        "&:last-of-type": { borderRight: "none" },
      }}
    >
      <Box
        sx={{
          height: HEADER_HEIGHT,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          px: 1,
          background: headerBg,
          borderBottom: headerBorder,
          opacity: headerOpacity,
          cursor: onReportingUnitClick ? "pointer" : "default",
          overflow: "hidden",
          userSelect: "none",
        }}
        onClick={() => {
          if (onReportingUnitClick) onReportingUnitClick(ru.facility_id);
        }}
        title={ru.name}
      >
        <Typography
          component="span"
          sx={{
            fontSize: 14,
            fontWeight: 700,
            color: "text.primary",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            width: "100%",
          }}
        >
          {ru.name}
        </Typography>
      </Box>
      <Box
        ref={bodyRef}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          opacity: isOtherRuSelected ? 0.5 : 1,
          // The body wrapper sets a positioning context for the SVG.
          position: "relative",
          overflow: "hidden",
        }}
      >
        <CategoryStack
          categories={ru.children || []}
          width={bodySize.width}
          height={bodySize.height}
          facilityId={ru.facility_id}
          onCategoryClick={onCategoryClick}
          selection={selection}
          theme={theme}
          onCellHover={onCellHover}
          onCellLeave={onCellLeave}
          clipIdPrefix={clipIdPrefix}
        />
      </Box>
    </Box>
  );
}

// ----- Tooltip -------------------------------------------------------------

function HoverTooltip({ tip, theme }) {
  if (!tip) return null;
  // Positioned via the parent container's coordinate space. Offset a
  // few px from the cursor so the tooltip doesn't capture the same
  // mouseleave event (we set pointer-events: none below).
  return (
    <Box
      sx={{
        position: "absolute",
        left: tip.x + 12,
        top: tip.y + 12,
        pointerEvents: "none",
        background: theme.palette.background.paper,
        color: theme.palette.text.primary,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        boxShadow: 2,
        px: 1.25,
        py: 0.75,
        fontSize: 12,
        opacity: tip.visible ? 1 : 0,
        transition: "opacity 80ms ease",
        zIndex: 4,
        maxWidth: 260,
        whiteSpace: "nowrap",
      }}
    >
      <Box sx={{ fontWeight: 700 }}>{tip.facility_name || ""}</Box>
      <Box sx={{ color: "text.secondary" }}>{tip.category || ""}</Box>
      <Box sx={{ mt: 0.25 }}>{formatMt(tip.value)} MT CO2e</Box>
    </Box>
  );
}

// ----- Main export ---------------------------------------------------------

export default function EmissionsTreemap({
  rows = [],
  onCategoryClick = null,
  onReportingUnitClick = null,
  selection = null,
}) {
  const theme = useTheme();
  const data = React.useMemo(() => buildTreemapData(rows), [rows]);
  const containerRef = React.useRef(null);
  const [tip, setTip] = React.useState(null);

  // Clip-path ids must be unique per component instance so two
  // EmissionsTreemap mounts on the same page don't share clipping
  // regions. ``React.useId`` already gives us a stable per-instance
  // string.
  const reactId = React.useId();
  const clipIdBase = `tmcat${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const handleCellHover = React.useCallback((event, payload) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    // Clamp the tooltip's anchor inside the container's interior so the
    // outer ``overflow: hidden`` rule doesn't clip the floating box near
    // the right or bottom edge. The tooltip's own size is variable but
    // bounded by ``maxWidth: 260``; pad a few px past that to leave
    // breathing room.
    const TIP_OFFSET = 12;
    const TIP_MAX_W = 260;
    const TIP_MAX_H = 80;
    const rawX = event.clientX - containerRect.left;
    const rawY = event.clientY - containerRect.top;
    const maxX = Math.max(0, containerRect.width - TIP_MAX_W - TIP_OFFSET);
    const maxY = Math.max(0, containerRect.height - TIP_MAX_H - TIP_OFFSET);
    const x = Math.min(rawX, maxX);
    const y = Math.min(rawY, maxY);
    setTip({ ...payload, x, y, visible: true });
  }, []);

  const handleCellLeave = React.useCallback(() => {
    // Hide rather than null-out so the opacity transition fires;
    // cleared on next hover.
    setTip((prev) => (prev ? { ...prev, visible: false } : prev));
  }, []);

  if (!data.length) {
    return (
      <Typography color="text.secondary">
        No CO2e data to render in the treemap yet. Enter activities and calculate to populate.
      </Typography>
    );
  }

  const grandTotal = data.reduce((sum, ru) => sum + (ru.value || 0), 0);
  // Floor each share at a small minimum so tiny RUs still render a
  // visible header. 4% of the container is enough to fit ~10 chars of
  // "Reporting Unit X" header text without overflowing too aggressively.
  const MIN_SHARE_PCT = 4;
  const rawShares = data.map((ru) =>
    grandTotal > 0 ? Math.max((ru.value / grandTotal) * 100, MIN_SHARE_PCT) : 100 / data.length,
  );
  const shareTotal = rawShares.reduce((s, v) => s + v, 0);
  const shares = rawShares.map((v) => (v / shareTotal) * 100);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        width: "100%",
        height: 380,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      {data.map((ru, idx) => (
        <ReportingUnitColumn
          key={ru.facility_id || ru.name || idx}
          ru={ru}
          flexBasisPct={shares[idx]}
          onCategoryClick={onCategoryClick}
          onReportingUnitClick={onReportingUnitClick}
          selection={selection}
          theme={theme}
          onCellHover={handleCellHover}
          onCellLeave={handleCellLeave}
          clipIdPrefix={`${clipIdBase}-${idx}`}
        />
      ))}
      <HoverTooltip tip={tip} theme={theme} />
    </Box>
  );
}
