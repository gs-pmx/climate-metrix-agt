import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import CoverageWidget from "./CoverageWidget";
import { api, ApiError } from "./api";
import {
  filterRows,
  listCategoryOptions,
  listReportingUnitOptions,
} from "./dashboard/analyticsState.js";
import AnalyticsKpiCards from "./dashboard/AnalyticsKpiCards.jsx";
import ScopeStackBar from "./dashboard/ScopeStackBar.jsx";
import EmissionsTreemap from "./dashboard/EmissionsTreemap.jsx";
import TopReportingUnitsBar from "./dashboard/TopReportingUnitsBar.jsx";
import TopContributorsTable from "./dashboard/TopContributorsTable.jsx";

// Phase D3 dashboard. Loads analytics from the backend on mount + when
// the active version changes; computes filter views client-side from
// the pre-aggregated rows so flipping a chip / dropdown is instant.
//
// Filter state is local to this tab. Default = no filters (all data).
// Scope chips are multi-select (all selected by default = all rows
// pass). RU and Category are single-select dropdowns with an "All"
// option (encoded as "" so the filter helper short-circuits).

const SCOPE_OPTIONS = ["Scope 1", "Scope 2", "Scope 3"];

export default function DashboardTab({
  projectId = "",
  versionId = null,
  coverage = null,
  coverageSummaryText = "",
  activityLabelById = {},
  onJumpToActivityInputs = null,
  onJumpToAudit = null,
}) {
  const [analytics, setAnalytics] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  // Filter state — default to "All scopes" (Set with all three) and
  // empty single-selects.
  const [selectedScopes, setSelectedScopes] = React.useState(
    () => new Set(SCOPE_OPTIONS),
  );
  const [selectedRu, setSelectedRu] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");

  // Reset filters whenever the project / version changes so we don't
  // carry over a stale RU id that doesn't exist in the new payload.
  React.useEffect(() => {
    setSelectedScopes(new Set(SCOPE_OPTIONS));
    setSelectedRu("");
    setSelectedCategory("");
  }, [projectId, versionId]);

  React.useEffect(() => {
    if (!projectId) {
      setAnalytics(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const payload = await api.getAnalytics(projectId, versionId);
        if (!cancelled) {
          setAnalytics(payload);
        }
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError && e.status === 404
            ? "No saved version yet. Save a project version to populate the dashboard."
            : `Failed to load analytics: ${e?.message || e}`;
        setError(msg);
        setAnalytics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId]);

  const allRows = analytics?.rows || [];
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

  const handleTreemapCategoryClick = React.useCallback(
    ({ facility_id, category }) => {
      if (facility_id) setSelectedRu(facility_id);
      if (category) setSelectedCategory(category);
    },
    [],
  );

  const handleTreemapRuClick = React.useCallback((facility_id) => {
    if (facility_id) setSelectedRu(facility_id);
  }, []);

  const handleRuBarClick = React.useCallback((facility_id) => {
    if (facility_id) setSelectedRu(facility_id);
  }, []);

  const handleAuditDrill = React.useCallback(
    (context) => {
      if (onJumpToAudit) onJumpToAudit(context);
    },
    [onJumpToAudit],
  );

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

      {error ? <Alert severity="info">{error}</Alert> : null}

      {loading ? (
        <Paper sx={{ p: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Loading analytics...</Typography>
        </Paper>
      ) : null}

      {!loading && !error && analytics ? (
        <>
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
            <ScopeStackBar rows={filteredRows} />
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
              />
            </Paper>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Top Reporting Units (Scope-Stacked)
              </Typography>
              <TopReportingUnitsBar
                rows={filteredRows}
                onBarClick={handleRuBarClick}
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
                Click a row to drill through to the Audit tab.
              </Typography>
            </Stack>
            <TopContributorsTable
              rows={filteredRows}
              onJumpToAudit={handleAuditDrill}
            />
          </Paper>
        </>
      ) : null}

      {!loading && !error && !analytics ? (
        <Alert severity="info">
          Save a project version to populate the dashboard.
        </Alert>
      ) : null}
    </Stack>
  );
}
