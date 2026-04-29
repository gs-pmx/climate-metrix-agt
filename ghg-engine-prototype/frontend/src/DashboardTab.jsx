import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CoverageWidget from "./CoverageWidget";
import {
  filterRows,
  listCategoryOptions,
  listReportingUnitOptions,
} from "./dashboard/analyticsState.js";
import { buildAnalyticsEnvelope } from "./dashboard/dashboardAnalytics.js";
import AnalyticsKpiCards from "./dashboard/AnalyticsKpiCards.jsx";
import ScopeStackBar from "./dashboard/ScopeStackBar.jsx";
import EmissionsTreemap from "./dashboard/EmissionsTreemap.jsx";
import TopReportingUnitsBar from "./dashboard/TopReportingUnitsBar.jsx";
import TopContributorsTable from "./dashboard/TopContributorsTable.jsx";

// Dashboard tab — Option-B refactor.
//
// Phase D3 originally fetched analytics from
// ``GET /projects/{id}/analytics``, which reads from the canonical
// ``calculation_results`` table populated only on snapshot save.
// That made saving the implicit trigger for "the dashboard reflects
// my latest calc", which was a UX trap (calc + save ≠ calc, but the
// user expectation was just calc).
//
// We now derive the analytics rows from the in-memory ``resultRows``
// React state — the same source the Results tab renders from — so
// the dashboard updates whenever the calc state in App.jsx updates,
// independent of any persistence event. The ``/analytics`` endpoint
// stays around for future cross-version queries (compare v3 to v5,
// PDF export, etc.) but isn't on the live-display hot path.
//
// Filter state is local to this tab. Default = no filters (all data).
// Scope chips are multi-select (all selected by default = all rows
// pass). RU and Category are single-select dropdowns with an "All"
// option (encoded as "" so the filter helper short-circuits).
//
// Selection (post-D3 polish): a click on a treemap cell or RU bar
// sets a "selection" — a fine-grained highlight that emphasizes the
// chosen item across every chart while keeping the rest of the
// (filter-narrowed) data visible but dimmed. PowerBI cross-filter
// pattern; filters and selection coexist.
//   - Filters reduce which rows are visible (coarse).
//   - Selection highlights a slice within the filtered rows (fine).

const SCOPE_OPTIONS = ["Scope 1", "Scope 2", "Scope 3"];

// Are two selection objects equivalent? Used to implement toggle
// behavior — clicking the same cell twice clears the selection.
function selectionEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.facility_id === b.facility_id &&
    (a.category || "") === (b.category || "")
  );
}

