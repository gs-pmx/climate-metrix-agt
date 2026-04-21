import * as React from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Container,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid, useGridApiContext } from "@mui/x-data-grid";
import { api } from "./api";
import { EMPTY_ACTIVITY, uid, normalizeActivityForSubmit } from "./constants";
import ActivityInputsPanel from "./ActivityInputsPanel";

const US_STATE_OPTIONS = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "District of Columbia",
];

const EGRID_SUBREGION_OPTIONS = [
  "AKGD",
  "AKMS",
  "AZNM",
  "CAMX",
  "ERCT",
  "FRCC",
  "HIMS",
  "HIOA",
  "MROE",
  "MROW",
  "NEWE",
  "NWPP",
  "NYCW",
  "NYLI",
  "NYUP",
  "RFCE",
  "RFCM",
  "RFCW",
  "RMPA",
  "SPNO",
  "SPSO",
  "SRMV",
  "SRMW",
  "SRSO",
  "SRTV",
  "SRVC",
];

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

const EMPTY_FACILITY = {
  id: "",
  facility_name: "",
  location: "",
  region: "",
  country: "US",
  state: "",
  egrid_subregion: "",
  reporting_group: "",
  owned_leased: "Owned",
};

function useSnack() {
  const [snack, setSnack] = React.useState({ open: false, msg: "", sev: "success" });
  const show = React.useCallback((msg, sev = "success") => setSnack({ open: true, msg, sev }), []);
  const close = React.useCallback(() => setSnack((s) => ({ ...s, open: false })), []);
  return { snack, show, close };
}

function groupByFacility(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.facility_id]) grouped[row.facility_id] = [];
    grouped[row.facility_id].push(row);
  }
  return grouped;
}

function ensureRowsWithIds(rows, makeRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ ...makeRow(), id: uid() }];
  }
  return rows.map((row) => ({ ...row, id: row.id || uid() }));
}

