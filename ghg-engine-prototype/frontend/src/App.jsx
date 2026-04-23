import * as React from "react";
import {
  Alert,
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
import { api, ApiError } from "./api";
import {
  EMPTY_ACTIVITY,
  buildSnapshot,
  createEmptyDraft,
  hydrateDraft,
  isCalculableActivity,
  normalizeActivityForSubmit,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";

const ActivityInputsPanel = React.lazy(() => import("./ActivityInputsPanel"));
const FacilitiesTab = React.lazy(() => import("./FacilitiesTab"));
const ResultsTab = React.lazy(() => import("./ResultsTab"));
const DashboardTab = React.lazy(() => import("./DashboardTab"));
const AuditTab = React.lazy(() => import("./AuditTab"));

function LazyTabFallback() {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Loading tab...
      </Typography>
    </Paper>
  );
}

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

export default function App({ colorMode = "light", onToggleColorMode = () => {} }) {
  const { snack, show, close } = useSnack();
  const [tab, setTab] = React.useState(0);
  const [activityCatalog, setActivityCatalog] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [projectVersions, setProjectVersions] = React.useState([]);
  const [activeProjectId, setActiveProjectId] = React.useState("");
  const [projectNameDraft, setProjectNameDraft] = React.useState("");
  const [projectRenameDraft, setProjectRenameDraft] = React.useState("");
  const [versionNote, setVersionNote] = React.useState("");
  const [projectBusy, setProjectBusy] = React.useState(false);
  const [facilities, setFacilities] = React.useState([{ ...EMPTY_FACILITY, id: uid(), facility_name: "Facility 1" }]);
  const [activities, setActivities] = React.useState([createEmptyDraft()]);
  const [inventoryYear, setInventoryYear] = React.useState(String(new Date().getFullYear()));
  const [gwpSet, setGwpSet] = React.useState("AR6");
  const [includeTrace, setIncludeTrace] = React.useState(true);
  const [calculating, setCalculating] = React.useState(false);
  const [resultRows, setResultRows] = React.useState([]);
  const [summaryRows, setSummaryRows] = React.useState([]);
  const [traceRows, setTraceRows] = React.useState([]);
  const [auditRows, setAuditRows] = React.useState([]);
  const [calcErrors, setCalcErrors] = React.useState([]);
  const [catalogError, setCatalogError] = React.useState("");
  const [projectError, setProjectError] = React.useState("");
  const [schemaInfo, setSchemaInfo] = React.useState(null);

  const hasActiveProject = Boolean(activeProjectId);
  const activeProject = React.useMemo(
    () => projects.find((p) => p.project_id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const activityTypesById = React.useMemo(
    () => Object.fromEntries(activityCatalog.map((activityType) => [activityType.activity_type_id, activityType])),
    [activityCatalog],
  );
  const activityLabelById = React.useMemo(
    () => Object.fromEntries(activityCatalog.map((activityType) => [activityType.activity_type_id, activityType.label])),
    [activityCatalog],
  );
  const facilityNameById = React.useMemo(
    () => Object.fromEntries(facilities.map((f) => [f.id, f.facility_name || f.id])),
    [facilities],
  );
  const dataEntryFacilities = React.useMemo(
    () => facilities.filter((facility) => String(facility.facility_name || "").trim()),
    [facilities],
  );
  const dataEntryFacilityIds = React.useMemo(
    () => new Set(dataEntryFacilities.map((facility) => facility.id)),
    [dataEntryFacilities],
  );
  const facilityOptions = React.useMemo(
    () => dataEntryFacilities.map((f) => ({ value: f.id, label: f.facility_name })),
    [dataEntryFacilities],
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
    setActivities(
      Array.isArray(snap.activities) && snap.activities.length > 0
        ? snap.activities.map((draft) => hydrateDraft(draft, activityTypesById[draft.activity_type_id]))
        : [createEmptyDraft()],
    );
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
    setInventoryYear(String(payload?.inventory_year || new Date().getFullYear()));
    setGwpSet(String(payload?.gwp_set || "AR6"));
    setIncludeTrace(Boolean(payload?.include_trace ?? true));
  }, [activityTypesById]);

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
          snapshot: buildSnapshot({
            facilities,
            activities,
            resultRows,
            summaryRows,
            traceRows,
            auditRows,
          }),
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
    const loadCatalog = async () => {
      try {
        const rows = await api.listActivityTypes();
        if (!Array.isArray(rows)) {
          throw new Error("Catalog API returned non-array payload.");
        }
        setActivityCatalog(rows);
        setCatalogError("");
      } catch (e) {
        setActivityCatalog([]);
        setCatalogError(String(e.message || e));
        show(`Failed to load activity catalog: ${e.message}`, "error");
      }
    };
    loadCatalog();
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
      const initialActivities = [createEmptyDraft()];
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
        snapshot: buildSnapshot({
          facilities: initialFacilities,
          activities: initialActivities,
          resultRows: [],
          summaryRows: [],
          traceRows: [],
          auditRows: [],
        }),
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
      setActivities([createEmptyDraft()]);
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

  const runCalculation = async () => {
    if (!hasActiveProject) {
      show("Create or select a project first.", "warning");
      setTab(0);
      return;
    }
    if (!dataEntryFacilities.length) {
      show("Add at least one named facility before entering activity data.", "warning");
      setTab(1);
      return;
    }
    const rows = activities.filter(
      (draft) =>
        dataEntryFacilityIds.has(draft.facility_id)
        && draft.activity_type_id
        && draft.activity?.value !== "",
    );
    if (!rows.length) {
      show("Add at least one activity row with facility, activity, and value.", "warning");
      return;
    }

    const calculableRows = rows.filter((draft) => isCalculableActivity(activityTypesById[draft.activity_type_id]));
    const skippedRows = rows.filter((draft) => !isCalculableActivity(activityTypesById[draft.activity_type_id]));
    if (!calculableRows.length) {
      show(
        skippedRows.length
          ? "Only unsupported activities have data right now. Add at least one implemented or partial activity to calculate."
          : "Add at least one calculable activity row before running the inventory.",
        "warning",
      );
      return;
    }

    const grouped = groupByFacility(calculableRows);
    const mergedResults = [];
    const mergedTrace = [];
    const mergedAudit = [];
    const mergedErrors = [];
    const summaryMap = {};
    // Clear stale per-row error chips from a previous run before dispatching
    // the new batch; otherwise old errors linger until the new response
    // arrives and chips across several facilities update piecemeal.
    setCalcErrors([]);
    setCalculating(true);
    let totalFailure = false;
    let totalFailureMessage = "";
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
          activities: facilityRows.map((draft) => normalizeActivityForSubmit(draft, activityTypesById[draft.activity_type_id])),
        };
        let response;
        try {
          response = await api.calculateAudit(payload);
        } catch (err) {
          // On total failure the backend still returns the structured
          // envelope (with populated errors[]) alongside HTTP 400. Capture
          // those errors for row attribution, then keep iterating other
          // facilities so we can still surface their results/errors.
          if (err instanceof ApiError && err.body && Array.isArray(err.body.errors)) {
            for (const ee of err.body.errors) mergedErrors.push(ee);
            totalFailure = true;
            totalFailureMessage = err.message || totalFailureMessage;
            continue;
          }
          throw err;
        }
        for (const rr of response.results || []) mergedResults.push(rr);
        for (const tr of response.trace || []) mergedTrace.push(tr);
        for (const ar of response.audit_rows || []) mergedAudit.push(ar);
        for (const ee of response.errors || []) mergedErrors.push(ee);
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
          activity_label: r.activity_label || activityLabelById[r.activity_type_id] || r.activity_type_id,
        })),
      );
      setTraceRows(mergedTrace.map((r, i) => ({ id: `${i}`, ...r })));
      setAuditRows(
        mergedAudit.map((r, i) => ({
          id: `a_${i}`,
          ...r,
          facility_name: facilityNameById[r.facility_id] || r.facility_id,
          activity_label: r.activity_label || activityLabelById[r.activity_type_id] || r.activity_type_id,
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
      setCalcErrors(mergedErrors);
      const partialSuccess = mergedErrors.length > 0 && mergedResults.length > 0;
      const totalFailureNoResults = totalFailure && mergedResults.length === 0;
      if (totalFailureNoResults) {
        // All activities failed. Keep the user on the data-entry tab so
        // they can see the per-row chips flip to "Calc error". Snackbar
        // surfaces the first error message; tooltips cover the rest.
        show(`Calculation failed: ${totalFailureMessage || "all activities errored"}`, "error");
      } else {
        setTab(3);
        if (partialSuccess) {
          show(
            `Some activities failed to calculate (${mergedErrors.length}) — see row details.`,
            "info",
          );
        } else if (skippedRows.length) {
          show(
            `Calculation complete. Skipped ${skippedRows.length} unsupported activity row${skippedRows.length === 1 ? "" : "s"} that are not calculable yet.`,
            "warning",
          );
        } else {
          show("Calculation complete", "success");
        }
      }
    } catch (e) {
      // Fall-through path for non-ApiError failures (network, 5xx, etc.).
      // Structured 400s are handled inline above and populate calcErrors.
      show(`Calculation failed: ${e.message}`, "error");
    } finally {
      setCalculating(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          mb: 2,
          // Blur the background behind the sticky shell so content scrolling
          // under it stays legible without adding a hard color.
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            backdropFilter: "blur(8px)",
            background: (theme) => (theme.palette.mode === "dark"
              ? "rgba(31, 40, 49, 0.65)"
              : "rgba(241, 243, 244, 0.65)"),
            zIndex: -1,
            borderRadius: (theme) => `${theme.shape.borderRadius}px`,
          },
        }}
      >
        <Paper sx={{ mb: 1, p: { xs: 2, md: 2.5 } }}>
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

        <Paper sx={{ px: 1.5, pt: 0.5 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Projects" />
            <Tab label="Facilities" disabled={!hasActiveProject} />
            <Tab label="Activity Inputs" disabled={!hasActiveProject} />
            <Tab label="Results" disabled={!hasActiveProject} />
            <Tab label="Dashboard" disabled={!hasActiveProject} />
            <Tab label="Audit" disabled={!hasActiveProject} />
          </Tabs>
        </Paper>
      </Box>

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
        <React.Suspense fallback={<LazyTabFallback />}>
          <FacilitiesTab
            facilities={facilities}
            setFacilities={setFacilities}
            onAddFacility={addFacility}
          />
        </React.Suspense>
      )}

      {tab === 2 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <ActivityInputsPanel
            activities={activities}
            setActivities={setActivities}
            facilities={dataEntryFacilities}
            activityCatalog={activityCatalog}
            activityTypesById={activityTypesById}
            facilityOptions={facilityOptions}
            inventoryYear={inventoryYear}
            setInventoryYear={setInventoryYear}
            gwpSet={gwpSet}
            setGwpSet={setGwpSet}
            includeTrace={includeTrace}
            setIncludeTrace={setIncludeTrace}
            runCalculation={runCalculation}
            calculating={calculating}
            saveCurrentVersion={saveCurrentVersion}
            catalogError={catalogError}
            calcErrors={calcErrors}
            show={show}
          />
        </React.Suspense>
      )}

      {tab === 3 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <ResultsTab
            resultRows={resultRows}
            summaryRows={summaryRows}
            traceRows={traceRows}
            onSaveResults={saveCurrentVersion}
          />
        </React.Suspense>
      )}

      {tab === 4 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <DashboardTab
            resultRows={resultRows}
            onSaveResults={saveCurrentVersion}
          />
        </React.Suspense>
      )}

      {tab === 5 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <AuditTab
            auditRows={auditRows}
            onExportAuditCsv={downloadAuditCsv}
          />
        </React.Suspense>
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