export default function DashboardTab({
  projectId = "",
  resultRows = [],
  activityTypesById = {},
  coverage = null,
  coverageSummaryText = "",
  activityLabelById = {},
  onJumpToActivityInputs = null,
}) {
  const analytics = React.useMemo(
    () => buildAnalyticsEnvelope(resultRows, activityTypesById),
    [resultRows, activityTypesById],
  );

  // Filter state — default to "All scopes" (Set with all three) and
  // empty single-selects.
  const [selectedScopes, setSelectedScopes] = React.useState(
    () => new Set(SCOPE_OPTIONS),
  );
  const [selectedRu, setSelectedRu] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  // Selection (highlight) state. ``null`` = nothing highlighted.
  // Populated only by chart-click handlers; filter chips and dropdowns
  // do NOT touch this so the two states stay independent.
  const [selection, setSelection] = React.useState(null);

  // Reset filters whenever the active project changes so we don't
  // carry over a stale RU id that doesn't exist in the new project.
  React.useEffect(() => {
    setSelectedScopes(new Set(SCOPE_OPTIONS));
    setSelectedRu("");
    setSelectedCategory("");
    setSelection(null);
  }, [projectId]);

  const allRows = analytics?.rows || [];
  const hasResults = allRows.length > 0;
  const filters = React.useMemo(
    () => ({
      scopes:
        selectedScopes.size === SCOPE_OPTIONS.length
          ? null // all selected = no filter
          : selectedScopes,
      reportingUnitId: selectedRu,
      category: selectedCategory,
    }),
    [selectedScopes, selectedRu, selectedCategory],
  );
  const filteredRows = React.useMemo(
    () => filterRows(allRows, filters),
    [allRows, filters],
  );

  const ruOptions = React.useMemo(
    () => listReportingUnitOptions(allRows),
    [allRows],
  );
  const categoryOptions = React.useMemo(
    () => listCategoryOptions(allRows),
    [allRows],
  );

  // Drop a stale selection if its target row is no longer in the
  // filtered set — e.g. the user filtered by Scope 1 and the selected
  // facility/category had only Scope 2 data.
  React.useEffect(() => {
    if (!selection) return;
    const stillVisible = filteredRows.some(
      (r) =>
        r.facility_id === selection.facility_id &&
        (!selection.category || r.category === selection.category),
    );
    if (!stillVisible) setSelection(null);
  }, [filteredRows, selection]);

  const toggleScope = React.useCallback((scope) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
        if (next.size === 0) {
          // Empty set = nothing matches. Snap back to "All" so the user
          // never sees an empty dashboard from a chip-toggle.
          return new Set(SCOPE_OPTIONS);
        }
        return next;
      }
      next.add(scope);
      return next;
    });
  }, []);

  const setAllScopes = React.useCallback(() => {
    setSelectedScopes(new Set(SCOPE_OPTIONS));
  }, []);

  // Click handlers now toggle the selection rather than mutating the
  // filter dropdowns (PowerBI-style cross-filtering). Re-clicking the
  // same cell clears the highlight.
  const toggleSelection = React.useCallback((next) => {
    setSelection((prev) => (selectionEquals(prev, next) ? null : next));
  }, []);

  const handleTreemapCategoryClick = React.useCallback(
    ({ facility_id, category }) => {
      if (!facility_id) return;
      toggleSelection({ facility_id, category: category || undefined });
    },
    [toggleSelection],
  );

  const handleTreemapRuClick = React.useCallback(
    (facility_id) => {
      if (!facility_id) return;
      toggleSelection({ facility_id });
    },
    [toggleSelection],
  );

  const handleRuBarClick = React.useCallback(
    (facility_id) => {
      if (!facility_id) return;
      toggleSelection({ facility_id });
    },
    [toggleSelection],
  );

  const clearSelection = React.useCallback(() => {
    setSelection(null);
  }, []);

  // Table row click joins the highlight model — clicking toggles the
  // (facility, category) selection just like clicking a treemap leaf.
  // Audit is the auditor deliverable, not a dashboard drill-target;
  // analysis stays self-contained on this surface.
  const handleTableRowClick = React.useCallback(
    ({ facility_id, category }) => {
      toggleSelection({ facility_id, category: category || undefined });
    },
    [toggleSelection],
  );

  // Look up the facility name from the analytics rows so the breadcrumb
  // shows the human-readable label rather than the id.
  const selectionLabel = React.useMemo(() => {
    if (!selection) return "";
    const row = allRows.find((r) => r.facility_id === selection.facility_id);
    const facilityName =
      row?.facility_name || selection.facility_id;
    return selection.category
      ? `${facilityName} — ${selection.category}`
      : facilityName;
  }, [selection, allRows]);

  return (
    <Stack spacing={2}>
      {/*
        Phase D2 — Source Coverage widget. Stays at the top so
        completeness lands before the user drops into emissions totals.
      */}
      <CoverageWidget
        coverage={coverage}
        activityLabelById={activityLabelById}
        summaryText={coverageSummaryText}
        onViewMissing={onJumpToActivityInputs ? () => onJumpToActivityInputs() : null}
      />

      {hasResults ? (
        <>
          {/*
            Selection breadcrumb — only visible when a chart click has
            populated the selection. Filter chips and dropdowns sit
            below; the breadcrumb lets the user clear the highlight
            without hunting for it.
          */}
          {selection ? (
            <Paper
              variant="outlined"
              sx={{
                px: 1.5,
                py: 0.75,
                display: "flex",
                alignItems: "center",
                gap: 1,
                bgcolor: (theme) => theme.palette.action.hover,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Highlighted:
              </Typography>
              <Typography variant="body2" color="text.primary" sx={{ flexGrow: 1 }}>
                {selectionLabel}
              </Typography>
              <Button
                size="small"
                variant="text"
                startIcon={<CloseIcon fontSize="small" />}
                onClick={clearSelection}
              >
                Clear selection
              </Button>
            </Paper>
          ) : null}

          <AnalyticsKpiCards rows={filteredRows} coverage={coverage} />

          <Paper sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              alignItems={{ md: "center" }}
              flexWrap="wrap"
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                  Scope:
                </Typography>
                {SCOPE_OPTIONS.map((scope) => {
                  const active = selectedScopes.has(scope);
                  return (
                    <Chip
                      key={scope}
                      label={scope}
                      color={active ? "primary" : "default"}
                      variant={active ? "filled" : "outlined"}
                      size="small"
                      onClick={() => toggleScope(scope)}
                    />
                  );
                })}
                <Chip
                  label="All"
                  size="small"
                  variant="outlined"
                  onClick={setAllScopes}
                  disabled={selectedScopes.size === SCOPE_OPTIONS.length}
                />
              </Stack>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="dashboard-ru-filter-label">Reporting Unit</InputLabel>
                <Select
                  labelId="dashboard-ru-filter-label"
                  label="Reporting Unit"
                  value={selectedRu}
                  onChange={(e) => setSelectedRu(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  {ruOptions.map((opt) => (
                    <MenuItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="dashboard-category-filter-label">Category</InputLabel>
                <Select
                  labelId="dashboard-category-filter-label"
                  label="Category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  {categoryOptions.map((cat) => (
                    <MenuItem key={cat} value={cat}>
                      {cat}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {(selectedRu || selectedCategory || selectedScopes.size !== SCOPE_OPTIONS.length) ? (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    setSelectedScopes(new Set(SCOPE_OPTIONS));
                    setSelectedRu("");
                    setSelectedCategory("");
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Emissions by Scope
            </Typography>
            <ScopeStackBar rows={filteredRows} selection={selection} />
          </Paper>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
              alignItems: "stretch",
            }}
          >
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Emissions Treemap (Reporting Unit by Category)
              </Typography>
              <EmissionsTreemap
                rows={filteredRows}
                onCategoryClick={handleTreemapCategoryClick}
                onReportingUnitClick={handleTreemapRuClick}
                selection={selection}
              />
            </Paper>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Top Reporting Units (Scope-Stacked)
              </Typography>
              <TopReportingUnitsBar
                rows={filteredRows}
                onBarClick={handleRuBarClick}
                selection={selection}
              />
            </Paper>
          </Box>

          <Paper sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1">Top Contributors</Typography>
              <Typography variant="body2" color="text.secondary">
                Click a row to highlight it and its share across the other charts.
              </Typography>
            </Stack>
            <TopContributorsTable
              rows={filteredRows}
              onRowClick={handleTableRowClick}
              selection={selection}
            />
          </Paper>
        </>
      ) : null}

      {!hasResults ? (
        <Alert severity="info">
          Run a calculation to populate the dashboard. The dashboard
          reflects the latest in-memory results — no save step required.
        </Alert>
      ) : null}
    </Stack>
  );
}