function formatTimestamp(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function toMetricTons(value, unit = "kg") {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(unit || "").toLowerCase().trim();
  if (u === "kg" || u === "kilogram" || u === "kilograms") return n / 1000;
  if (u === "g" || u === "gram" || u === "grams") return n / 1_000_000;
  if (u === "metric ton" || u === "metric tons" || u === "tonne" || u === "tonnes" || u === "t") return n;
  return n / 1000;
}

function toMetricTonFactor(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || !unit || !String(unit).includes("/")) return { value: null, unit: "" };
  const [numeratorRaw, denominatorRaw] = String(unit).split("/", 2).map((x) => x.trim());
  const numerator = numeratorRaw.toLowerCase();
  let mtValue = null;
  if (["kg", "kilogram", "kilograms"].includes(numerator)) mtValue = n / 1000;
  else if (["g", "gram", "grams"].includes(numerator)) mtValue = n / 1_000_000;
  else if (["metric ton", "metric tons", "tonne", "tonnes", "t"].includes(numerator)) mtValue = n;
  return {
    value: mtValue,
    unit: mtValue == null ? "" : `metric ton/${denominatorRaw}`,
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

function GridAutocompleteEditCell(props) {
  const { id, field, value, hasFocus, options, normalizeValue } = props;
  const apiRef = useGridApiContext();
  const inputRef = React.useRef(null);
  const safeValue = typeof value === "string" ? value : "";

  React.useEffect(() => {
    if (hasFocus) {
      inputRef.current?.focus();
    }
  }, [hasFocus]);

  const toCellValue = React.useCallback(
    (nextRawValue) => {
      const normalized = normalizeValue ? normalizeValue(nextRawValue) : nextRawValue;
      apiRef.current.setEditCellValue({ id, field, value: normalized });
    },
    [apiRef, field, id, normalizeValue],
  );

  return (
    <Autocomplete
      freeSolo
      fullWidth
      options={options}
      value={safeValue}
      inputValue={safeValue}
      autoHighlight
      blurOnSelect
      selectOnFocus
      clearOnBlur={false}
      filterOptions={(opts, state) =>
        opts.filter((opt) => opt.toLowerCase().startsWith(state.inputValue.toLowerCase()))
      }
      onChange={(_, nextValue) => {
        const raw = typeof nextValue === "string" ? nextValue : nextValue || "";
        toCellValue(raw);
      }}
      onInputChange={(_, nextInputValue, reason) => {
        if (reason === "reset") return;
        toCellValue(nextInputValue);
      }}
      renderInput={(params) => <TextField {...params} variant="standard" inputRef={inputRef} />}
    />
  );
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
  const maxValue = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  const barWidth = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => maxValue * k);

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
        {rows.map((row, idx) => {
          const value = Number(row.value || 0);
          const h = (value / maxValue) * plotHeight;
          const x = padding.left + idx * barWidth + barWidth * 0.12;
          const y = height - padding.bottom - h;
          const w = barWidth * 0.76;
          const color = DATA_VIZ_COLORS.categorical[idx % DATA_VIZ_COLORS.categorical.length];
          return (
            <g key={row.id}>
              <rect x={x} y={y} width={w} height={h} fill={color} rx="4">
                <title>
                  {`${row.source_label}: ${formatNumber(value)} MTCO2e`}
                </title>
              </rect>
              <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="currentColor">
                {formatNumber(value)}
              </text>
              <text x={x + w / 2} y={height - padding.bottom + 14} textAnchor="middle" fontSize="10" fill="currentColor">
                {wrapText(row.source_label, 12).split("\n")[0]}
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
  const total = rows.reduce((acc, r) => acc + Number(r.value || 0), 0);
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
        {rows.map((row, idx) => {
          const value = Number(row.value || 0);
          const fraction = total > 0 ? value / total : 0;
          const dash = fraction * circumference;
          const color = DATA_VIZ_COLORS.categorical[idx % DATA_VIZ_COLORS.categorical.length];
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
        {rows.map((row, idx) => (
          <Stack key={row.id} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: "2px", bgcolor: DATA_VIZ_COLORS.categorical[idx % DATA_VIZ_COLORS.categorical.length] }} />
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
    return <Typography color="text.secondary">No CO2e facility/source data available yet.</Typography>;
  }
  const width = 900;
  const height = 360;
  const facilityMap = {};
  for (const row of rows) {
    const facility = row.facility_name || row.facility_id || "Unknown";
    const source = row.source_label || row.source_id || "Unknown";
    const value = Number(row.value || 0);
    if (!facilityMap[facility]) facilityMap[facility] = {};
    facilityMap[facility][source] = (facilityMap[facility][source] || 0) + value;
  }
  const facilities = Object.entries(facilityMap).map(([facility, bySource]) => {
    const sources = Object.entries(bySource).map(([source, value]) => ({ source, value }));
    const total = sources.reduce((acc, s) => acc + s.value, 0);
    return { facility, sources, total };
  });
  const total = facilities.reduce((acc, f) => acc + f.total, 0) || 1;
  let xCursor = 0;

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Treemap by facility and source">
        {facilities.map((facility, fIdx) => {
          const w = (facility.total / total) * width;
          let yCursor = 0;
          const x0 = xCursor;
          xCursor += w;
          return (
            <g key={facility.facility}>
              {facility.sources.map((src, sIdx) => {
                const h = facility.total > 0 ? (src.value / facility.total) * height : 0;
                const y0 = yCursor;
                yCursor += h;
                const color = DATA_VIZ_COLORS.categorical[(fIdx + sIdx) % DATA_VIZ_COLORS.categorical.length];
                return (
                  <g key={`${facility.facility}-${src.source}`}>
                    <rect x={x0} y={y0} width={w} height={h} fill={color} fillOpacity="0.78" stroke="#ffffff" strokeWidth="1" />
                    <title>{`${facility.facility} | ${src.source}: ${formatNumber(src.value)} MTCO2e`}</title>
                    {w > 80 && h > 44 ? (
                      <>
                        <text x={x0 + 6} y={y0 + 16} fontSize="11" fill="#ffffff" fontWeight="700">
                          {facility.facility}
                        </text>
                        <text x={x0 + 6} y={y0 + 30} fontSize="10" fill="#ffffff">
                          {wrapText(src.source, 20).split("\n")[0]}
                        </text>
                        <text x={x0 + 6} y={y0 + 42} fontSize="10" fill="#ffffff">
                          {formatNumber(src.value)} MTCO2e
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

export default function App({ colorMode = "light", onToggleColorMode = () => {} }) {
  const { snack, show, close } = useSnack();
  const [tab, setTab] = React.useState(0);
  const [routing, setRouting] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [projectVersions, setProjectVersions] = React.useState([]);
  const [activeProjectId, setActiveProjectId] = React.useState("");
  const [projectNameDraft, setProjectNameDraft] = React.useState("");
  const [projectRenameDraft, setProjectRenameDraft] = React.useState("");
  const [versionNote, setVersionNote] = React.useState("");
  const [projectBusy, setProjectBusy] = React.useState(false);
  const [facilities, setFacilities] = React.useState([{ ...EMPTY_FACILITY, id: uid(), facility_name: "Facility 1" }]);
  const [activities, setActivities] = React.useState([{ ...EMPTY_ACTIVITY, id: uid() }]);
  const [inventoryYear, setInventoryYear] = React.useState(String(new Date().getFullYear()));
  const [gwpSet, setGwpSet] = React.useState("AR6");
  const [includeTrace, setIncludeTrace] = React.useState(true);
  const [calculating, setCalculating] = React.useState(false);
  const [resultRows, setResultRows] = React.useState([]);
  const [summaryRows, setSummaryRows] = React.useState([]);
  const [traceRows, setTraceRows] = React.useState([]);
  const [auditRows, setAuditRows] = React.useState([]);
  const [routingError, setRoutingError] = React.useState("");
  const [projectError, setProjectError] = React.useState("");
  const [schemaInfo, setSchemaInfo] = React.useState(null);

  const facilityEditableFields = React.useMemo(
    () => [
      "facility_name",
      "location",
      "region",
      "country",
      "state",
      "egrid_subregion",
      "reporting_group",
      "owned_leased",
    ],
    [],
  );

  const hasActiveProject = Boolean(activeProjectId);
  const activeProject = React.useMemo(
    () => projects.find((p) => p.project_id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const routingById = React.useMemo(() => Object.fromEntries(routing.map((r) => [r.source_id, r])), [routing]);
  const sourceLabelById = React.useMemo(
    () => Object.fromEntries(routing.map((r) => [r.source_id, r.label || r.source_type || r.source_id])),
    [routing],
  );
  const facilityNameById = React.useMemo(
    () => Object.fromEntries(facilities.map((f) => [f.id, f.facility_name || f.id])),
    [facilities],
  );
  const sourceOptions = React.useMemo(
    () => routing.map((r) => ({ value: r.source_id, label: r.label || r.source_type })),
    [routing],
  );
  const facilityOptions = React.useMemo(
    () => facilities.map((f) => ({ value: f.id, label: f.facility_name || f.id })),
    [facilities],
  );
  const co2eRows = React.useMemo(
    () =>
      resultRows
        .filter((r) => String(r.gas).toLowerCase() === "co2e")
        .map((r) => ({ ...r, value: toMetricTons(r.value, r.unit), unit: "metric ton" })),
    [resultRows],
  );
  const dashboardByFacilityRows = React.useMemo(() => {
    const byKey = {};
    for (const row of co2eRows) {
      const key = row.facility_name || row.facility_id || "Unknown";
      byKey[key] = (byKey[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(byKey)
      .map(([facility_name, value], i) => ({ id: `f_${i}`, facility_name, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);
  const dashboardByScopeRows = React.useMemo(() => {
    const byKey = {};
    for (const row of co2eRows) {
      const key = row.scope || "Unknown";
      byKey[key] = (byKey[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(byKey)
      .map(([scope, value], i) => ({ id: `s_${i}`, scope, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);
  const dashboardBySourceRows = React.useMemo(() => {
    const byKey = {};
    for (const row of co2eRows) {
      const key = row.source_label || row.source_id || "Unknown";
      byKey[key] = (byKey[key] || 0) + Number(row.value || 0);
    }
    return Object.entries(byKey)
      .map(([source_label, value], i) => ({ id: `src_${i}`, source_label, value }))
      .sort((a, b) => b.value - a.value);
  }, [co2eRows]);
  const totalCo2e = React.useMemo(
    () => co2eRows.reduce((acc, row) => acc + Number(row.value || 0), 0),
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
        label: "Top Facility",
        value: topFacility?.facility_name || "No data",
        detail:
          topFacility && totalCo2e > 0
            ? `${formatNumber(topFacility.value)} MTCO2e (${formatPercent((topFacility.value / totalCo2e) * 100)})`
            : "No facility totals yet",
      },
      {
        id: "source",
        label: "Top Source",
        value: topSource?.source_label || "No data",
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
        .map((row, i) => {
          const value = Number(row.value || 0);
          return {
            id: row.id || `dashboard_${i}`,
            facility_name: row.facility_name || facilityNameById[row.facility_id] || row.facility_id,
            source_label: row.source_label || sourceLabelById[row.source_id] || row.source_id,
            scope: row.scope || "Unknown",
            accounting_method: row.accounting_method || "",
            value,
            share_pct: totalCo2e > 0 ? (value / totalCo2e) * 100 : 0,
          };
        })
        .sort((a, b) => b.value - a.value),
    [co2eRows, facilityNameById, sourceLabelById, totalCo2e],
  );

  const refreshProjects = React.useCallback(async () => {
    const list = await api.listProjects();
    const rows = Array.isArray(list) ? list : [];
    setProjects(rows);
    return rows;
  }, []);

  const refreshVersions = React.useCallback(
    async (projectId) => {
      if (!projectId) {
        setProjectVersions([]);
        return [];
      }
      const rows = await api.listProjectVersions(projectId);
      const result = Array.isArray(rows) ? rows : [];
      setProjectVersions(result);
      return result;
    },
    [],
  );

  const applySnapshot = React.useCallback((payload) => {
    const snap = payload?.snapshot || {};
    setFacilities(ensureRowsWithIds(snap.facilities, () => ({ ...EMPTY_FACILITY })));
    setActivities(ensureRowsWithIds(snap.activities, () => ({ ...EMPTY_ACTIVITY })));
    setResultRows(
      (snap.result_rows || []).map((row, i) => ({
        id: row.id || `${i}`,
        ...row,
        value: toMetricTons(row.value, row.unit),
        unit: "metric ton",
      })),
    );
    setSummaryRows(
      (snap.summary_rows || []).map((row, i) => {
        const key = String(row.key || "");
        const parts = key.split("|");
        const unitFromKey = parts.length >= 5 ? parts[4] : "kg";
        if (parts.length >= 5) parts[4] = "metric ton";
        return {
          id: row.id || `${i}`,
          ...row,
          key: parts.length >= 5 ? parts.join("|") : key,
          value: toMetricTons(row.value, unitFromKey),
        };
      }),
    );
    setTraceRows((snap.trace_rows || []).map((row, i) => ({ id: row.id || `${i}`, ...row })));
    setAuditRows((snap.audit_rows || []).map((row, i) => ({ id: row.id || `a_${i}`, ...row })));
    setInventoryYear(String(payload?.inventory_year || snap.inventory_year || new Date().getFullYear()));
    setGwpSet(String(payload?.gwp_set || snap.gwp_set || "AR6"));
    setIncludeTrace(Boolean(payload?.include_trace ?? snap.include_trace ?? true));
  }, []);

  const loadLatestSnapshot = React.useCallback(
    async (projectId) => {
      if (!projectId) return;
      try {
        const payload = await api.getProjectSnapshot(projectId);
        applySnapshot(payload);
      } catch (e) {
        const msg = String(e?.message || e);
        if (!msg.includes("404")) {
          show(`Failed to load latest snapshot: ${msg}`, "error");
        }
      }
    },
    [applySnapshot, show],
  );

  const saveCurrentVersion = React.useCallback(
    async (note) => {
      if (!activeProjectId) {
        show("Create or select a project first.", "warning");
        return;
      }
      setProjectBusy(true);
      try {
        const saved = await api.saveProjectVersion(activeProjectId, {
          inventory_year: Number(inventoryYear),
          gwp_set: gwpSet,
          include_trace: includeTrace,
          facilities,
          activities,
          result_rows: resultRows,
          summary_rows: summaryRows,
          trace_rows: traceRows,
          audit_rows: auditRows,
          note: note || null,
        });
        await refreshVersions(activeProjectId);
        await refreshProjects();
        show(`Saved version v${saved.version_number}.`, "success");
      } catch (e) {
        show(`Save failed: ${e.message || e}`, "error");
      } finally {
        setProjectBusy(false);
      }
    },
    [
      activeProjectId,
      activities,
      auditRows,
      facilities,
      gwpSet,
      includeTrace,
      inventoryYear,
      refreshProjects,
      refreshVersions,
      resultRows,
      show,
      summaryRows,
      traceRows,
    ],
  );

  React.useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (hasActiveProject) saveCurrentVersion("Checkpoint (Ctrl+S).");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasActiveProject, saveCurrentVersion]);

  const selectProject = React.useCallback(
    async (projectId) => {
      setActiveProjectId(projectId);
      const p = projects.find((x) => x.project_id === projectId);
      if (p) {
        setInventoryYear(String(p.inventory_year));
        setProjectRenameDraft(p.name);
      }
      await refreshVersions(projectId);
      await loadLatestSnapshot(projectId);
    },
    [loadLatestSnapshot, projects, refreshVersions],
  );

  React.useEffect(() => {
    const loadRouting = async () => {
      try {
        const rows = await api.listRouting();
        if (!Array.isArray(rows)) {
          throw new Error("Routing API returned non-array payload.");
        }
        setRouting(rows);
        setRoutingError("");
      } catch (e) {
        setRouting([]);
        setRoutingError(String(e.message || e));
        show(`Failed to load sources: ${e.message}`, "error");
      }
    };
    loadRouting();
  }, [show]);

  React.useEffect(() => {
    let mounted = true;
    const loadProjectsAndSelect = async () => {
      try {
        const schema = await api.getSchemaMigrations();
        setSchemaInfo(schema);
        const rows = await refreshProjects();
        if (!mounted) return;
        setProjectError("");
        if (!activeProjectId && rows.length > 0) {
          const newest = rows[0];
          setActiveProjectId(newest.project_id);
          setInventoryYear(String(newest.inventory_year));
          setProjectRenameDraft(newest.name);
          await refreshVersions(newest.project_id);
          await loadLatestSnapshot(newest.project_id);
        }
      } catch (e) {
        if (!mounted) return;
        setProjectError(String(e.message || e));
        show(`Failed to load projects: ${e.message || e}`, "error");
      }
    };
    loadProjectsAndSelect();
    return () => {
      mounted = false;
    };
  }, [activeProjectId, loadLatestSnapshot, refreshProjects, refreshVersions, show]);

  const createProject = async () => {
    const cleanName = projectNameDraft.trim();
    const year = Number(inventoryYear);
    if (cleanName.length < 2) {
      show("Project name must be at least 2 characters.", "warning");
      return;
    }
    if (!Number.isFinite(year) || year < 1900 || year > 3000) {
      show("Inventory year must be between 1900 and 3000.", "warning");
      return;
    }
    setProjectBusy(true);
    try {
      const project = await api.createProject({ name: cleanName, inventory_year: year });
      setProjectNameDraft("");
      const initialFacilities = [{ ...EMPTY_FACILITY, id: uid(), facility_name: "Facility 1" }];
      const initialActivities = [{ ...EMPTY_ACTIVITY, id: uid() }];
      setFacilities(initialFacilities);
      setActivities(initialActivities);
      setResultRows([]);
      setSummaryRows([]);
      setTraceRows([]);
      setAuditRows([]);
      setActiveProjectId(project.project_id);
      setProjectRenameDraft(project.name);
      await api.saveProjectVersion(project.project_id, {
        inventory_year: year,
        gwp_set: gwpSet,
        include_trace: includeTrace,
        facilities: initialFacilities,
        activities: initialActivities,
        result_rows: [],
        summary_rows: [],
        trace_rows: [],
        audit_rows: [],
        note: "Initial project scaffold.",
      });
      await refreshProjects();
      await refreshVersions(project.project_id);
      await loadLatestSnapshot(project.project_id);
      show(`Project "${project.name}" created.`, "success");
    } catch (e) {
      show(`Project creation failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const renameActiveProject = async () => {
    if (!activeProjectId) return;
    const nextName = projectRenameDraft.trim();
    if (nextName.length < 2) {
      show("Project name must be at least 2 characters.", "warning");
      return;
    }
    setProjectBusy(true);
    try {
      await api.renameProject(activeProjectId, { name: nextName });
      const rows = await refreshProjects();
      const fresh = rows.find((p) => p.project_id === activeProjectId);
      if (fresh) {
        setProjectRenameDraft(fresh.name);
      }
      show("Project renamed.", "success");
    } catch (e) {
      show(`Project rename failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const deleteActiveProject = async () => {
    if (!activeProjectId) return;
    const approved = window.confirm("Delete this project and all saved versions? This cannot be undone.");
    if (!approved) return;
    setProjectBusy(true);
    try {
      await api.deleteProject(activeProjectId);
      setActiveProjectId("");
      setProjectRenameDraft("");
      setProjectVersions([]);
      setFacilities([{ ...EMPTY_FACILITY, id: uid(), facility_name: "Facility 1" }]);
      setActivities([{ ...EMPTY_ACTIVITY, id: uid() }]);
      setResultRows([]);
      setSummaryRows([]);
      setTraceRows([]);
      setAuditRows([]);
      const rows = await refreshProjects();
      if (rows.length > 0) {
        await selectProject(rows[0].project_id);
      }
      show("Project deleted.", "success");
    } catch (e) {
      show(`Project delete failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const downloadAuditCsv = () => {
    if (!auditRows.length) {
      show("No audit rows available to export.", "warning");
      return;
    }
    const exportRows = auditRows.map((row) => ({
      ...row,
      co2_result_mt: toMetricTons(row.co2_result_kg, "kg"),
      ch4_result_mt: toMetricTons(row.ch4_result_kg, "kg"),
      n2o_result_mt: toMetricTons(row.n2o_result_kg, "kg"),
      co2e_result_mt: toMetricTons(row.co2e_result_kg, "kg"),
      factor_co2_mt: toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).value,
      factor_co2_mt_unit: toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).unit,
      factor_ch4_mt: toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).value,
      factor_ch4_mt_unit: toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).unit,
      factor_n2o_mt: toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).value,
      factor_n2o_mt_unit: toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).unit,
    }));
    const cols = Object.keys(exportRows[0]).filter((k) => !["id", "co2_result_kg", "ch4_result_kg", "n2o_result_kg", "co2e_result_kg"].includes(k));
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = cols.join(",");
    const lines = exportRows.map((row) => cols.map((c) => esc(row[c])).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghg_audit_${activeProject?.name || "project"}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const addFacility = () => setFacilities((prev) => [...prev, { ...EMPTY_FACILITY, id: uid() }]);
  const processFacilityUpdate = (newRow) => {
    setFacilities((prev) => prev.map((r) => (r.id === newRow.id ? newRow : r)));
    return newRow;
  };

  const runCalculation = async () => {
    if (!hasActiveProject) {
      show("Create or select a project first.", "warning");
      setTab(0);
      return;
    }
    const rows = activities.filter((r) => r.facility_id && r.source_id && r.activity_value !== "");
    if (!rows.length) {
      show("Add at least one activity row with facility, source, and value.", "warning");
      return;
    }

    const grouped = groupByFacility(rows);
    const mergedResults = [];
    const mergedTrace = [];
    const mergedAudit = [];
    const summaryMap = {};
    setCalculating(true);
    try {
      for (const [facilityId, facilityRows] of Object.entries(grouped)) {
        const fac = facilities.find((f) => f.id === facilityId);
        const payload = {
          context: {
            inventory_year: Number(inventoryYear),
            gwp_set: gwpSet,
            include_trace: includeTrace,
            source_attributes: {
              region: fac?.region || undefined,
              country: fac?.country || undefined,
              state: fac?.state || undefined,
              egrid_subregion: fac?.egrid_subregion || undefined,
            },
          },
          activities: facilityRows.map((r) => ({
            ...(() => {
              const normalized = normalizeActivityForSubmit(r);
              return {
                activity: normalized.activity,
                params: normalized.params,
              };
            })(),
            facility_id: r.facility_id,
            source_id: r.source_id,
            source_type: r.source_type,
            scope: r.scope,
            metric_group: r.metric_group,
            metric_subgroup: r.metric_subgroup || null,
          })),
        };
        const response = await api.calculateAudit(payload);
        for (const rr of response.results || []) mergedResults.push(rr);
        for (const tr of response.trace || []) mergedTrace.push(tr);
        for (const ar of response.audit_rows || []) mergedAudit.push(ar);
        for (const [k, v] of Object.entries(response.summary || {})) {
          summaryMap[k] = (summaryMap[k] || 0) + Number(v);
        }
      }
      setResultRows(
        mergedResults.map((r, i) => ({
          id: `${i}`,
          ...r,
          value: toMetricTons(r.value, r.unit),
          unit: "metric ton",
          facility_name: facilityNameById[r.facility_id] || r.facility_id,
          source_label: sourceLabelById[r.source_id] || r.source_id,
        })),
      );
      setTraceRows(mergedTrace.map((r, i) => ({ id: `${i}`, ...r })));
      setAuditRows(
        mergedAudit.map((r, i) => ({
          id: `a_${i}`,
          ...r,
          facility_name: facilityNameById[r.facility_id] || r.facility_id,
          source_label: sourceLabelById[r.source_id] || r.source_id,
        })),
      );
      const metricTonSummary = {};
      for (const [key, value] of Object.entries(summaryMap)) {
        const parts = key.split("|");
        const unit = parts.length >= 5 ? parts[4] : "kg";
        if (parts.length >= 5) parts[4] = "metric ton";
        const nextKey = parts.length >= 5 ? parts.join("|") : key;
        metricTonSummary[nextKey] = (metricTonSummary[nextKey] || 0) + toMetricTons(value, unit);
      }
      setSummaryRows(Object.entries(metricTonSummary).map(([key, value], i) => ({ id: `${i}`, key, value })));
      setTab(3);
      show("Calculation complete", "success");
    } catch (e) {
      show(`Calculation failed: ${e.message}`, "error");
    } finally {
      setCalculating(false);
    }
  };

  const handleFacilityCellKeyDown = React.useCallback(
    (params, event) => {
      if (event.key !== "Tab") return;

      const rowIds =
        typeof params.api.getSortedRowIds === "function"
          ? params.api.getSortedRowIds()
          : facilities.map((f) => f.id);
      const rowIndex = rowIds.findIndex((rowId) => rowId === params.id);
      const fieldIndex = facilityEditableFields.indexOf(params.field);
      if (rowIndex < 0 || fieldIndex < 0) return;

      const isShiftTab = event.shiftKey;
      const atFirstCell = rowIndex === 0 && fieldIndex === 0;
      const atLastCell = rowIndex === rowIds.length - 1 && fieldIndex === facilityEditableFields.length - 1;
      if ((isShiftTab && atFirstCell) || (!isShiftTab && atLastCell)) {
        return;
      }

      event.preventDefault();
      event.defaultMuiPrevented = true;

      let nextRowIndex = rowIndex;
      let nextFieldIndex = fieldIndex;

      if (isShiftTab) {
        if (fieldIndex === 0) {
          nextRowIndex -= 1;
          nextFieldIndex = facilityEditableFields.length - 1;
        } else {
          nextFieldIndex -= 1;
        }
      } else if (fieldIndex === facilityEditableFields.length - 1) {
        nextRowIndex += 1;
        nextFieldIndex = 0;
      } else {
        nextFieldIndex += 1;
      }

      const nextRowId = rowIds[nextRowIndex];
      const nextField = facilityEditableFields[nextFieldIndex];
      if (nextRowId === undefined || !nextField) return;

      if (params.cellMode === "edit") {
        params.api.stopCellEditMode({ id: params.id, field: params.field });
      }
      params.api.setCellFocus(nextRowId, nextField);
      params.api.startCellEditMode({ id: nextRowId, field: nextField });
    },
    [facilities, facilityEditableFields],
  );

  const facilityColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Facility Name", flex: 1, editable: true },
      { field: "location", headerName: "Location", flex: 1, editable: true },
      { field: "region", headerName: "Region", flex: 0.7, editable: true },
      { field: "country", headerName: "Country", flex: 0.6, editable: true },
      {
        field: "state",
        headerName: "State",
        flex: 0.6,
        editable: true,
        renderEditCell: (params) => <GridAutocompleteEditCell {...params} options={US_STATE_OPTIONS} />,
      },
      {
        field: "egrid_subregion",
        headerName: "eGRID Subregion",
        flex: 0.8,
        editable: true,
        renderEditCell: (params) => (
          <GridAutocompleteEditCell
            {...params}
            options={EGRID_SUBREGION_OPTIONS}
            normalizeValue={(v) => String(v || "").toUpperCase()}
          />
        ),
      },
      { field: "reporting_group", headerName: "Group", flex: 0.6, editable: true },
      {
        field: "owned_leased",
        headerName: "Owned/Leased",
        flex: 0.7,
        editable: true,
        type: "singleSelect",
        valueOptions: ["Owned", "Leased"],
      },
    ],
    [],
  );

  const resultColumns = [
    {
      field: "facility_name",
      headerName: "Facility",
      flex: 1,
      valueGetter: (_, row) => row.facility_name || facilityNameById[row.facility_id] || row.facility_id,
    },
    {
      field: "source_label",
      headerName: "Source",
      flex: 1,
      valueGetter: (_, row) => row.source_label || sourceLabelById[row.source_id] || row.source_id,
    },
    { field: "scope", headerName: "Scope", flex: 0.6 },
    { field: "accounting_method", headerName: "Accounting", flex: 0.8 },
    { field: "gas", headerName: "Gas", flex: 0.4 },
    { field: "value", headerName: "Value", type: "number", flex: 0.7, valueFormatter: (value) => formatNumber(value) },
    { field: "unit", headerName: "Unit", flex: 0.4 },
  ];
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
  const dashboardTableColumns = React.useMemo(
    () => [
      { field: "facility_name", headerName: "Facility", flex: 0.95, minWidth: 160, renderCell: renderWrappedCell },
      { field: "source_label", headerName: "Source", flex: 1.1, minWidth: 180, renderCell: renderWrappedCell },
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
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <Paper sx={{ mb: 2, p: { xs: 2, md: 2.5 } }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
          <Box>
            <Typography variant="h4">GHG Calculation Workspace</Typography>
            <Typography variant="body2" color="text.secondary">
              Project-based data entry with immutable version snapshots.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {activeProject ? <Chip color="secondary" label={`Project: ${activeProject.name}`} /> : null}
            <Button variant="outlined" onClick={onToggleColorMode}>
              {colorMode === "dark" ? "Use Light Mode" : "Use Dark Mode"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ mb: 2, px: 1.5, pt: 0.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Projects" />
          <Tab label="Facilities" disabled={!hasActiveProject} />
          <Tab label="Activity Inputs" disabled={!hasActiveProject} />
          <Tab label="Results" disabled={!hasActiveProject} />
          <Tab label="Dashboard" disabled={!hasActiveProject} />
          <Tab label="Audit" disabled={!hasActiveProject} />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6">Project Setup</Typography>
              <Typography variant="body2" color="text.secondary">
                Enter project name and inventory year, then save snapshots as your data evolves.
              </Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
                <TextField
                  label="Project Name"
                  placeholder="2026 Corporate Inventory"
                  value={projectNameDraft}
                  onChange={(e) => setProjectNameDraft(e.target.value)}
                  sx={{ minWidth: 280 }}
                />
                <TextField
                  label="Current Inventory Year"
                  value={inventoryYear}
                  onChange={(e) => setInventoryYear(e.target.value)}
                  sx={{ width: 220 }}
                />
                <Button variant="contained" onClick={createProject} disabled={projectBusy}>
                  Create Project
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }}>
                <Select
                  displayEmpty
                  value={activeProjectId}
                  onChange={(e) => selectProject(e.target.value)}
                  sx={{ minWidth: 330 }}
                >
                  <MenuItem value="">
                    <em>Select Existing Project</em>
                  </MenuItem>
                  {projects.map((p) => (
                    <MenuItem key={p.project_id} value={p.project_id}>
                      {p.name} (v{p.latest_version})
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  label="Version Note (optional)"
                  placeholder="Updated electricity usage and refrigerants."
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  sx={{ minWidth: 300, flexGrow: 1 }}
                />
                <Button variant="outlined" disabled={!hasActiveProject || projectBusy} onClick={() => saveCurrentVersion(versionNote)}>
                  Save Snapshot
                </Button>
                <Button
                  variant="outlined"
                  disabled={!hasActiveProject || projectBusy}
                  onClick={async () => {
                    await loadLatestSnapshot(activeProjectId);
                    show("Loaded latest snapshot.", "success");
                  }}
                >
                  Load Latest
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }}>
                <TextField
                  label="Rename Active Project"
                  value={projectRenameDraft}
                  onChange={(e) => setProjectRenameDraft(e.target.value)}
                  sx={{ minWidth: 330 }}
                  disabled={!hasActiveProject}
                />
                <Button variant="outlined" disabled={!hasActiveProject || projectBusy} onClick={renameActiveProject}>
                  Rename
                </Button>
                <Button variant="outlined" color="error" disabled={!hasActiveProject || projectBusy} onClick={deleteActiveProject}>
                  Delete Project
                </Button>
              </Stack>
              {projectError ? <Alert severity="error">{projectError}</Alert> : null}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Version History
            </Typography>
            {schemaInfo ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                SQLite schema version: v{schemaInfo.current_version}
              </Typography>
            ) : null}
            {projectVersions.length === 0 ? (
              <Typography color="text.secondary">No versions saved yet.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Version</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Inventory Year</TableCell>
                      <TableCell>GWP</TableCell>
                      <TableCell>Trace</TableCell>
                      <TableCell>Note</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projectVersions.map((v) => (
                      <TableRow key={v.version_id}>
                        <TableCell>v{v.version_number}</TableCell>
                        <TableCell>{formatTimestamp(v.created_at)}</TableCell>
                        <TableCell>{v.inventory_year}</TableCell>
                        <TableCell>{v.gwp_set}</TableCell>
                        <TableCell>{v.include_trace ? "Yes" : "No"}</TableCell>
                        <TableCell>{v.note || "-"}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            onClick={async () => {
                              try {
                                const payload = await api.getProjectSnapshot(activeProjectId, v.version_number);
                                applySnapshot(payload);
                                show(`Loaded version v${v.version_number}.`, "success");
                              } catch (e) {
                                show(`Failed to load version: ${e.message || e}`, "error");
                              }
                            }}
                          >
                            Load
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>
      )}

      {tab === 1 && hasActiveProject && (
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">Facilities (with Geo Context)</Typography>
            <Button variant="contained" onClick={addFacility}>
              Add Facility
            </Button>
          </Stack>
          <Box sx={{ height: 520 }}>
            <DataGrid
              rows={facilities}
              columns={facilityColumns}
              processRowUpdate={processFacilityUpdate}
              onProcessRowUpdateError={() => {}}
              onCellKeyDown={handleFacilityCellKeyDown}
              disableRowSelectionOnClick
            />
          </Box>
        </Paper>
      )}

      {tab === 2 && hasActiveProject && (
        <ActivityInputsPanel
          activities={activities}
          setActivities={setActivities}
          facilities={facilities}
          routing={routing}
          routingById={routingById}
          facilityOptions={facilityOptions}
          sourceOptions={sourceOptions}
          inventoryYear={inventoryYear}
          setInventoryYear={setInventoryYear}
          gwpSet={gwpSet}
          setGwpSet={setGwpSet}
          includeTrace={includeTrace}
          setIncludeTrace={setIncludeTrace}
          runCalculation={runCalculation}
          calculating={calculating}
          saveCurrentVersion={saveCurrentVersion}
          routingError={routingError}
          show={show}
        />
      )}

      {tab === 3 && hasActiveProject && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">Results</Typography>
              <Button variant="outlined" onClick={() => saveCurrentVersion("Saved with calculated results.")}>
                Save Results Snapshot
              </Button>
            </Stack>
            <Box sx={{ height: 420 }}>
              <DataGrid rows={resultRows} columns={resultColumns} disableRowSelectionOnClick />
            </Box>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Summary Totals
            </Typography>
            <Box sx={{ height: 240 }}>
              <DataGrid
                rows={summaryRows}
                columns={[
                  { field: "key", headerName: "Key", flex: 1.5 },
                  { field: "value", headerName: "Value (metric tons)", type: "number", flex: 0.5, valueFormatter: (value) => formatNumber(value) },
                ]}
                disableRowSelectionOnClick
              />
            </Box>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Trace
            </Typography>
            <Box sx={{ maxHeight: 220, overflow: "auto", background: "rgba(0,0,0,0.04)", borderRadius: 1, p: 1 }}>
              <pre style={{ margin: 0 }}>{JSON.stringify(traceRows, null, 2)}</pre>
            </Box>
          </Paper>
        </Stack>
      )}

      {tab === 4 && hasActiveProject && (
        <Stack spacing={2}>
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
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Emissions by Source (Column Chart)
            </Typography>
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
                Emissions by Facility and Source (Treemap)
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
      )}

      {tab === 5 && hasActiveProject && (
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6">Audit Pathway</Typography>
            <Button variant="outlined" onClick={downloadAuditCsv}>
              Export Audit CSV
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Linear audit rows by facility and source with inputs, selected factors, conversions, and gas-level outputs.
          </Typography>
          <Box sx={{ height: 560 }}>
            <DataGrid
              rows={auditRows}
              columns={[
                {
                  field: "facility_name",
                  headerName: "Facility",
                  flex: 0.85,
                  valueGetter: (_, row) => row.facility_name || facilityNameById[row.facility_id] || row.facility_id,
                  renderCell: renderWrappedCell,
                },
                {
                  field: "source_label",
                  headerName: "Source",
                  flex: 1.1,
                  valueGetter: (_, row) => row.source_label || sourceLabelById[row.source_id] || row.source_id,
                  renderCell: renderWrappedCell,
                },
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
              ]}
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
      )}

      {!hasActiveProject && tab !== 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          Create or select a project in the Projects tab to unlock data entry and calculation tabs.
        </Alert>
      ) : null}

      <Snackbar open={snack.open} autoHideDuration={2600} onClose={close}>
        <Alert severity={snack.sev} onClose={close} variant="filled">
          {snack.msg}
        </Alert>
      </Snackbar>
    </Container>
  );
}
